# Pipeline de vídeo preprocesado

Cómo se pasa de un vídeo a un catálogo de productos por timestamp, qué estaba
roto y cómo se comprueba.

```bash
npm test -- videoPipeline      # 20 tests del pipeline, sin red
npm run db:migrate             # incluye la 013 (identidad + estados)
```

---

## El fallo que originó este trabajo

Un vídeo de ~90 s producía esto:

| Métrica | Valor observado |
|---|---|
| Frames recibidos / analizados | 468 / 35 |
| Escenas | 19 |
| Tracks | 10 |
| Productos únicos | **10** |
| Catálogo hits | **0** |
| Búsquedas externas | **0** |
| Matching | **101.583 ms** |
| Total | 310.378 ms |

Y varios productos con el texto `matching omitido: The operation was aborted
due to timeout`, además de cinco tarjetas para la misma camiseta:

> camiseta blanca · camiseta blanca de manga corta · camiseta ·
> camisa de manga corta · camiseta/parte superior blanca

Tres causas independientes, no una.

### 1. El matching iba en serie, y por HTTP contra sí mismo

`lib/analysis/jobs/serverDeps.ts` resolvía cada producto con
`fetch(origin + "/api/vision/match-object")`. Reutilizar el endpoint parecía lo
limpio, pero significaba una petición HTTP y una invocación de función
**completas por producto**, ejecutadas una detrás de otra. Diez productos eran
diez viajes encadenados.

**Arreglo:** el pipeline se extrajo del route handler a
`lib/matching/detectionPipeline.ts` y ahora se llama en proceso. El route quedó
como capa HTTP (226 líneas; antes 935) y usa exactamente el mismo código, así
que las dos vías no pueden divergir.

### 2. El timeout tiraba resultados que ya estaban calculados

El presupuesto de tiempo era un `AbortSignal.timeout(15000)` sobre la petición
entera. Al saltar, se perdía **todo** — incluido el resultado del catálogo, que
en el modo `catalog_first` se calcula ANTES de salir a Internet y muchas veces
ya estaba listo. De ahí los 0 catalog hits: no es que el catálogo no encontrara
nada, es que su respuesta se descartaba.

Peor: abortar el `fetch` no detiene al servidor. La búsqueda externa seguía
ejecutándose y pagándose sin que nadie la contabilizara. Por eso también había
0 búsquedas externas registradas.

**Arreglo:** el reloj vive dentro de `resolveDetectionMatch` y es **por
fuente** (`CATALOG_MATCH_TIMEOUT_MS`, `EXTERNAL_SEARCH_TIMEOUT_MS`). Agotarlo
produce un **estado** (`timeout`), no una excepción, y no cancela la otra
fuente. Un catálogo que da timeout con Internet resuelto es
`external_candidate`, no un fallo.

### 3. El dedup no podía fundir nada

El criterio era `categoría idéntica Y (firma perceptual cercana O nombre corto
igual)`. Dos fallos encadenados:

- la categoría se comparaba **por igualdad de texto**, y era una puerta dura. El
  modelo devuelve "ropa", "camisetas" o "prenda superior" para la misma prenda,
  así que la fusión se descartaba antes de mirar nada más;
- el respaldo era el nombre recortado a tres palabras, que con descripciones
  libres no coincide casi nunca.

Reproducido con los cinco nombres reales: **5 tracks → 2 productos** (y los dos
que sí fundían lo hacían por un hash que casó de casualidad).

**Arreglo:** `lib/analysis/jobs/identity.ts`, un score con seis señales.

---

## Identidad global de producto

```
identityScore = visual · 0.50 + atributos · 0.20 + categoría · 0.10
              + persona · 0.08 + continuidad · 0.05 + logo · 0.07
```

Con dos decisiones que no son cosméticas:

**Las señales ausentes se abstienen, no votan.** Los pesos se renormalizan
sobre las señales que existen. Dar 0.5 a lo desconocido parece inocuo y no lo
es: en un vídeo sin personas ni logos detectados, dos señales de seis votaban
permanentemente "medio parecido" y arrastraban el score de cualquier par hacia
el centro. Son 15 puntos porcentuales que un producto real tenía que recuperar
para llegar al umbral — es decir, no fundir nunca.

**El embedding manda; el hash solo puede fundir, no certificar.** El parecido
visual sale del embedding CLIP del mejor crop. Sin él se cae al hash
perceptual, pero el score final se limita a 0.89: puede superar el umbral de
fusión (0.84) y nunca el de identidad fuerte (0.90). Un hash idéntico puede
significar "el mismo objeto" o "dos objetos con la misma silueta en la misma
posición del encuadre".

### Las dos puertas duras

Ningún score las salta:

1. **Slot corporal.** Una camiseta (`upper`) y un pantalón (`lower`) no son el
   mismo producto aunque compartan color, textura, persona y embedding.
2. **Persona coincidente en el tiempo.** Dos tracks que **se solapan** y están
   asociados a personas distintas no pueden ser la misma prenda.

   El solapamiento es imprescindible. `person_index` se asigna **por frame**: la
   persona 0 del segundo 3 no tiene por qué ser la misma que la del segundo 20.
   Tratarlo como identidad estable partiría la misma prenda cada vez que cambia
   el orden de las personas en el encuadre — exactamente la fragmentación que
   este módulo existe para evitar. Dentro de un mismo instante, en cambio, el
   índice sí distingue humanos con certeza.

### Umbrales

| Variable | Defecto | Efecto |
|---|---|---|
| `VIDEO_PRODUCT_IDENTITY_THRESHOLD` | 0.84 | A partir de aquí se funde |
| `VIDEO_PRODUCT_STRONG_IDENTITY_THRESHOLD` | 0.90 | Fusión sin marca de revisión |
| `VIDEO_PRODUCT_POSSIBLE_DUPLICATE_THRESHOLD` | 0.76 | Se marca `possibleDuplicateOf` sin fundir |

