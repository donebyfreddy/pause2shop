# Auditoría — Pipeline de matching v4 (detección → crop → Lens → producto)

Fecha: 2026-07-10. Tercera auditoría de la serie (complementa
`EXACT-PRODUCT-MATCHING-AUDIT.md` y `CONTINUOUS-PRODUCT-ANALYSIS-AUDIT.md`).
Esta cubre los defectos internos del pipeline de búsqueda encontrados
revisando providers, orchestrator, cache, timeouts y la cola de matching.

## 1. Flujo real (respuestas 1-13 de la auditoría)

1-4. **Frames/crops/enrichment**: documentado en
`CONTINUOUS-PRODUCT-ANALYSIS-AUDIT.md` — rVFC por frame, detección remota por
diff de escena (1.5-3s), crop por objeto con espera de mejor encuadre,
enrichment gated (ahora `shouldEnrichCrop`, no solo premium).

5. **Qué query recibe SearchAPI**: `refined_query` del enrichment si llegó a
tiempo, si no la query construida (marca+OCR+categoría+color+rasgos). BUG
corregido: `q` solo se enviaba con `search_type=all`, así que en premium
`products`/`visual_matches` la perdían **y `queryUsed` registraba una query
que no se había enviado**.

6. **Search modes**: A (rápida) `all` → escala a `products`/`visual_matches`
por evaluación; B (premium) `exact_matches`+`products` en paralelo →
`visual_matches` solo si la señal es débil. Antes premium lanzaba SIEMPRE 3.

7. **Por qué el fallback no funcionaba**: `if (results.length > 0 ||
lastStatus === "available")` — un proveedor vivo con 0 resultados "ganaba" y
nunca se probaba SerpAPI.

8. **Por qué se cancelaban llamadas**: timeout del cliente 20s < suma real
del backend (upload + enrichment 20s bloqueante + Lens 15s + DataForSEO 12s).
El navegador abortaba peticiones que el servidor completaba.

9. **Por qué DataForSEO bloqueaba**: `await dataForSeoShopping(...)` estaba
en el camino crítico de la respuesta.

10. **Por qué un producto solo se intentaba una vez**: `attempted =
Set<fingerprint>` — sin retry aunque llegara un crop mucho mejor o el
proveedor hubiera fallado.

11. **Caché**: `lenscrop:v1:<hash>` — sin query, país, estrategia ni versión.
Resultados buscados con una query genérica antigua se reutilizaban tras
corregir el código.

12. **exact/near_exact/similar**: `classifyMatch` con umbrales
`MATCH_*_THRESHOLD` (ver auditoría anterior). Añadido ahora: un
`exact_matches` de Pinterest/blog **no** cuenta como señal comercial
(`isNonCommercialDomain`).

13. **Duplicados**: dos clientes HTTP de Google Lens (`providers.ts`
funcional + `reverseImage/providers.ts` clases) con normalización distinta.

## 2. Implementado (P0 de esta ronda)

- **Matriz de capacidades `q`** (`SEARCHAPI_Q_SUPPORTED_MODES = all/products/
  visual_matches`; exact_matches sin `q`). `queryUsed` guarda SOLO lo enviado,
  por llamada, en `ProviderCallLog` (+ `cropRef` corto, sin URL completa).
- **Fallback real**: `evaluatePreliminaryResultQuality()`
  (`reverseImage/resultQuality.ts`, pura y testeada) — usefulCount,
  commercialCount, exactCount (solo exactos COMERCIALES), qualityScore,
  shouldFallback+reason. available+0 → siguiente proveedor; débil → se guarda
  `bestSoFar` y se prueba el siguiente; si todos débiles se devuelve el menos
  malo. Breaker igual que antes para 401/429/timeout.
- **Estrategias escalonadas** (máx `MAX_REVERSE_SEARCHES_PER_ITEM=3` modos
  por proveedor): rápida `all`→`products`→`visual_matches` por evaluación;
  premium `exact+products` paralelo → `visual_matches` solo si débil. Premium
  ampliado: coche, prendas con estampado distintivo, OCR, relevancia ≥0.85.
