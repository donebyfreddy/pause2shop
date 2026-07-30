# DEMO-AUDIT — Pause2Shop

Auditoría técnica real del repositorio (código inspeccionado + aplicación ejecutada + endpoints probados en vivo). Fecha: 2026-07-09. Objetivo: demo estable el miércoles.

---

## 1. Arquitectura actual real

Next.js 16 (App Router, Turbopack) + React 19 + Tailwind 4 + `pg`. Sin SDKs externos: todas las integraciones son `fetch` directo.

```
Cliente (app/page.tsx)
├── Modo imagen  → ImageAnalyzer (upload / drag&drop / paste)
├── Modo vídeo   → VideoProviderAnalyzer
│     ├── "Pegar link"  → YouTube/Vimeo/Dailymotion/MP4/HLS (detectVideoProvider)
│     │     └── captura vía getDisplayMedia (useContinuousScreenAnalysis)
│     └── "Subir vídeo" → <video> + canvas directo (useVideoCaptureEngine, sin permisos)
└── Ambos → POST /api/vision/analyze-frame (useFrameAnalysis)

Servidor (lib/server/analyzeFrameHandler.ts — handler único)
├── 1. Visión: OpenAI chat/completions (VISION_MODEL, default gpt-4.1-mini,
│      detail:low, JSON forzado) → lib/vision.ts
├── 2. Visual Matching Engine (lib/visualSearch/engine.ts):
│      cache → SearchAPI Lens → SerpAPI Lens → SerpAPI/DataForSEO Shopping → rank
├── 3. Persistencia: lib/catalog (Postgres si DATABASE_URL, si no memoria)
└── 4. Recomendaciones: top-3 items nuevos → searchProducts (OpenAI → mock)
```

## 2. Mapa de componentes

**Vivos:** `page.tsx`, `ImageAnalyzer`, `VideoProviderAnalyzer` (+`VideoOverlay`, players internos), `ProductResultsPanel`, `ProductCard`, `CostPanel`, `FramePreview`, `LoadingAnalysis`, catálogo (`/catalog` + `components/catalog/*`).

**Muertos (no importados por nada vivo):** `YouTubeAnalyzer.tsx`, `LocalVideoAnalyzer.tsx`, `UrlInput.tsx`, `hooks/useScreenCapture.ts`, `VideoProviderAnalyzer.tsx.bak` (~30 KB), la mayor parte de `lib/youtube.ts` (solo `YT_STATE` se usa).

## 3. Mapa de endpoints

| Endpoint | Estado | DB | Fallo DB |
|---|---|---|---|
| `POST /api/vision/analyze-frame` | **Canónico** (único que llama el cliente) | Suave | `ok:true, persisted:false, warning` |
| `POST /api/analyze-frame` | Alias legacy, **sin caller** | — | — |
| `POST /api/vision/analyze-media` | Alias, **sin caller** (y sin `runtime` export) | — | — |
| `GET/PATCH /api/catalog/items[/id]` | Vivo (página catálogo) | Dura | **500** tras ~3s |
| `POST /api/catalog/items/[id]/search-products` | Vivo (botón catálogo) | Dura | 500 |
| `POST /api/catalog/feedback` | Vivo | Dura | 500 |
| `GET /api/videos/[id]/frames` | Vivo | Dura | 500 |
| `GET /api/catalog/costs` | Vivo (poll 8s) | No | Siempre 200 |
| `POST /api/videos/resolve` | Vivo | No | — |

## 4. Flujos reales

**Imagen (Caso A):** upload + drag&drop + **paste Ctrl+V ya funcionan** (`ImageAnalyzer.tsx`). Preview inmediata. Un solo POST devuelve todo (detección + matching + persistencia) → sin resultados progresivos. **Sin bounding boxes en modo imagen** (el overlay solo existe en vídeo).

**Vídeo subido (Caso B):** reproduce en `<video>` con objectURL, captura por canvas **sin compartir pantalla** ✓. Loop automático por intervalo (default 3s) + captura al pausar + botón manual. Frame-diff (media abs RGB 32×18, umbral 0.08) con force-analyze cada 5 frames. **Sin timeout en el fetch** → un request colgado congela el análisis para siempre (`useFrameAnalysis.ts:88`).

**YouTube (Caso C):** IFrame API + getDisplayMedia (correcto: el iframe es cross-origin, no se pueden leer píxeles). Hay instrucciones guiadas, pero: pausar **antes** de activar captura no hace nada silenciosamente; demasiados pasos/estados.

**Detección:** prompt único en español (máx. 8 objetos) que ya pide bounding boxes normalizadas, `visible_brand` solo con evidencia, `brand_guess`, `visible_text` (OCR), `logo_visible/logo_description`, colores, material, patrón, confianza. Umbral 0.45. **No hay segunda pasada por crop** — `imageCropUrl` existe en el esquema pero siempre es `null` (`normalize.ts:294`); la búsqueda inversa usa el frame completo, nunca el recorte.

