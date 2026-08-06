# Rendimiento del matching de catálogo

Perfilado, cuello de botella encontrado, cambios aplicados y cómo volver a
medirlo.

```bash
npm run matching:profile   # desglose por etapa contra la base real
npm run matching:bench     # escalado a 1.000 y 10.000 productos
npm test -- matchingPerformance   # invariantes de forma y coste en memoria
```

---

## Cómo leer cualquier número de este documento

Entre una máquina de desarrollo y Supabase (`eu-central-1`) hay **~200-270 ms de ida
y vuelta**. Medido con `select 1`. Ese suelo está en TODAS las cifras de
cliente y no existe en producción, donde las funciones de Vercel (`fra1`) y la
base comparten región.

Por eso cada medida se da en dos columnas cuando importa:

- **cliente** — lo que tarda desde Node, RTT incluido. Útil para comparar antes
  y después en la misma máquina; inútil como estimación de producción.
- **servidor** — `Execution Time` del propio `EXPLAIN ANALYZE` de Postgres. Es
  el trabajo real de la base y lo que se aproxima a producción.

Confundirlos lleva a optimizar lo que no toca: la primera hipótesis razonable
era "la búsqueda vectorial es lenta" y resultó ser falsa por exactamente este
motivo.

---

## El cuello de botella

La UI se quedaba en «Buscando en el catálogo…» y la sospecha natural era la
búsqueda vectorial. El perfilado dijo otra cosa:

| Etapa | p50 (cliente) | Servidor |
|---|---|---|
| Embedding del crop (CLIP, caliente) | 35 ms | — |
| Procesado del crop (hash + phash + embedding) | 39 ms | — |
| Búsqueda vectorial top-24, solo ids | 248 ms | **3,7 ms** |
| **Traer 300 candidatos con su `doc`** | **2 800-6 500 ms** | — |
| `matchProducts` completo | **1 860 ms** | — |

Dos hallazgos:

1. **La búsqueda vectorial no era el problema.** Postgres la resolvía en 3,7 ms
   con escaneo secuencial sobre 1.048 productos. Los 248 ms del cliente eran
   248 ms de red y 3,7 de cómputo.
2. **El problema era el payload.** La preselección pedía 300 candidatos con el
   documento JSONB completo de cada ficha: **1.022 KB por búsqueda**. Y se
   ejecuta una vez POR OBJETO DETECTADO.

Antes de eso había un estado todavía peor —recorrer el catálogo entero en
memoria, 14,5 MB y 7,1 s por búsqueda— que ya se había sustituido por la
preselección con pgvector.

---

## Cambios aplicados

### 1. Proyección slim (el cambio que más pesa)

`SLIM_PRODUCT_JSON` en `lib/catalogIngestion/catalog/postgresStore.ts`
selecciona con `jsonb_build_object` solo los campos que usan el ranking y la
tarjeta. Fuera quedan historial de precios, metadatos de la fuente, evidencia de
extracción, variantes y los propios embeddings.

| Consulta | Payload |
|---|---|
| 300 × `doc` sin embeddings (antes) | 1.022 KB |
| 24 × `doc` sin embeddings | 82 KB |
| 24 × proyección explícita (ahora) | **32 KB** |

**32× menos datos por búsqueda.**

> Si el ranking empieza a usar un campo nuevo hay que añadirlo a
> `SLIM_PRODUCT_JSON`. Si no, llegará vacío y el criterio no puntuará nunca —
> sin error, solo peores resultados.

### 2. Filtros en SQL, no en memoria

Antes se traían 300 candidatos porque el descarte por categoría/género ocurría
DESPUÉS. Ahora viajan a la consulta y basta con top-24.

La taxonomía de familias sigue viviendo solo en TypeScript:
`compatibleCategories()` (`normalization/normalize.ts`) invierte la pregunta y
devuelve el conjunto de valores de `category` que podrían casar, que se pasa
como array a `category = any($n)`. Reimplementar `categoriesMatch` en SQL habría
duplicado la taxonomía en dos sitios destinados a divergir.

