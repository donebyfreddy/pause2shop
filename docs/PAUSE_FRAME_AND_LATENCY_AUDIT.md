# Pause2Shop — auditoría de frame pausado y latencia

Fecha: 2026-08-02

## Alcance inspeccionado

Se siguió el flujo completo de vídeo directo/subido desde
`VideoProviderAnalyzer` hasta `useVideoCaptureEngine`, `useFrameAnalysis`, los
handlers de visión, `useObjectMatching` y `/api/vision/match-object`. También se
revisaron `currentTime`, `drawImage`, `requestVideoFrameCallback`, cachés,
redondeos, throttling, jobs activos y los estados React que pintan el overlay.

## Diagnóstico exacto

El frame incorrecto no tenía una causa única; era la combinación de cuatro
condiciones reproducibles:

1. El listener `onPause` llamaba a `directEngine.captureNow()`. Ese motor
   rechazaba la captura si `analyzing === true`, por lo que una pausa durante un
   preanálisis conservaba en pantalla las cajas del análisis anterior.
2. `captureNow()` ejecutaba `drawImage(video, ...)` inmediatamente desde el
   evento `pause`, sin comprobar el último `metadata.mediaTime` realmente
   presentado. En un seek/decodificación pendiente, `currentTime` y el frame
   enviado al compositor no tienen por qué coincidir aún.
3. El timestamp se convertía con `Math.round(video.currentTime)`. Esto perdía
   hasta 500 ms y hacía que frames distintos compartieran la misma clave de
   caché `${videoKey}:${segundo}`.
4. `useFrameAnalysis` usaba un booleano global `inFlight`: no abortaba el
   request anterior, descartaba la nueva petición de pausa mientras hubiese una
   activa y no verificaba `sessionId`, `frameId` ni `mediaTime` antes de hacer
   `setState`. Una respuesta antigua podía convertirse en el overlay vigente.

Además, las cajas se pintaban directamente desde el último `analysis` global,
incluso al reanudar el vídeo. Esto permitía ver detecciones pertenecientes a un
timestamp anterior sobre frames nuevos.

### Causas descartadas o secundarias

- No había un debounce explícito en `pause`; sí existían un throttling local de
  400 ms, un intervalo remoto de 1,5–3 s y deduplicación por segundo redondeado.
- `requestVideoFrameCallback` existía, pero solo contaba frames; su metadata no
  se guardaba ni participaba en la captura de pausa.
- El canvas no era persistente ni estaba cacheado. El problema era cuándo se
  dibujaba y qué respuesta terminaba actualizando React.
- Los jobs server-side no sobrescribían el estudio; la carrera ocurría en los
  fetches del cliente y en su estado compartido.

## Instrumentación añadida

El modo debug registra y muestra:

- `pauseEventCurrentTime`
- `videoCurrentTime`
- `presentedFrameMediaTime`
- `capturedFrameTimestamp`
- `requestStartedAt`
- `requestCompletedAt`
- `analysisSessionId`
- `frameId`

También expone `pauseToCaptureMs`, `captureToDetectionMs`,
`detectionCacheHit`, `cropMs`, `embeddingMs`, `vectorSearchMs`, `rankingMs`,
`catalogFirstResultMs`, `externalSearchMs` y `totalMs`.

## Corrección de captura

`ExactPausedFrameCapture` mantiene por separado:

- `lastPresentedFrame`: metadata del último frame entregado al compositor;
- `lastAnalyzedFrame`: entrada del caché de detección/preanálisis;
- `pausedFrame`: blob SHA-256 del frame que se congela y se muestra al usuario.

Al pausar se compara `video.currentTime` con `metadata.mediaTime`. Si la
diferencia es `<= 80 ms`, se captura el frame visible ya presentado. Si la
diferencia es mayor, se crea un vídeo gemelo fuera de pantalla, se hace seek al
tiempo solicitado, se esperan `seeked` y un nuevo
`requestVideoFrameCallback`, y solo entonces se ejecuta `drawImage`.

Cada captura cumple el contrato `CapturedVideoFrame` con id, vídeo, tiempos,
dimensiones, blob y hash. La imagen congelada se superpone al `<video>` hasta
que el usuario reanuda.

## Protección contra respuestas antiguas

Cada pausa genera una identidad `{ sessionId, frameId, mediaTime }` y un
`AbortController`. Una nueva captura aborta la anterior. Los endpoints devuelven
la identidad recibida y el cliente solo acepta el stream o JSON si los tres
campos coinciden dentro de 80 ms. Los eventos parciales del stream también se
ignoran en cuanto su versión deja de ser activa.

## Arquitectura de latencia resultante

### Fast path

`frame exacto -> caché de detecciones -> cajas clicables`

Durante la reproducción se muestrea a 1 FPS como máximo, con diferencia de
escena, hash/deduplicación y una ventana de caché de 120 s. Al pausar se toma la
entrada más cercana dentro de 250 ms. Si no existe, se lanza detección sobre el
frame exacto; el canvas no espera catálogo ni Internet.

### Matching path

`clic -> crop cacheado -> embedding -> HNSW/pgvector -> ranking -> panel`