**Matching visual:** pipeline real implementado (cache SHA-256 → SearchAPI Lens → SerpAPI Lens fallback → shopping round-robin → dedupe → re-rank con pesos: exact_image +100, marca +50, OCR +40, tienda fiable +30/-20, color +15…; `matchType` exact/near_exact/similar). Timeout 12s por proveedor, sin retries, errores silenciosos → `[]`.

**Persistencia:** fingerprint `videoId|4-palabras-nombre|categoría|color|estilo|marca|bucket-5s` con upsert `ON CONFLICT`; dos camisetas de distinto color/marca SÍ coexisten. El fingerprint del cliente (page.tsx) omite estilo/marca → diverge del backend.

**Costes:** contador en memoria con tarifas planas estimadas (no uso real de tokens); se resetea en cada reinicio; comenta gpt-4o-mini pero el default es gpt-4.1-mini. `ENABLE_USAGE_COST_TRACKING`, `MAX_COST_PER_*`, `HARD_STOP_ON_COST_LIMIT` declaradas pero **nunca leídas**.

## 5. Estado real de servicios externos (probado en vivo, 2026-07-09)

| Servicio | Estado | Evidencia |
|---|---|---|
| OpenAI | ✅ Funciona | Análisis real end-to-end (`mock:false`) |
| DataForSEO | ⚠️ Credenciales válidas, **cuenta SIN VERIFICAR** | `40104: Please verify your account` — bloquea todo el API |
| SerpAPI | ❌ Key inválida | `Invalid API key` |
| SearchAPI (Lens) | ❌ No configurada | Variable ausente en `.env` |
| Supabase DB | ❌ `DATABASE_URL` es la URL REST (https://), y el proyecto responde `DatabaseTimeout` (probablemente pausado) | `ENOTFOUND` / `Connection terminated due to connection timeout` |
| Supabase Storage | ❌ Mismo proyecto → timeout | `544 DatabaseTimeout` |

**Consecuencia:** hoy NO hay búsqueda visual inversa ni shopping real. El usuario ve detección OpenAI + sugerencias OpenAI con enlaces de búsqueda (etiquetadas "· IA") + deep-links. **Acciones humanas requeridas (no de código): verificar la cuenta DataForSEO, y restaurar/recrear el proyecto Supabase (o aceptar modo memoria), idealmente añadir una key de SearchAPI para Lens.** Saldo DataForSEO: ~1 USD (suficiente para demo con cache, justo).

## 6. Problemas encontrados (con evidencia)

1. **DB rota bloquea parcialmente**: `DATABASE_URL` no es `postgres://` → cada análisis paga ~3s de timeout de conexión en `persist()` (varias llamadas awaited en secuencia pueden apilar esperas); `/catalog` devuelve 500. No hay fallback automático a memoria cuando la URL es inválida (solo cuando está vacía). `lib/db/pool.ts` sin `statement_timeout`/`query_timeout`.
2. **Sin timeout en cliente ni en OpenAI**: `useFrameAnalysis` (fetch sin AbortController) y `lib/vision.ts:81` (ídem) → riesgo de loading infinito que bloquea todo análisis posterior (`inFlight` queda tomado).
3. **Proveedores caídos fallan en silencio**: 401/40104 → `[]` sin señal al usuario; imposible diagnosticar en vivo.
4. **Enlaces de búsqueda presentados como productos**: mock y OpenAI provider generan URLs de búsqueda de retailers con precios estimados y scores fabricados; el matiz solo está en etiquetas pequeñas ("(demo)", "· IA").
5. **Privacidad inconsistente**: el frame completo se sube a un bucket público de Supabase para Lens mientras la UI afirma "no guardamos imágenes en el servidor".
6. **Lint: 5 errores** (refs en render en `useAutoCaptureInterval.ts:21` y relacionados) — build pasa, lint no.
7. **1 test fallando**: `test/normalize.test.ts` espera fingerprint sin nombre (`v1|_|...`) pero el código incluye el nombre — test desactualizado respecto al código (el código es lo correcto: sin nombre, dos prendas iguales colapsarían).
8. **Sin recorte por item**: bounding boxes solo para overlay; cards sin crop; Lens recibe el frame entero (peor precisión).
9. **Sin boxes en modo imagen**; overlay de vídeo con canvas fijo 1280×720 (desalineado en aspect ratios ≠16:9).
10. **Recomendaciones limitadas a top-3 items nuevos por frame** → percepción de "detecta 4 cosas y se para".
11. **Código muerto**: 5 archivos + 2 endpoints alias; README desactualizado (tabs y componentes renombrados).
12. YouTube: pausa sin captura activa = silencio total; muchos pasos manuales.
13. Rate-limit y costes en memoria por instancia (irrelevante para demo local, roto en serverless).
14. `SHOPPABLE_DATABASE_URL`, tabla `provider_cost_config` y varias env vars: documentadas pero inexistentes en código.

## 7. Real vs aparente

| Aparenta | Realidad |
|---|---|
| Catálogo persistente | Solo si `DATABASE_URL` válida; hoy: memoria + 500 en /catalog |
| Productos de tiendas con precio | Hoy: sugerencias OpenAI con URL de búsqueda y precio estimado |
| Búsqueda visual inversa (Lens) | Implementada pero muerta por credenciales |
| Coste por uso | Estimación plana en memoria, se resetea al reiniciar |
| "No guardamos imágenes" | El frame se publica en bucket público cuando Lens está activo |
| Dos pasadas / crops | Solo esquema; no implementado |

## 8. Riesgos para el miércoles

1. **Credenciales** (DataForSEO sin verificar / sin SearchAPI): sin acción humana, no habrá productos reales. — *Mitigación: verificar cuenta hoy; plan B honesto con sugerencias IA etiquetadas.*
2. **Request colgado** = demo congelada (sin timeouts cliente). — *Se corrige en P0.*
3. **DB caída** = /catalog roto + latencia extra por análisis. — *Se corrige en P0 (fallback automático a memoria).*
4. Saldo DataForSEO ~1 USD. — *Recargar o cachear agresivamente.*
5. Wi-Fi/latencia del lugar de la demo. — *Runbook con plan B/C.*

## 9. Plan priorizado

### P0 — imprescindible para el miércoles
| # | Problema | Solución |
|---|---|---|
| P0-1 | DB inválida penaliza y rompe | Validar esquema de `DATABASE_URL`, circuit-breaker → fallback automático a repositorio en memoria, timeouts de query; estado de persistencia visible (guardado / memoria / pendiente) |
| P0-2 | Loading infinito posible | AbortController + timeout en `useFrameAnalysis` y en la llamada OpenAI; liberar `inFlight` siempre |
| P0-3 | Lint (5 errores) + 1 test roto | Corregir hooks y actualizar test de fingerprint |
| P0-4 | Fallos de proveedor invisibles | `/demo-check` (página + API): OpenAI, SearchAPI, SerpAPI, DataForSEO (detecta 40104), DB, Storage, migraciones, latencias, acción recomendada |
| P0-5 | Honestidad de resultados | Etiquetar claramente "Producto encontrado / Similar / Sugerencia IA / Buscar manualmente"; no presentar URL de búsqueda como producto verificado |
| P0-6 | Sin boxes ni crops en imagen | Overlay de boxes sobre la preview de imagen + crop cliente por item en cada card |
| P0-7 | UI técnica en demo | Modo presentación (`NEXT_PUBLIC_PRESENTATION_MODE`): oculta debug/costes crudos/warnings técnicos, panel técnico plegable |
| P0-8 | YouTube pausa muda | Feedback claro si se pausa sin captura activa; simplificar pasos |
| P0-9 | Sin guion de demo | `docs/DEMO-RUNBOOK.md` con planes A/B/C |

### P1 — importante, no bloquea
- Segunda pasada real por crop (re-análisis del recorte con OCR/logo) y Lens sobre el crop.
- Resultados progresivos (detección primero, matching async por SSE/polling).
- Timeline por timestamp en vídeo; `bestFrame` persistido.
- Unificar fingerprint cliente/backend; embedding/cropHash en fingerprint.
- Retries con backoff en proveedores; logs estructurados con `analysisRunId` (eventos capture/detection/search/persistence).
- Coste real por tokens de OpenAI (usage de la respuesta); persistir costes.
- Limpiar código muerto y README.

### P2 — piloto/producción
- Costes/rate-limit persistentes multi-instancia; hard-stop por presupuesto real.
- URLs firmadas para frames (privacidad) en vez de bucket público; borrar frames tras TTL.
- Catálogo interno como proveedor de matching (paso 1 del pipeline); embeddings visuales.
- Ampliar proveedores (tiendas oficiales), scraping legal de precios, afiliación.
- Autenticación/multiusuario, CI, e2e con Playwright.

## 10. Línea base de calidad (2026-07-09)

Antes de los P0: build ✅, tsc ✅, lint ❌ (5 errores), tests ❌ (1 fallo).

**Tras implementar los P0 (mismo día):** build ✅ · tsc ✅ · lint ✅ (0 errores) · tests ✅ (81/81, incl. 3 nuevos del repositorio resiliente). E2E verificado en vivo: análisis real 2,3s (antes 5,7s por timeout de DB), `/api/catalog/items` responde 200 en modo memoria (antes 500), `/demo-check` operativo.
