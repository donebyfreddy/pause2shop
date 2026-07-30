# Auditoría — Análisis continuo de vídeo, crops e identificación exacta

Fecha: 2026-07-10. Complementa `EXACT-PRODUCT-MATCHING-AUDIT.md` (motor de
matching) con el pipeline de VÍDEO: frecuencia de análisis, tracking, bounding
boxes, mejor crop y enriquecimiento.

## 1. Cómo se analizaba el vídeo ANTES de este cambio

- **No era "un frame aislado"**, pero tampoco por frame renderizado: un
  `setInterval` de 400ms (`useAutoCaptureInterval`) invocaba al scheduler
  (`useVideoCaptureEngine.captureAuto`), que decide el análisis remoto por
  diff de escena (thumbnail 32×18, umbral 0.10) + intervalo mín/máx
  (1.5s/3s). Los frames entre ticks no pasaban por ningún pipeline local.
- **La UI sí bloqueaba visualmente**: `AnalyzingOverlay` oscurecía y
  desenfocaba TODO el vídeo con "Analizando frame…" durante cada llamada de
  visión (15-30s en frames densos). El vídeo seguía reproduciéndose debajo,
  pero no se veía.
- **Sin tracking**: no había trackIds; la deduplicación era solo por
  fingerprint textual (nombre+categoría+color), así que dos tazas distintas
  con el mismo nombre colapsaban y no había noción de "mejor crop".
- **Bounding boxes**: el overlay usaba un canvas FIJO 1280×720 y multiplicaba
  las coordenadas normalizadas directamente — sin object-fit/letterboxing,
  sin devicePixelRatio, sin resize; labels superpuestas sin colisiones; sin
  NMS ni supresión de cajas gigantes (una "camisa" podía encuadrar media
  persona).
- **Crops**: se buscaba con el PRIMER crop disponible (sin esperar un
  encuadre mejor); solo había gates de lado mínimo (48px) y área (18000px²,
  añadido el 2026-07-10 previo).
- **cropEnrichment**: timeout 10s, `response_format: json_object` (sin
  schema), errores tragados en silencio (`catch { return null }`), y el merge
  daba prioridad a los valores de la primera pasada (`item.visible_brand ??
  details.visible_brand`) — un "desconocido" genérico bloqueaba el refinado.
  `refined_query` NO se perdía hacia SearchAPI (match-object la usa
  directamente: `cropDetails?.refined_query ?? …`), pero no se fusionaba al
  item ni se registraba.
- **Prioridad**: ninguna — una planta o una barandilla podía consumir una de
  las 3 búsquedas inversas del frame.

## 2. Qué se ha implementado (P0)

### Bucle por frame renderizado — `hooks/useVideoFrameLoop.ts`
`requestVideoFrameCallback` (fallback rAF): cada frame presentado incrementa
`processedFrameCount` y ejecuta el pipeline local; el scheduler remoto se
evalúa como mucho cada `NEXT_PUBLIC_VIDEO_FRAME_CHECK_INTERVAL_MS` (400ms) —
"procesar cada frame" ≠ llamar a OpenAI/Lens por frame. Publica stats (frames,
fps) a ≤2Hz para no re-renderizar 60 veces/s.

### UI no bloqueante
- `AnalyzingOverlay` ahora es una píldora compacta en la esquina
  ("Detectando objetos…") sin oscurecer ni desenfocar el vídeo.
- Indicador vivo: "● Analizando vídeo en tiempo real · Frame 428 · 30 fps ·
  7 objetos seguidos · 4 productos únicos · 2 identificados"
  (`analysisStats` desde `page.tsx`).

### Tracking — `lib/video/tracker.ts` (puro, testeado)
`TrackedProduct` con `trackId` persistente; asociación detección↔track por
IoU (≥0.3) + categoría + nombre corto; `seenFrameCount`, `bestBoundingBox` y
`bestCropQuality` (área×confianza); tracks `lost` a los 6s. La misma camisa
conserva su id; dos tazas distintas son dos tracks. Integrado en `page.tsx`
(se resetea al cambiar de vídeo/modo).

### Bounding boxes — `lib/video/boxMapping.ts` (puro, testeado)
- `mapNormalizedBoxToRenderedVideo()`: punto ÚNICO de conversión con
  object-fit contain/cover + letterboxing. El overlay ya no multiplica a mano.
