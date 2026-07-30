# Auditoría — Motor de identificación exacta de productos

Fecha: 2026-07-10. Objetivo: pasar de "descripción genérica + botones de
búsqueda manual" a "producto identificado con imagen real, marca, tienda,
precio, enlace directo y evidencia del match".

## 1. Arquitectura actual REAL (verificada en código)

El pipeline de matching exacto **ya existe** y está más completo de lo que la
UI sugiere. Flujo actual en modo vídeo:

```
Frame (canvas, ≤1280px)  lib/frameCapture.ts
  → detección OpenAI Vision streaming (bounding boxes 0-1 obligatorias)  lib/vision.ts
  → cards pintadas al instante  (detección NO espera al matching)
  → cola de matching cliente (máx 3 concurrentes, 3/frame, conf ≥ 0.55)  hooks/useObjectMatching.ts
      → crop REAL por objeto (padding 10%, clamp, ≤640px)  lib/crop.ts + lib/cropBox.ts
      → POST /api/vision/match-object   (SERVIDOR; la API key nunca va al navegador)
          1. cache por sha256 del crop (TTL configurable)          lib/visualSearch/cache.ts
          2. presupuesto por vídeo (EUR + nº requests)             lib/server/searchBudget.ts
          3. publicación del crop en Supabase Storage (URL pública) lib/visualSearch/storage.ts
             + 2ª pasada de detalle del crop (OCR/marca) en paralelo lib/visualSearch/cropEnrichment.ts
          4. ReverseImageOrchestrator                              lib/visualSearch/reverseImage/orchestrator.ts
             - Estrategia A (normal): search_type=all → escala a products si pobre
             - Estrategia B (premium: reloj/bolso/zapatillas/logo/electrónica…):
               exact_matches + products + visual_matches EN PARALELO
             - SearchAPI Google Lens primario, SerpAPI fallback real
               (solo con 401/429/timeout/0 resultados; circuit breaker 60s)
          5. enriquecimiento DataForSEO Shopping SOLO si Lens trajo <2 comprables
          6. re-ranking propio (no el orden de Google)             lib/visualSearch/rank.ts
          7. buildVisualMatch → exact / near_exact / similar        lib/visualSearch/engine.ts
          8. persistencia: crop → detected_items.image_crop_url;
             candidatos → product_recommendations (con match_type)
  → la card se actualiza con visual_match / matchingStatus
```

- `exact_matches`, `products` y `visual_matches` **sí se procesan** (providers
  normalizados en `lib/visualSearch/reverseImage/providers.ts` →
  `NormalizedVisualResult`, mismo modelo `VisualCandidate` para todos).
- Cache, coste (`lib/server/costTracker.ts` con `callsByProvider`), dedup por
  URL/dominio+título, timeouts con AbortController y breaker existen.
- El vídeo nunca se bloquea: la cola es asíncrona y descarta duplicados por
  fingerprint.

## 2. Respuestas a las preguntas de la auditoría

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | Descripción del objeto | La genera OpenAI Vision (`lib/vision.ts`, prompt exige atributos/OCR/logo y prohíbe inventar marcas) |
| 2 | El "95%" | Es `item.confidence` de DETECCIÓN, renderizado como "95% confianza" ambiguo en `components/ProductCard.tsx` → **P0 corregido** |
| 3-5 | Crop | Se genera (`lib/crop.ts`), se publica con URL pública (Supabase Storage, hash-idempotente) y desde 2026-07-09 se persiste en el item |
| 6-10 | SearchAPI | Se llama de verdad (`SearchApiGoogleLensProvider`), con `search_type` adaptativo y los 3 tipos procesados |
| 11 | DataForSEO | Solo como enriquecimiento post-Lens (paso 6), nunca como detector inicial ✓ |
| 12 | Por qué siguen saliendo búsquedas manuales | (a) credenciales rotas en el entorno actual → 0 candidatos → la card cae a los deep-links; (b) la card mostraba SIEMPRE los botones manuales aunque hubiera match → **P0 corregido** |
| 13-14 | Selección/scoring | `rankCandidates` + `scoreCandidate` (exact_image +100, marca +50, OCR +40, color +15, categoría +10, tienda fiable +30/-20, posición Lens +45/25/10, precio +8) con `scoreBreakdown` por candidato |
| 15 | Persistencia | `product_recommendations` (imagen, URL, merchant, precio, score, match_type) + crop en el item |
| 16 | Supabase caído | Circuit breaker → catálogo en memoria; crop como data URL (`local_only`); el flujo no se rompe |
| 17 | SearchAPI caído | Breaker 60s → SerpAPI fallback con `fallbackUsed/fallbackReason`; si todo falla → `provider_error` en la card |
| 18 | Sin match fiable | `buildVisualMatch` devuelve null → estado `no_match` → la card ofrece búsqueda manual |

## 3. Causas del resultado genérico del screenshot