Filtros aplicados en la base: `is_active`, `image_embedding is not null`,
`embedding_dimension`, categoría compatible, género compatible e imagen
presentable.

### 3. Índice HNSW

Migración `20260801000010_vector_index.sql`.

Para indexar, pgvector exige dimensión fija en la columna. Había 3 fichas con
vectores de 64 dimensiones del proveedor `hash` antiguo, marcadas `ready` con
`embedding_dimension` a `null` — mentían sobre su estado. La migración las anula
y las marca `pending` (un vector de 64d no participa en las búsquedas de todas
formas: pgvector **aborta la consulta entera** si se topa con uno), fija la
columna a `vector(512)` y crea el índice.

HNSW y no IVFFlat porque IVFFlat hay que reentrenarlo cuando el catálogo crece y
HNSW se mantiene solo al insertar. Para un catálogo que se sincroniza a diario,
esa diferencia operativa pesa más que su mayor coste de construcción.

### 4. `ANALYZE` — el detalle que casi se escapa

Con 10.000 productos el índice existía **y el planificador no lo usaba**:
seguía en escaneo secuencial. Sin estadísticas frescas tras una carga masiva,
el coste estimado del índice sale peor que el del escaneo.

| 10.000 productos | Servidor |
|---|---|
| Sin índice | 30,1 ms |
| HNSW sin `ANALYZE` | 31,2 ms ← el índice no se usa |
| HNSW con `ANALYZE` | **1,7 ms** |

Es el peor modo de fallo posible: parece aplicado y no hace nada. La migración
termina con `analyze catalog_products`, **y hay que repetirlo tras cada
importación grande**.

### 5. Precalentado del modelo

La primera búsqueda tras arrancar tardaba **6.831 ms** y las siguientes 500:
la diferencia era cargar CLIP (ONNX, ~90 MB) dentro de la petición del usuario.
`bootstrapIngestion` ahora lanza la carga al arrancar sin esperarla
(`void import(...)`) — bloquear el arranque retrasaría todo lo demás, y si el
modelo falla el provider ya degrada a `hash` por su cuenta.

Primera búsqueda tras arranque: **6.831 ms → 764 ms**.

### 6. Concurrencia con `Promise.allSettled`

`hooks/useObjectMatching.ts` vacía la cola en tandas de `MAX_CONCURRENT` (3) con
`Promise.allSettled`. Con `Promise.all`, un objeto cuyo crop falle abortaría la
espera de los demás y el usuario perdería coincidencias que ya estaban listas.

El tope de 3 sale del banco: 1 detección son ~260 ms y 5 simultáneas ~2.300 ms;
más allá de 3 en vuelo la cola solo añade espera.

### 7. Caché

`CatalogMatchingProvider.cacheKey` — clave por hash del crop **+ proveedor de
embeddings + versión del índice + todos los filtros enviados + topK + umbral**.

El modelo y la versión están en la clave porque son la parte que muerde: al
pasar de embeddings `hash` a CLIP, o tras un reindex, las respuestas cacheadas
con el índice anterior son sencillamente incorrectas y no hay forma de
detectarlo desde el valor. Con ambos en la clave, las entradas viejas quedan
huérfanas en lugar de servirse.

Invalidación por escritura: `invalidateProductSnapshot()` en `saveProduct`.

### 8. OpenAI fuera del camino crítico

Ya lo estaba tras el trabajo anterior y se ha verificado: `resolveDetectionMatch`
consulta el catálogo primero y solo llama al pipeline externo —el único que usa
OpenAI, en `enrichCropDetails`— cuando el catálogo no alcanza el umbral o el
usuario lo pide. En `catalog_only` no se toca OpenAI en absoluto.

### 9. La UI dice en qué tarda

`MatchingProgress` ya no es un esqueleto mudo: muestra la etapa en curso
(en cola → recortando → buscando) y **cronometra desde que empezó**. El
cronómetro es tiempo real medido, no una barra que avanza sola: cuando algo
tarda de más, el número lo delata en vez de disimularlo.

---

## Antes y después