Fundir de más es peor que fundir de menos: une dos productos reales en una
ficha que ya no se puede separar sin reprocesar. Por eso la franja intermedia
marca la sospecha en vez de resolverla.

### Resultado sobre el caso real

```
6 tracks → 2 productos
p1: "camiseta blanca de manga corta"   ← 5 tracks · 10 apariciones · t-shirt
    variantes: camiseta blanca | camiseta blanca de manga corta | camiseta |
               camisa de manga corta | camiseta/parte superior blanca
p2: "pantalón vaquero azul"            ← 1 track · trousers
```

---

## Estados de matching

Un único "NO MATCH" mezclaba tres decisiones distintas. Ahora
(`ProductMatchStatus`):

| Estado | Significa | ¿Reintentable? |
|---|---|---|
| `catalog_matched` | Resuelto por el catálogo propio | — |
| `external_candidate` | Internet encontró algo · pendiente de revisión | — |
| `no_match` | Se consultó todo y no hay nada. Definitivo | no |
| `catalog_timeout` | El catálogo no respondió a tiempo | **sí** |
| `external_timeout` | Internet no respondió a tiempo | **sí** |
| `partial_result` | Una fuente respondió, la otra falló | sí |
| `embedding_error` | No se pudo embeber el crop | no |
| `not_searched` | Cancelado, sin presupuesto o sin crop | no |
| `matching_error` | Error inesperado tras agotar reintentos | sí |

Los reintentos (`MATCHING_MAX_RETRIES=2`, backoff exponencial desde
`MATCHING_RETRY_BACKOFF_MS=1000`) se aplican **solo a lo transitorio**. Un
`no_match` no se reintenta: el catálogo no va a cambiar de opinión en un
segundo, y pagar tres búsquedas externas por un producto que no existe es justo
el gasto que este pipeline debe evitar.

---

## Concurrencia

`matchUniqueProducts` procesa en tandas de `MATCHING_MAX_CONCURRENCY` (3) con
`Promise.allSettled`. Un producto que falla es un resultado con estado de error,
no un agujero: `matchOneProduct` no lanza nunca.

### El bug que apareció al medir

Con concurrencia 3, la primera ejecución real tardó 9.888 ms y el embedding de
cada crop costó **5.400 ms**. El log lo explicaba: `embeddings: provider local
activo` aparecía **tres veces**.

`getEmbeddingProvider()` tenía una carrera clásica — la guarda
`if (activeProvider)` se evalúa, el `await local.init()` cede el control, y las
otras dos llamadas vuelven a pasar la guarda y cargan otro CLIP. Tres modelos
ONNX de ~90 MB en paralelo. No fallaba nada: solo era tres veces más lento y
tres veces más memoria.

Arreglado memoizando la promesa en vuelo:

| | Antes | Después |
|---|---|---|
| 3 productos (frío) | 9.888 ms | **3.580 ms** |
| Embedding del crop | 5.376 ms | **62-138 ms** |
| Búsqueda vectorial | 587 ms | 562-701 ms |
| Ranking | 1,8 ms | 0,4-1,5 ms |

> Los ~600 ms de búsqueda vectorial son casi todos RTT a Neon desde una máquina
> de desarrollo. Ver `docs/MATCHING_PERFORMANCE.md`.

---

## Consulta por vídeo y timestamp

```
GET /api/analysis/videos/<sha256>/at?ms=47000
```

Resuelve contra `video_product_occurrences` (una fila por producto único con su
rango de aparición), no recorriendo apariciones en memoria. Es la consulta que
responde una pausa, así que tiene que ser barata.

El rango `[first_seen_at, last_seen_at]` es **continuo**: un producto que
aparece, desaparece y vuelve cuenta como presente en el hueco. Para
distinguirlo, la respuesta incluye `timestampsMs` y `exactAppearance`.

Distinto de `GET /api/analysis/videos/<hash>?time=…`, que reconstruye el panel
completo del job desde su estado de runtime: aquel sirve la demo, este la
integración.

---

## Lo que NO está hecho

- **FFmpeg en backend (sección 3 de la especificación).** Sigue siendo el
  navegador quien extrae los frames y los envía por lotes; el binario del vídeo
  nunca llega al servidor. Cambiarlo no es una mejora incremental sino otra
  arquitectura de ingesta: subir el fichero completo, añadir `ffmpeg-static` al
  despliegue y reescribir el contrato de `POST /jobs/[id]/frames`. No se ha
  hecho, y conviene saber qué se pierde mientras tanto:
  - la detección de escenas usa el diff perceptual de los thumbs que manda el
    cliente, no `scene detection` de FFmpeg;
  - no se leen keyframes ni metadata real del contenedor (fps, resolución
    exacta): se usa lo que declara el cliente;
  - un cliente lento o con una pestaña en segundo plano ralentiza la extracción.
- **Reproceso incremental (sección 14).** `forceReprocess` crea un job nuevo y
  conserva el anterior, pero **rehace la detección**: no reutiliza los frames ni
  recalcula solo el matching cuando lo único que cambió fue el catálogo.
- **`video_processing_jobs` no se usa.** La tabla existe desde la migración 012
  con sus estados y checkpoints, pero el job real sigue viviendo en
  `analysis_jobs`. La lista de estados de la especificación (`extracting_frames`,
  `detecting_scenes`, `sampling`…) no está implementada como máquina de estados;
  el progreso se comunica con contadores y logs por etapa.
- **Verificación en producción.** Todas las cifras salen de una máquina de
  desarrollo contra Neon con ~250 ms de RTT.