El análisis de vídeo ya no llama `matching.enqueue()` para todos los objetos.
El clic prioriza un único objeto al principio de la cola y reutiliza el crop por
`videoId + frameHash + detectionId`. El backend ya incluye modelo y versión del
índice en la clave del caché de catálogo. La migración
`20260801000010_vector_index.sql` crea el índice HNSW coseno.

### Fallback path

`sin match -> búsqueda externa automática en background -> candidato revisable`

El navegador hace una primera petición `catalog_only` y publica ese bloque en
cuanto llega. Solo si queda `empty/unresolved` lanza una segunda petición
`external_only`; por eso Internet no puede retrasar ni borrar el resultado del
catálogo. Las noticias, redes, personas, piezas editoriales y resultados sin
señal comercial se eliminan antes del ranking. El botón manual queda reservado
a `Reintentar búsqueda externa` tras un error o resultado no resuelto.

Los resultados fiables ya no llaman a `/products/external` desde el matching.
Se guardan en `external_product_candidates` con URL, imagen original, merchant,
proveedor, scores, evidencia, crop y fecha. Solo la acción de aprobación del
admin cambia `review_required -> approved`, crea/indexa el producto y termina
en `published`.

## Reanudación y dos modos

La pausa directa usa un `PlayerAnalysisState` explícito: `playing`, `pausing`,
`paused_ready`, `detecting`, `matching` y `resumed`. El frame congelado incluye
`PausedFrameToolbar` y `ResumeVideoButton`; botón, controles nativos, Espacio y
K llaman a `video.play()` sobre el mismo elemento y timestamp. `onPlay` invalida
la sesión visual, oculta cajas y panel, pero conserva los cachés.

Antes de cargar contenido se elige entre:

- **En directo**: captura exacta, detecciones anticipadas y matching al clic.
- **Vídeo preprocesado**: recorrido completo, escenas, tracking, dedup global,
  mejor crop, catálogo primero y candidatos externos.

El modo preprocesado calcula SHA-256 sobre los bytes del archivo. Un job
`completed/partially_completed` con el mismo hash, `CATALOG_VERSION` y
`VIDEO_ANALYSIS_VERSION` se devuelve sin extraer frames. La reproducción puede
consultar `/api/analysis/videos/:hash?time=` para recuperar los productos del
rango temporal.

La migración `20260802000012_video_processing_candidates.sql` añade identidad
versionada, ocurrencias por timestamp, productos no resueltos, candidatos y
subjobs persistentes/idempotentes de tipos `video_preprocess`, `catalog_match`,
`external_product_search`, `catalog_candidate_review` y
`catalog_product_enrichment`.

## Medición

La línea base funcional era la observada en el producto antes del cambio:

| Métrica | Antes |
| --- | ---: |
| pausa -> frame fiable | no garantizado; la captura podía descartarse |
| error de timestamp por redondeo | hasta 500 ms |
| pausa -> resultado completo | 15–20 s reportados |
| peor caso de matching por objeto documentado en código | ~25 s |
| Internet en camino crítico | sí, según modo/fallback |

Medición posterior (Chromium, vídeo WebM real generado a 12 FPS; servicios de
visión/matching simulados en E2E para aislar la UI, y catálogo real aparte):

| Métrica | Después |
| --- | ---: |
| pausa -> frame congelado | 19–29 ms |
| captura -> cajas (fast path E2E) | 68–84 ms |
| crop en navegador | ~1 ms |
| embedding CLIP caliente real | p50 45,0 ms |
| procesado crop completo real | p50 47,0 ms |
| consulta HNSW dentro de Postgres (1.000 productos) | p50 0,7 ms |
| consulta HNSW vista desde este equipo (RTT remoto ~306 ms) | p50 177,8 ms |
| `matchProducts` real con 1.048 productos indexados | p50 204,3 ms |
| clic -> resultado catálogo en E2E progresivo actual | 85–96 ms |
| catálogo -> fallback externo simulado (background) | 214–228 ms adicionales |
| flujo completo de fallback simulado | 310–324 ms, sin bloquear cajas |

El objetivo de `<100 ms` para la consulta vectorial se cumple dentro de la base
de datos. Desde desarrollo remoto domina la red; en producción la función y
Postgres deben permanecer en la misma región. El E2E no usa los 15–20 s de un
proveedor real: prueba que esos proveedores ya no bloquean frame, cajas ni
interacción. Las capturas verificadas están en
`test-results/pause-click-to-shop/`.

## Pruebas que cubren la regresión

- selección del frame de 5,00 s frente al anterior;
- rechazo de una respuesta de 4,00 s cuando la sesión activa es 5,00 s;
- invalidación de pausas consecutivas;
- caché temporal y deduplicación;
- overlay solo durante pausa;
- matching solo después del clic;
- catálogo antes de Internet;
- filtro de resultados externos no comerciales;
- reanudación sin cajas antiguas;
- panel lateral desktop, bottom sheet móvil y `prefers-reduced-motion`.

Resultado final: suite unitaria completa con código de salida 0, build y
typecheck correctos, lint sin errores y 12/12 escenarios E2E aprobados en los
proyectos Chromium desktop y móvil. Las capturas verificadas incluyen modo
preprocesado y fallback automático en `test-results/pause-click-to-shop/`.