Ruta completa `POST /api/vision/match-object` en modo `catalog_only`, medida
desde el cliente con el suelo de red de ~250 ms incluido:

| | Antes | Después |
|---|---|---|
| Primera búsqueda tras arrancar | 6.831 ms | **764 ms** |
| Búsqueda sin caché (p50) | 4.700-21.300 ms | **520 ms** |
| Búsqueda con caché (p50) | — | **8 ms** |
| `matchProducts` (p50) | 1.860 ms | **300 ms** |
| Payload por búsqueda | 1.022 KB | **32 KB** |
| Candidatos transferidos | 300 | **24** |

Desglose de una búsqueda sin caché:

```
total 485 ms  =  embedding 43,9  +  vectorSearch 407,7  +  ranking 2,1
```

De esos 407 ms de `vectorSearch`, **~250 son RTT de la máquina de desarrollo** y
0,55 ms es el trabajo de Postgres (`Index Scan using
idx_catalog_products_image_embedding_hnsw`).

### Objetivos

| Objetivo | Resultado |
|---|---|
| Búsqueda vectorial < 100 ms | **0,55 ms en servidor.** Desde una máquina remota son ~400 ms por el RTT; en producción (misma región) el objetivo se cumple con holgura, pero **no está verificado en producción** |
| Primer resultado < 1 s | **520 ms** con el RTT de desarrollo incluido ✓ |
| Acierto de caché < 150 ms | **8 ms** ✓ |

### Escalado (banco de pruebas)

| Productos | Sin índice (servidor) | HNSW (servidor) | Construcción |
|---|---|---|---|
| 1.000 | 2,9 ms | **0,7 ms** | 0,7 s |
| 10.000 | 30,1 ms | **1,7 ms** | 8,1 s |

Sin índice el coste crece linealmente (10× productos → 10× tiempo). Con HNSW
crece de forma logarítmica.

---

## Operación

- **Tras cada importación grande: `ANALYZE catalog_products`.** Sin esto el
  índice deja de usarse en silencio.
- **Los embeddings del catálogo se precalculan en la ingesta.** Nunca se genera
  uno durante una búsqueda; lo único que se embebe por petición es el crop. Hay
  un test que lo comprueba (`matchingPerformance.test.ts`).
- **Fichas con `embedding_status = 'pending'`** no participan en las búsquedas.
  Reindexa con `npm run catalog:embeddings:reindex -- --only-missing`.
  Estado actual: **1048/1048 listas**.
- **`CATALOG_VECTOR_SHORTLIST`** (24 por defecto) controla cuántos candidatos
  pide la preselección. Subirlo mejora el recall tras filtros muy restrictivos
  a costa de payload.
- **`CATALOG_INDEX_VERSION`** invalida la caché de matching al subirla. Úsala
  tras un reindex.

## Lo que no está hecho

- **No verificado en producción.** Todas las cifras salen de una máquina de
  desarrollo contra Supabase con ~250 ms de RTT. La comparación antes/después es
  válida (misma máquina, mismo enlace); la latencia absoluta en Vercel será
  bastante menor y conviene confirmarla con las métricas de
  `/api/matching/metrics`.
- **Sin streaming real del servidor.** La actualización es progresiva por
  detección (cada tarjeta se resuelve por su cuenta y aparece cuando está), no
  por etapas dentro de una misma detección. Con el total en ~500 ms el retorno
  de partir la respuesta en un stream es pequeño; si el catálogo crece mucho o
  se añade reranking pesado, merecerá la pena reconsiderarlo.
- **`hnsw.ef_search` sin calibrar.** Se deja el valor por defecto de pgvector
  (40) porque con 10.000 productos el índice ya resuelve en 1,7 ms. Ahora es
  configurable con `CATALOG_HNSW_EF_SEARCH`; cuando se fija, la consulta pasa a
  ejecutarse dentro de una transacción sobre un cliente dedicado, porque
  `SET LOCAL` fuera de transacción no hace nada y un `SET` de sesión sobre el
  pool contaminaría otras consultas. Sin fijar, cero sobrecoste.