- `isValidBox` (rango 0-1, área>0), `isOversizedBox` (>85% de la escena) y
  `suppressDuplicateBoxes` (NMS por categoría, IoU≥0.65) aplicados en
  `normalizeAnalysis` — la caja gigante se anula (el item se conserva).
- `VideoOverlay` reescrito: canvas dimensionado por ResizeObserver × DPR,
  aspecto real del vídeo (`onLoadedMetadata`), labels cortas
  ("Camisa floral · 95%") con resolución de colisiones (se desplazan), nombre
  completo en el panel lateral, y las cajas de prioridad baja no se pintan
  por defecto (`showLowPriority` para debug).

### Prioridad comercial — `lib/priority.ts` (puro, testeado)
`presentationPriority` (high/medium/low por categoría + purchase_relevance):
plantas/barandillas/estructuras = low → no se pintan por defecto y
**no consumen búsqueda inversa automática** (`deservesAutoSearch`).

### Mejor crop por producto — `hooks/useObjectMatching.ts`
`cropQualityScore` (área×confianza): si el crop es pobre
(< `NEXT_PUBLIC_MIN_CROP_SEARCH_QUALITY`), el objeto queda "Esperando un
encuadre mejor…" hasta `NEXT_PUBLIC_MAX_WAIT_FOR_BETTER_CROP_MS` (4s),
reemplazándose por cualquier encuadre mejor que llegue; si aparece uno
suficiente, se busca al instante. No se gasta API en crops sin señal.

### cropEnrichment corregido — `lib/visualSearch/cropEnrichment.ts`
- Timeout default 20s (`CROP_ENRICH_TIMEOUT_MS`).
- **Structured Outputs**: `response_format: json_schema` estricto
  (`additionalProperties:false`, enums, required, límites de arrays,
  crop_quality 0-1) + validador `coerceCropDetails`.
- `CropDetails` ampliado: tipo/subtipo, colores, patrón, material, silueta,
  marca con `brand_status` verified/probable/unknown + evidencia, **modelo**
  (`model_guess/status/evidence`), logo (posición), OCR, rasgos
  discriminantes, `negative_search_terms`, `refined_query`,
  `alternative_queries`, `crop_quality`, `enough_detail_for_exact_search`.
- Prompt profesional nuevo (reglas anti-alucinación de marca/modelo, query
  en inglés discriminante).
- **Errores visibles**: logs estructurados `crop_enrichment_failed`
  (reason/status/modelo/itemId/duración, sin secretos) y
  `crop_enrichment_completed` (query refinada, brand_status, calidad).
- **Merge corregido**: `normalizeNullableVisualValue` ("desconocido"/"n/a"…
  cuentan como null); el detalle del crop (más resolución) tiene prioridad
  sobre los genéricos de la primera pasada; una marca VERIFICADA previa solo
  cede ante otra verificada; `refined_query`, modelo y `brand_status` se
  fusionan al item y NUNCA se pierden.
- `DetectedItem` ampliado con `brand_status`, `model_*` y `refined_query`.

### Uso real de refined_query + logs de búsqueda
`match-object` ya usaba `cropDetails.refined_query` como query principal;
ahora además registra `reverse_search_started` (query, cropHash,
refinedQueryUsed, premium) y `reverse_search_completed` (proveedor, fallback,
nº resultados, latencia, llamadas por search_type) — queda demostrado en logs
qué recibe SearchAPI.

## 3. Qué queda (P1/P2)

- **P1**: Web Worker/OffscreenCanvas para el diff (hoy ~1ms en main thread,
  aceptable); tracker con apariencia visual (hash/embedding del crop);
  nitidez/oclusión reales en cropQuality (hoy proxy área×confianza);
  DataForSEO en background con push a la card (hoy inline acotado);
  re-detección forzada al perder tracking; "Otros objetos detectados" como
  sección plegada para prioridad baja.
- **P2**: segmentación de prendas (recortar piel/fondo dentro de la caja),
  embeddings visuales para matchConfidence real, job queue con `jobId`.

## 4. Bloqueos de entorno

Igual que en la auditoría de matching: sin `SEARCHAPI_API_KEY`/`SERPAPI_API_KEY`
válidas y sin Supabase Storage operativo, el pipeline degrada limpiamente
(estado "Búsqueda visual no disponible" + búsqueda manual) sin inventar
productos. Los contadores de frames/tracking funcionan igualmente.
