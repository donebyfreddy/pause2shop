# Importación de catálogo desde dataset de moda

Carga productos de moda **reales, con foto** en el catálogo de pause2shop sin
depender del scraping de ninguna tienda.

**Por qué existe.** Zara, Mango y H&M bloquean por IP (no por user-agent: está
verificado con control negativo). Sin catálogo no se puede probar el matching
visual, y sin poder scrapear no había catálogo. Un dataset público de
investigación rompe esa dependencia: 44.072 fichas de moda con imagen, sin
pedirle permiso a nadie.

**El precio de esa independencia, dicho desde el principio:** el dataset NO trae
datos comerciales. No hay precio, ni stock, ni URL de compra, ni merchant, ni
SKU vigente. Esos campos quedan a `null` y se declaran en
`dataset.unavailableFields`. No se derivan ni se estiman. Un precio inventado en
un catálogo no se queda en la base de datos: llega hasta el botón de comprar.

---

## Inicio rápido

```bash
npm run catalog:dataset:inspect                    # ¿es alcanzable? ¿qué trae?
npm run catalog:dataset:import -- --limit=10 --dry-run   # ensayo, no escribe
npm run catalog:dataset:import -- --limit=1000     # importación real
```

Repetir el último comando **no duplica**: actualiza. Ver
[Deduplicación](#deduplicación).

---

## Fuente de datos

| | |
|---|---|
| Fuente principal | `hgjun/fashion-product-images-small` (HuggingFace) |
| Procedencia original | `paramaggarwal/fashion-product-images-small` (Kaggle) |
| Filas | 44.072 |
| Split | `train` · config `default` |
| Tamaño | 607 MB descomprimido / 275 MB en parquet |
| Imágenes | JPEG de 60×80 px, ~1,8 KB cada una |
| Licencia | **No declarada** en la tarjeta del dataset |

> **Limitación legal.** El dataset no declara licencia. Se trata como material de
> **demostración e investigación**: no redistribuir las imágenes ni usarlas
> comercialmente. Las fichas se marcan `origin = 'dataset_demo'` precisamente
> para que sea trivial identificarlas y borrarlas
> (`npm run catalog:dataset:cleanup`).

### Campos que SÍ trae

`id`, `gender`, `masterCategory`, `subCategory`, `articleType`, `baseColour`,
`season`, `year`, `usage`, `productDisplayName`, `image`

### Campos que NO trae

`price`, `originalPrice`, `currency`, `availability`, `stock`, `productUrl`,
`merchant`, `sku`, `gtin`, `description`, `material`, `sizes`, `variants`

Todos quedan a `null`. La UI los muestra como «Dato no disponible en dataset»,
no como un hueco vacío que parezca un fallo de importación.

---

## Arquitectura

No hay una segunda base de datos ni un pipeline paralelo. La importación entra
por las mismas costuras que el scraping:

```
HuggingFace /rows (paginado)
        │
        ▼
  DatasetReader ──────────── fallback: Kaggle (si hay credenciales)
        │  lib/catalogIngestion/datasets/reader.ts
        ▼
  prepareDatasetImage         valida · rota EXIF · optimiza · sha256 · dHash
        │  datasets/images.ts
        ▼
  publishPublicObject ──────► Vercel Blob (persistente)
        │  lib/mediaStorage/                catalog/datasets/<dataset>/<id>.jpg
        ▼
  EmbeddingProvider           CLIP local (512d) o encolado
        │  catalogIngestion/embeddings/
        ▼
  normalizeDatasetRow         fila → NormalizedProduct
        │  datasets/normalize.ts
        ▼
  ingestProduct ─────────────► catalog_products  (UPSERT por source+id)
        │  catalog/ingest.ts       ÚNICA puerta de entrada al catálogo
        ▼
  JobQueue + catalog_job_logs  progreso, checkpoint, logs en /admin/jobs
```

Piezas reutilizadas sin cambios de diseño: `CatalogStore`, `ingestProduct`,
`JobQueue`, `createJobLogger`, `getEmbeddingProvider`, `dhash`,
`normalizeCategory`, `normalizeColor`, `publishPublicObject`.

### Ficheros nuevos

| Fichero | Qué hace |
|---|---|
| `lib/catalogIngestion/datasets/types.ts` | Contrato: `CatalogDatasetImporter`, opciones, resultado, checkpoint |
| `lib/catalogIngestion/datasets/registry.ts` | Datasets soportados y sus campos disponibles/no disponibles |
| `lib/catalogIngestion/datasets/huggingface.ts` | Lectura paginada, reintentos, `inspect` |
| `lib/catalogIngestion/datasets/kaggle.ts` | Fallback: descarga + descompresión + `styles.csv` |
| `lib/catalogIngestion/datasets/reader.ts` | Selección de proveedor y degradación |
| `lib/catalogIngestion/datasets/brands.ts` | Extracción de marca **verificada** (ver abajo) |
| `lib/catalogIngestion/datasets/normalize.ts` | Fila → `NormalizedProduct` |
| `lib/catalogIngestion/datasets/images.ts` | Validación, hashes y subida a storage |
| `lib/catalogIngestion/datasets/importer.ts` | Orquestación: lotes, checkpoint, contadores |
| `lib/mediaStorage/vercelBlob.ts` | Driver de Vercel Blob |
| `db/migrations/20260731000008_dataset_import.sql` | Columnas de estado de embedding y procedencia |

---

## Decisiones que merecen explicación

### No se descarga el parquet completo

El split pesa 275 MB comprimido y tiene 44.072 filas. Bajarlo entero para
importar 1.000 fichas sería absurdo: no cabría en el disco de una lambda y
tardaría minutos antes de guardar el primer producto.

Se usa `GET /rows?offset&length` del dataset-viewer, que pagina. Así se lee solo
lo necesario, el progreso es visible desde la primera página, y **el offset de la
página ES el checkpoint** que hace la importación reanudable.

Contrapartida: las URLs de imagen que devuelve el viewer vienen **firmadas y
caducan**. Hay que descargar la imagen durante la importación, no guardar la URL
para después. Por eso la imagen se sube a storage propio y lo que se persiste es
NUESTRA URL.

### La marca no se adivina

El dataset no tiene columna de marca; solo un nombre libre («Peter England Men
Party Blue Jeans»). Tomar las primeras palabras produce basura: «Turtle Check Men
Navy Blue Shirt» daría la marca «Turtle Check», cuando la marca es «Turtle» y
«Check» es el estampado.

La solución tiene dos partes:

1. **Límite estructural.** El nombre sigue el patrón `<marca> <género> <resto>`,
   y el token de género es verificable contra la columna `gender` de la fila. Eso
   da un candidato con un límite objetivo, no con una heurística.
2. **Verificación por frecuencia.** El candidato solo se acepta si está en una
   lista derivada del propio dataset: se muestrearon 5.600 nombres repartidos por
   todo el split y se conservaron los prefijos que aparecen ≥ 4 veces. Una marca
   real se repite decenas de veces; «Turtle Check» aparece una.

Si el candidato no está en la lista, **la marca queda a `null`**. Un hueco
honesto es mejor que un dato plausible y falso.

La lista es reproducible:

```bash
npm run catalog:dataset:brands            # rederiva e imprime las diferencias
```

Dos ajustes que ninguna regla mecánica resuelve y por eso están declarados:

- Las líneas de producto colapsan a la marca madre («Jockey ELANCE» → `Jockey`),
  podando todo prefijo que contenga a otro más corto ya presente.
- **Excepción:** «Lee Cooper» NO es una línea de «Lee» — son dos empresas
  distintas. Vive en `DISTINCT_BRANDS` y sobrevive a la poda.

### `canonicalUrl` es un URI `dataset://`

`catalog_products.canonical_url` es `NOT NULL`, pero el dataset no tiene URL de
producto. Antes de romper el esquema o de inventar una URL de tienda (que
acabaría siendo un enlace roto en un botón de «Comprar»), se usa
`dataset://<dataset>/<id>`, explícitamente **no navegable**.

La API expone `productUrl: null` para estas fichas, **en el contrato y no en cada
consumidor**, para que ninguna UI pueda ofrecer compra por descuido.

### `availability` es `unknown`, no `dataset_demo`

La intención de marcar estas fichas como no comprables se cumple con
`origin = 'dataset_demo'`. `availability` se queda en `unknown` porque es la
respuesta honesta: no es que esté agotado, es que no lo sabemos y no lo sabremos
por esta vía.

Motivo técnico además del semántico: `Availability` está fijado como unión de
tres valores en cuatro contratos distintos (`lib/matching/types.ts`,
`catalogClient.ts`, `catalogService/types.ts`, `normalize.ts`) que consume el
estudio. `Origin` tenía dos consumidores. Ampliar `Origin` es la costura
correcta, y además ya era una columna indexada y filtrable.

### Deduplicación exacta, no difusa

`ingestProduct` se llama con `exactDedupOnly: true`. Dos razones medidas:

- **Coste.** Los niveles difusos recorren `store.allProducts()`, que trae hasta
  5.000 documentos jsonb completos (con embeddings) por CADA producto que no
  case por un nivel exacto. Un producto nuevo nunca casa, así que importar 1.000
  fichas nuevas serían 1.000 escaneos completos: gigabytes de egreso de Supabase para
  no encontrar nada.
- **Corrección.** Con ids únicos por construcción, el id ES la autoridad y el
  nivel difuso solo puede equivocarse. Y se equivoca justo con fotos de catálogo
  sobre fondo blanco, que es lo que hay aquí: el mismo fallo que fusionó tres
  productos de Ecoalf.

### Concurrencia dentro del lote

Medido: en serie, 100 fichas tardaron **236 s** (2,4 s por ficha) con CLIP
costando solo 37 ms. El resto era latencia de red en serie: descarga de imagen,
subida a storage y tres o cuatro viajes a Supabase (eu-central-1).

Con `ROW_CONCURRENCY = 6`: **0,58 s por ficha**, 4× más rápido. No se sube más
porque el pool de Supabase es de 5 conexiones por proceso y HuggingFace responde 429.

---

## Deduplicación

Clave primaria de identidad: **`(source, source_product_id)`**, que es el índice
único `idx_products_source_pid`. `source` es el id del dataset y
`source_product_id` es el `id` de la fila, así que la idempotencia es **por
construcción, no por suerte**.

Fallback: `source + imageHash` (sha256 de la imagen optimizada). Esto captura
filas distintas con la MISMA foto exacta — y es real: en la importación de 1.000
filas aparecieron **5 casos**, que se reportan como `duplicates`, no como
`created`.

Verificado en real:

```
1.ª importación de 1000:  895 creados · 100 actualizados ·  5 duplicados ·  900 imágenes subidas
2.ª importación de 1000:    0 creados · 995 actualizados ·  5 duplicados ·    0 imágenes subidas
                                                                          (1000 ya existían)
```

Las imágenes tampoco se resuben: `blobPut` comprueba antes si el objeto existe
(`imagesSkipped`).

### `updated` significa «cambió de verdad»

Los contadores distinguen **`updated`** (existía y el contenido cambió) de
**`unchanged`** (existía idéntica; solo se refrescó `lastSeenAt`).

No es cosmética. Se corrigió el mapeo que clasificaba 22 perfumes como
`bodysuit`, se reimportaron las 1.000 fichas, el job reportó «995 actualizados»…
y los perfumes seguían siendo bodies. La causa: `computeContentHash` no incluía
la taxonomía, así que el cambio de categoría era invisible al detector de cambios
y `ingestProduct` solo tocaba `lastSeenAt`. El contador lo tapaba.

Dos arreglos, y el segundo es el que importa:

1. `computeContentHash` ahora incluye `category`, `subcategory` y `gender`. La
   categoría decide con qué casa un producto en el matching, así que cambiarla
   **es** cambiar la ficha. Coste: una reescritura por producto la primera vez.
2. El contador usa `IngestResult.changed`. Un contador que dice «995
   actualizados» cuando no se ha reescrito un solo campo no es un detalle
   estético: es lo que impidió ver el bug.

---

## Imágenes

**Los binarios NUNCA van a Postgres** (regla del repositorio: Supabase cobra por
almacenamiento y transferencia, y los blobs revientan los backups). En la base
van la URL y los hashes.

```
catalog/datasets/fashion-product-images-small/<sourceProductId>.jpg
```

La ruta es **determinista**: reimportar la misma ficha da la misma clave y no
duplica el objeto.

Por imagen: se valida el MIME leyendo la cabecera real con `sharp` (el
`Content-Type` del servidor no basta — un HTML de error servido como
`image/jpeg` pasaría el filtro), se aplica la orientación EXIF, se optimiza a
512 px máximo, se calculan sha256 y dHash de 64 bits **sobre el buffer
optimizado**, y se sube.

Miniatura: solo se genera si la imagen supera los 128 px de ancho. Las del
dataset son de 60×80, así que una «miniatura» sería del mismo tamaño; duplicar el
objeto costaría el doble de PUTs y de almacenamiento para servir los mismos
píxeles. En ese caso `thumbUrl` reutiliza la principal.

### Storage

`STORAGE_PROVIDER=vercel_blob` con `BLOB_READ_WRITE_TOKEN`.

> **Aviso que aparece antes de importar, no después.** Si el storage no es
> persistente, el importador lo dice y sigue (una importación de solo metadatos
> es útil), pero deja claro que las imágenes no sobrevivirán a un reinicio.
> `isPersistentStorage()` distingue «implementado» de «persistente»: el proveedor
> `local` sirve desde memoria con TTL de 15 minutos.

Esto **arregla además un bug preexistente**: las imágenes del scraper iban a
`os.tmpdir()`, que en serverless se borra en cada cold start, así que
`reindex_embeddings` no encontraba ninguna imagen y se saltaba el embedding en
silencio. `loadProductImageBytes()` ahora usa la URL persistida y el disco solo
como atajo heredado.

---

## Embeddings

| Proveedor | Dimensión | ¿Semántico? |
|---|---|---|
| `local` (CLIP `Xenova/clip-vit-base-patch32`) | 512 | **Sí** |
| `hash` (dHash 64 bits + histograma) | 64 | **No** |

```env
CATALOG_IMAGE_EMBEDDING_PROVIDER=local
```

> El proveedor `hash` **no es un embedding visual**. El propio código lo
> documenta así y está medido: con recorte al 60 % el score baja a 0,574 contra
> un umbral de 0,82. Nunca se presenta como embedding real: la API devuelve
> `productionGradeEmbeddings: false` y la UI lo avisa.

Instalación (el paquete no es dependencia por defecto para no cargar el runtime
de ONNX en el bundle):

```bash
npm install @huggingface/transformers   # ~90 MB de modelo la primera vez
```

Medido: 37 ms por imagen en CPU, así que 1.000 embeddings son ~40 s.

### Estados

`pending` → `processing` → `ready` · `failed` · `skipped`

Existen porque `image_embedding is not null` no distingue tres casos que hay que
tratar distinto: nunca intentado, intentado y fallido, y omitido a propósito. Sin
la distinción no se puede reintentar solo lo fallido.

Matiz: sin imagen persistida el estado es `skipped`, no `pending`. `pending`
promete que el reindexado podrá procesarlo; sin imagen eso es imposible y
prometerlo sería mentir.

```bash
npm run catalog:embeddings:reindex -- --status          # reparto real
npm run catalog:embeddings:reindex -- --source=fashion-product-images-small
npm run catalog:embeddings:reindex -- --only-missing
```

> **Índice mixto.** Vectores de 64d y de 512d en la misma columna hacen que
> `matchProducts` descarte en silencio los de dimensión distinta a la consulta:
> un reindex a medias parece funcionar y en realidad no busca nada. Por eso se
> guardan `embedding_provider` y `embedding_dimension`, y `--status` avisa cuando
> detecta más de una dimensión.

---

## Jobs y logs

Tipo de job: **`dataset_import`**. Estados:

```
queued → downloading → normalizing → uploading_images → saving → embedding
       → completed | partially_completed | failed | cancelled
```

Métricas en `/admin/jobs`: filas leídas, creados, actualizados, duplicados,
omitidos, errores, `imagesUploaded`, `imagesSkipped`, `embeddingsReady`,
`embeddingsQueued`, duración, progreso y checkpoint.

Logs por etapa en `catalog_job_logs`, visibles en la consola del job:

```
INFO    DATASET       Cargando metadata del dataset
SUCCESS DATASET       Dataset alcanzable vía huggingface
INFO    EMBEDDING     Proveedor de embeddings: local
INFO    JOB           Procesando 1–25 de 1000
SUCCESS DOWNLOAD_IMAGE 15970.jpg subida
SUCCESS DATABASE      Producto 15970 creado
WARN    DOWNLOAD_IMAGE Imagen corrupta, omitida: formato no soportado
SUCCESS COMPLETE      895 creados · 100 actualizados · 0 omitidos · 0 errores
```

### Reanudación

El checkpoint es **un número**: la siguiente fila del split.

```json
{ "datasetId": "…", "options": {…}, "nextOffset": 450, "endOffset": 1000,
  "counters": {…}, "version": "3620d0d5…" }
```

```bash
npm run catalog:dataset:resume -- <jobId>
npm run catalog:dataset:resume              # el más reciente reanudable
```

Reanudar crea un job NUEVO que arranca en el checkpoint del anterior, en vez de
resucitar el original: así el histórico conserva por qué se cortó el primero.

En serverless el importador respeta un presupuesto de tiempo
(`VERCEL_FUNCTION_MAX_DURATION` menos 15 s) y sale limpio con checkpoint antes de
que la plataforma mate el proceso.

---

## Comandos

```bash
npm run catalog:dataset:inspect
npm run catalog:dataset:import
npm run catalog:dataset:resume
npm run catalog:dataset:cleanup
npm run catalog:dataset:brands
npm run catalog:embeddings:reindex
```

### Opciones de `import`

| Opción | Default | |
|---|---|---|
| `--source` | `huggingface` | `huggingface` \| `kaggle` |
| `--limit` | `1000` | filas a importar |
| `--offset` | `0` | primera fila |
| `--batch-size` | `25` | se acota a 100 (máximo del endpoint) |
| `--categories` | — | `Apparel,Footwear` (masterCategory o subCategory) |
| `--genders` | — | `Men,Women` |
| `--upload-images` | `true` | |
| `--generate-embeddings` | `true` | |
| `--dry-run` | `false` | no escribe nada |
| `--dataset` | `fashion-product-images-small` | |

```bash
npm run catalog:dataset:import -- --source=huggingface --limit=1000 --batch-size=25
npm run catalog:dataset:import -- --limit=500 --categories=Apparel,Footwear --generate-embeddings=false
npm run catalog:dataset:import -- --limit=10 --dry-run
npm run catalog:dataset:cleanup -- --dry-run
npm run catalog:dataset:cleanup -- --yes
```

`cleanup` borra las imágenes del storage ANTES de las filas: si falla el borrado
de storage, los productos siguen en la base y el comando se puede repetir. Al
revés quedarían objetos huérfanos sin ninguna fila que dijera de dónde salieron.

---

## API

| Ruta | Método | |
|---|---|---|
| `/api/catalog/datasets` | GET | datasets registrados + estado del storage |
| `/api/catalog/datasets/inspect` | POST | esquema real, sin escribir |
| `/api/catalog/datasets/import` | POST | 202 + jobId (200 + muestra si `dryRun`) |
| `/api/catalog/datasets/resume/[jobId]` | POST | reanuda desde checkpoint |
| `/api/catalog/datasets/test-match` | POST | matching con un producto aleatorio |
| `/api/catalog/products/reindex` | POST | acepta `source` y `onlyMissing` |

`limit` está topado en 5.000 por petición: un cero de más en el formulario no
debe encolar una importación de 44.000 fichas.

Filtros de `/api/catalog/products` (todos **en servidor**): `source`, `category`,
`brand`, `color`, `gender`, `origin`, `embeddingStatus`, `active`, `q`.

> Antes `origin` se filtraba en el cliente sobre la página cargada, con un aviso
> de que solo aplicaba a esos 24 resultados. Con miles de fichas eso no es un
> filtro: mostraba «0 resultados» cuando sí había, solo porque no caían en la
> página visible.

---

## Admin

`/admin/catalog` → panel **«Importar catálogo de demostración»**.

- **Acciones:** Inspeccionar · Importar 100 · Importar 1.000 · Personalizada ·
  Ensayo · Probar matching · Cancelar · Reanudar
- **Campos:** fuente, cantidad, offset, tamaño de lote, categorías, género,
  subir imágenes, generar embeddings
- **Avisos permanentes:** los campos que el dataset no trae, la licencia, y si el
  storage no es persistente

En el catálogo, las fichas llevan la etiqueta **«Demo»**, muestran «Precio no
disponible en dataset» en lugar de un hueco, y el cajón de detalle incluye la
procedencia (repo, revisión, fila, fecha) y los atributos propios del dataset
(masterCategory, articleType, baseColour, season, year, usage). Donde iría
«Comprar» aparece «Sin ficha de tienda (producto de catálogo demo)».

### Probar matching

`Probar matching` coge una ficha al azar, descarga **su propia imagen** del
storage y la busca en el catálogo. Si una ficha no aparece al buscar con su
propia foto, el índice está roto **aunque el resto de resultados parezca
razonable** — y eso es un fallo que de otro modo no se nota.

Resultado real (CLIP 512d, 1.045 fichas indexadas):

```
TARGET: 47165 Peter England Men Black Belt · cat: belt · 512d

 1. 0.9117 perceptual_hash  47165  Peter England Men Black Belt        <== SELF
 2. 0.9053 embedding        18839  Peter England Men Formal Black Belt
 3. 0.8988 embedding        15941  Turtle Men Leather Black Belts
 4. 0.8988 embedding        18801  Peter England Men Casual Brown Belt
 5. 0.8985 embedding        16992  Puma Women Dizzy Black Belt
```

Los diez resultados son cinturones: es matching visual real, no ruido de hash.

---

## Variables de entorno

```env
HF_TOKEN=                                  # opcional: el dataset es público
KAGGLE_USERNAME=                           # solo para el fallback
KAGGLE_KEY=
CATALOG_DATASET_SOURCE=huggingface
CATALOG_DATASET_DEFAULT_LIMIT=1000
CATALOG_DATASET_BATCH_SIZE=25
CATALOG_DATASET_UPLOAD_IMAGES=true
CATALOG_DATASET_GENERATE_EMBEDDINGS=true

STORAGE_PROVIDER=vercel_blob
BLOB_READ_WRITE_TOKEN=
CATALOG_IMAGE_EMBEDDING_PROVIDER=local
```

El fallback de Kaggle solo se activa si hay credenciales **y** la cuenta ha
aceptado las condiciones del dataset en la web. Sin ese paso la API responde 403 y
no hay forma de sortearlo programáticamente; cuando pasa, se dice exactamente eso
en vez de un error de red genérico.

---

## Limitaciones conocidas

1. **Licencia no declarada.** Demo e investigación. No redistribuir.
2. **Sin datos comerciales.** Por diseño del dataset, no del importador.
3. **Imágenes de 60×80 px.** Suficientes para CLIP (entrada de 224 px) pero
   pobres para mostrar en grande.
4. **Marca solo en ~50 % de las fichas.** Es el precio de no inventarla.
5. **La búsqueda vectorial NO usa pgvector.** `matchProducts` carga hasta 5.000
   documentos y puntúa en memoria: ~5 s con 1.000 fichas. Las columnas
   `image_embedding`/`text_embedding` se escriben pero no se leen para buscar, y
   no existe índice ANN. Es una limitación **preexistente**, no introducida aquí,
   pero se vuelve visible a esta escala. El arreglo es un índice ivfflat y mover
   el coseno a SQL.
6. **`Personal Care` entra por defecto.** El dataset incluye perfumes y
   cosmética. Se clasifican honestamente (`fragrance`, `makeup`, familia
   `beauty`), pero si solo se quiere ropa hay que filtrar:
   `--categories=Apparel,Footwear`.
7. **Vocabulario de categorías incompleto.** Algunos `articleType` no tienen
   canónico y pasan tal cual (`briefs`, `bra`, `camisoles`, `night suits`). Es el
   fallback documentado de `normalizeCategory`, y es preferible al mapeo forzado:
   fue exactamente así como 22 perfumes acabaron clasificados como `bodysuit`
   antes de corregirlo.
8. **`@huggingface/transformers` trae su propio `sharp`.** Convive con el del
   proyecto y macOS avisa de libvips duplicado. Funciona, pero es una colisión
   que conviene vigilar.

---

## Tests

```bash
npm test
```

| Fichero | Cubre |
|---|---|
| `test/catalogIngestion/datasetBrands.test.ts` | que NO se inventan marcas, alias, poda de sub-marcas, excepciones |
| `test/catalogIngestion/datasetNormalize.test.ts` | campos a null, mapeo, «NA», evidencia, categorías |
| `test/catalogIngestion/datasetReader.test.ts` | paginación, `id` nulo, reintentos, 404 sin reintento |
| `test/catalogIngestion/datasetImages.test.ts` | validación, hashes deterministas, storage persistente |
| `test/catalogIngestion/datasetImporter.test.ts` | idempotencia, reanudación, fallo parcial, cancelación, filtros |

Los tests del importador **inyectan un lector falso**: la idempotencia y la
reanudación no dependen de HuggingFace, y hacerlas depender de la red daría tests
lentos, frágiles y sujetos a que un dataset ajeno no cambie.

Tres bugs los encontraron estos tests, no la revisión a ojo:

- `Number(null)` es `0`, que es finito: una fila con `id: null` entraba al
  catálogo como el producto «0».
- El `throw` de «esto no tiene arreglo» vivía dentro del mismo `try` que el
  `fetch`, así que el `catch` del reintento lo capturaba: el código decía que no
  reintentaba un 404 y lo reintentaba cuatro veces (7 s en lugar de 3 ms).
- Con todas las filas compartiendo la misma imagen, el dedup por
  `exact_image_hash` las fusionaba en una. Comportamiento correcto, y la pista de
  que los 5 «duplicados» de la importación real son fotos idénticas.