- **Providers unificados**: `reverseImage/providers.ts` es la implementación
  canónica; `searchApiLens`/`serpApiLens` de `providers.ts` son adapters que
  delegan (marcados como capa legacy). Normalización robusta con alias reales
  (`url|product_link|source_url`, `image|image_url|thumbnail`,
  `merchant|seller|source`, `extracted_price`) + métricas de descartes
  (`provider_results_normalized`). Fixtures anonimizadas en `test/fixtures/`.
- **Timeouts**: cliente 45s por defecto (> peor caso backend); enrichment ya
  no bloquea (abajo); DataForSEO fuera del camino crítico. La ruta síncrona
  se mantiene DOCUMENTADA COMO TEMPORAL — la arquitectura de jobs
  (`jobId`/SSE) queda en P1; la cola cliente ya da asincronía por objeto.
- **Enrichment no bloquea Lens**: upload y 2ª pasada arrancan en paralelo;
  solo se espera al upload; al enrichment se le da una ventana
  `FAST_ENRICHMENT_WAIT_MS=2500`. Si no llega: Lens sale con la query de la
  1ª pasada y el enrichment termina en background (memoizado por hash de crop
  — `enrichCropDetailsCached` — y persistiendo atributos tarde, best-effort).
- **DataForSEO asíncrono**: la respuesta sale con el match de Lens; el
  enriquecimiento shopping corre en background, re-rankea, re-cachea y
  re-persiste recomendaciones (`shopping_enrichment_started/completed/failed`).
- **Más objetos enriquecidos**: `shouldEnrichCrop()` — premium, estampado
  distintivo, OCR, logo, marca o relevancia ≥0.7; nunca prioridad baja.
- **Retry en vez de attempted-Set**: `MatchingAttemptState` por fingerprint
  (attempts, lastCropQuality, lastStatus, cooldown). Retry si: crop mejora ≥
  `BEST_CROP_IMPROVEMENT_THRESHOLD` tras `no_match`/`similar_only`, o
  `provider_error` tras cooldown. Nunca tras `matched`; tope
  `MAX_MATCH_ATTEMPTS_PER_TRACK=3`. Regla pura exportada (`canRetryMatching`).
- **Fingerprint reforzado**: nombre(3 palabras)+categoría+subcategoría+color+
  patrón+marca — dos camisas distintas no colapsan; la misma con nombre
  ligeramente distinto sí asocia (más el trackId del tracker para overlay).
  El hash perceptual del crop queda en P1.
- **Caché versionada**: `lens-raw:v3:<cropHash>:<queryHash>:<estrategia>:
  <país>:<idioma>:<RANKING_VERSION>:<ENRICHMENT_VERSION>`; shopping `v2`;
  enrichment memoizado con `ENRICHMENT_VERSION`. Las keys v1 quedan huérfanas
  (expiran por TTL, nunca se leen).
- **exact_image_source ≠ exact_product_match**: dominio no comercial
  (Pinterest/redes/blogs) no puntúa como señal comercial en la evaluación, y
  "exact" en el ranking ya exigía imagen idéntica + umbral; los purchase_links
  solo salen de candidatos con score positivo.
- **coerceBox estricto** (`vision.ts`): tolera escala 0-100, garantiza
  `x+width ≤ 1`, rechaza área cero y registra las cajas inválidas.
  `buyabilityScore` con categorías ES/EN.

## 3. P1 / P2

**P1**: job queue real (`POST /match` → jobId + SSE) para eliminar la ruta
síncrona; verificación visual etapa 2 (descarga segura de la imagen candidata
+ comparación multimodal → `visualVerificationScore` con peso 0.40); hash
perceptual del crop en el fingerprint; scores 0-1 por dimensión
(brand/model/commercial); `MAX_CROP_ENRICHMENTS_PER_SCENE` con contador por
escena.