1. **Credenciales**: SearchAPI sin key válida en el entorno actual, SerpAPI
   401, Supabase Storage con key inválida (sin URL pública → Lens ni se
   intenta y devuelve `storage_unavailable`). Con 0 candidatos, la card cae a
   los deep-links de Amazon/Google Shopping. *No es un problema de código:
   el panel de costes mostraba "Matching productos: 0 llamadas" por esto.*
2. **UI ambigua**: un único "95% confianza" (detección) sin score de matching.
3. **Botones manuales siempre visibles**, incluso con match — parecían el
   resultado principal.
4. **Umbral demasiado laxo**: `MIN_MATCH_SCORE=35` (~0.23 normalizado)
   permitía presentar como "similar" candidatos débiles; sin clase
   "no fiable" explícita ni umbrales configurables.
5. **Sin evidencia legible**: el `scoreBreakdown` existía pero no se traducía
   a "coincide en: patrón, color, tienda oficial…".

## 4. Implementado en este cambio (P0)

- **Separación detección/matching**: badge "N% detección" (tooltip) + badge
  "N% coincidencia" (tooltip) derivado del score de matching normalizado.
  `matchConfidence = min(score/150, 1)` — la misma normalización ya usada
  para `similarity_score` en el catálogo.
- **Umbrales configurables** (`lib/visualSearch/matchConfidence.ts`):
  `MATCH_EXACT_THRESHOLD` (0.90), `MATCH_NEAR_EXACT_THRESHOLD` (0.70),
  `MATCH_SIMILAR_THRESHOLD` (0.30 por defecto; sube a 0.60 para demo estricta).
  Reglas duras además del umbral: **exact exige `exact_image_match` del
  proveedor** (nunca solo texto); near_exact exige corroboración de
  marca/OCR o superar el umbral con evidencia visual. Bajo el umbral similar
  → **no fiable** → `buildVisualMatch` devuelve null → la UI NO lo presenta
  como producto.
- **Evidencia legible**: `evidenceLines(scoreBreakdown)` → "✓ Imagen
  idéntica", "✓ Marca coincide", "✓ Texto visible", "✓ Color", "✓ Tienda
  fiable", "✗ Tienda desconocida"… mostrada en la card ("Coincide en:") y
  persistible vía reason.
- **VisualMatch ampliado**: `match_confidence` (0-1) y `evidence: string[]`.
- **Botones manuales = solo fallback**: con match exact/near_exact los
  enlaces "Buscar en Amazon/Google Shopping" se pliegan en un `<details>`
  ("¿No es tu producto?"); sin match fiable se muestran con el mensaje
  explícito "No encontramos una coincidencia suficientemente fiable".
- **Gate de calidad del crop**: además del lado mínimo (48px), área mínima
  configurable `NEXT_PUBLIC_MIN_PRODUCT_PIXEL_AREA` (18000 px²) — no se
  gasta API en crops sin señal.
- **Panel de debug por item** (oculto en modo presentación): proveedor usado,
  fallback, cache hit, latencia total, detalle del error, score y desglose.
- **Marcas**: ya existía la separación `visible_brand` (verificada, con
  `brand_evidence`) vs `brand_guess` (probable, se muestra "≈ marca?") vs
  desconocida; documentado y cubierto por el prompt de visión ("NUNCA
  inventes marcas"). Sin cambios de fondo necesarios.

## 5. Qué NO se ha tocado (deliberado)

- Endpoints: `/api/vision/match-object` ya cumple el rol de
  `POST /api/visual-search/match` (síncrono, ~2-8s con timeout 10s por
  proveedor). No se añadió una capa de jobs (`status/:jobId`) porque la cola
  cliente ya da el comportamiento asíncrono y sería una app paralela.
- DataForSEO como enrichment ya está integrado en el paso 6 del endpoint.
- Storage compartido: `uploadFramePublic` (hash idempotente). La abstracción
  `CropPublishingProvider` formal queda en P1 (hoy solo hay un proveedor).

## 6. Plan P1 / P2

**P1**: abstracción de storage multi-proveedor con TTL/limpieza; estrategia
"esperar mejor frame" para objetos pequeños (guardar mejor crop por calidad);
DataForSEO en background con actualización push de la card (hoy es inline
pero acotado); breaker persistente entre procesos; afinado de pesos por
categoría (`MATCH_WEIGHT_*`).

**P2**: embeddings visuales propios para visualScore real (hoy se usa la
posición de Lens como proxy); disponibilidad/stock; afiliación; job queue
con `jobId` para escalado multi-instancia.

## 7. Bloqueos de entorno (no de código)

Para que el caso de la camisa produzca un match real hacen falta:
`SEARCHAPI_API_KEY` válida (o `SERPAPI_API_KEY`), y `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` + bucket público (`STORAGE_BUCKET`) para publicar
el crop. Con las credenciales actuales rotas, el flujo degrada limpiamente a
"Búsqueda externa no disponible" + búsqueda manual, sin inventar productos.