**P2**: embeddings visuales propios, disponibilidad/stock, afiliación.

## 4. Entorno

Sin `SEARCHAPI_API_KEY`/`SERPAPI_API_KEY` válidas y Storage operativo, el
pipeline degrada limpiamente (los tests cubren todo con fetch mockeado y
fixtures). El panel de costes y los logs `provider_response` mostrarán las
llamadas reales cuando haya credenciales.

---

# Adenda v4.1 — Visual-first (2026-07-10, misma fecha, ronda 4)

## Causa raíz

Aunque el crop llegaba a Google Lens, el sistema se comportaba como búsqueda
TEXTUAL: la primera llamada era `search_type=all` **con `q`** (la descripción
de OpenAI), y los candidatos de DataForSEO (texto puro) competían en el mismo
`rankCandidates` que los visuales — con `same_brand +50`/`trusted_store +30`
un resultado de Google Shopping con buen título podía ganar a la coincidencia
visual real. Además `r.image` como OBJETO se perdía (candidatos sin imagen →
imposibles de verificar) y no existía comparación visual de imágenes.

## Implementado

1. **Visual puro primero** (`orchestrator.runProviderStrategy`):
   PASO A = `exact_matches` + `visual_matches` EN PARALELO y **SIN query** —
   el único input discriminante es la URL del crop. PASO B = evaluación
   preliminar. PASO C = `products` **con** refined_query SOLO si la señal
   visual es débil o no hay resultados comerciales. exact_matches nunca lleva
   q. SerpAPI (llamada única): primero sin q, fallback con q.
2. **requestMode + responseSection** en `NormalizedVisualResult`: una petición
   `products` respondida dentro de `visual_matches` conserva ambos datos.
3. **parseImageUrl**: `thumbnail` | `image` string | `image` objeto
   (`link|url|src`) | `image_url` — los candidatos ya no pierden su imagen.
4. **Verificación visual real** (`lib/visualSearch/visualVerification.ts`):
   comparación multimodal crop ↔ imagen candidata para el top
   `VISUAL_VERIFICATION_TOP_N` (≤5, solo verificables), con json_schema
   estricto (similaridades 0-1, contradicciones, evidencia), memoizada por
   (cropHash, imagen), timeout 12s.
5. **Ranking normalizado 0-1** (`lib/visualSearch/verifiedRank.ts`):
   `finalScore = verificación 0.45 + Lens 0.20 + atributos 0.15 + marca/texto
   0.10 + comercial 0.05 + merchant 0.05` (pesos por env). El merchant solo
   desempata. Contradicciones observadas → confianza ≤0.5-. Reglas:
   **"exact" exige verificación visual ≥0.85 sin contradicciones + ficha
   comercial**; sin verificación el techo es near_exact;
   `exact_image_source` (Pinterest/blog) ≠ `exact_product_match`; un
   candidato de shopping textual nunca pasa de "similar".
6. **DataForSEO solo enriquece**: los ShoppingOffers ya no entran en
   `rankCandidates`. En background se busca el producto CANÓNICO ya
   identificado (marca + título del match) y las ofertas se persisten
   separadas (`persistShoppingOffers`: identidad primero, ofertas detrás con
   matchType/similarityScore null y reason "solo precio/tienda").
7. **Cache v4** (`lens-raw:v4:...:visual_first:...`) + `skipCache` en el body
   de match-object (para el rematch de debug; botón de UI pendiente P1).
8. **Enrichment**: `shouldEnrichCrop` ahora incluye TODA la prioridad alta
   (camisas/camisetas/chaquetas/coches…) — la camisa estampada sin marca
   recibe segunda pasada.
9. **UI**: "Buscando por imagen (Google Lens)…"; el panel técnico declara
   reverse image search sí/crop enviado/DataForSEO solo enrichment.

## Pendiente (P1)

Botón "Reanalizar sin caché" en la card (el backend ya acepta `skipCache`);
embeddings visuales como verificador barato; cache persistente de
verificaciones (hoy memo por instancia).
