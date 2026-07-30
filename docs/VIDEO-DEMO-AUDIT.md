# VIDEO-DEMO-AUDIT — Flujo de análisis de vídeo

Auditoría previa al refactor de la demo de vídeo (2026-07-09). Complementa a `DEMO-AUDIT.md`.

## 1. Flujo actual real (verificado en código y en vivo)

| Pieza | Dónde | Estado |
|---|---|---|
| Selección de fuente | `components/VideoProviderAnalyzer.tsx` (tabs "Pegar link" / "Subir vídeo") | Funciona; la demo solo necesita upload |
| Reproductor | `DirectVideoPlayer` (interno, `<video>` + objectURL) | Funciona sin permisos |
| Captura canvas | `hooks/useVideoCaptureEngine.ts` + `lib/frameCapture.ts` | Funciona (JPEG 1280px q0.82) |
| Auto-captura | `useAutoCaptureInterval` (intervalo fijo 3s) | **Apagada por defecto** (`autoCaptureMode=false`) |
| Analizar al pausar | `handleDirectPause` | Funciona pero el flujo invita al botón manual |
| Botón manual | "Analizar frame actual" | Es la acción principal actual |
| Endpoint de análisis | `POST /api/vision/analyze-frame` → `lib/server/analyzeFrameHandler.ts` | Funciona (OpenAI real) |
| Prompt de detección | `lib/vision.ts` (`VISION_PROMPT`) | Sesgado (ver §3), máx. 8 objetos, `max_tokens 2000`, `detail:"low"` |
| Bounding boxes | `VideoOverlay` (vídeo) + `FramePreview` (panel) | Funcionan, coords reales normalizadas |
| Crops | `components/ItemCrop.tsx` (CSS) | Solo visual en cards; **no existe crop real enviado a matching** |
| Motor visualSearch | `lib/visualSearch/` (engine, providers, rank, cache) | Implementado pero **muerto por credenciales**; usa el frame COMPLETO, nunca el crop |
| SearchAPI Lens | `lib/visualSearch/providers.ts` | Sin clave (`SEARCHAPI_API_KEY` ausente) |
| SerpAPI Lens/Shopping | ídem | Clave inválida (401 verificado hoy) |
| DataForSEO | ídem | Credenciales válidas pero cuenta **sin verificar** → 40104 en TODA la API (verificado hoy, incluso endpoints gratuitos) |
| Catálogo | `lib/catalog/` + `ResilientCatalogRepository` | Funciona; fallback automático a memoria ya implementado |
| Persistencia Supabase | `lib/db/pool.ts` | `DATABASE_URL` es la URL REST (https://) → inválida para `pg`; detectada y neutralizada (modo memoria) |
| Costes | `lib/server/costTracker.ts` + `/api/catalog/costs` + `CostPanel` | Contadores en memoria; Lens/Shopping en 0 porque nunca se ejecutan |
| Deduplicación | fingerprint `normalize.ts` (backend) + `fp()` en `page.tsx` (cliente) | Funciona; dos capas con criterios distintos |
| Historial de vídeo | `sessionItems` en `page.tsx` + pestaña "Historial" | Funciona |
| Timeouts | OpenAI 45s, cliente 60s, proveedores 12s | Correctos tras el P0 anterior |
| Debug | `DebugPanel` plegable (oculto en presentación) | Correcto |

## 2. Qué funciona / qué está simulado

**Funciona de verdad:** detección OpenAI, captura canvas, frame-diff, dedupe, catálogo resiliente, Storage de Supabase (verificado: sube y sirve; el proyecto está vivo), costes de visión.

**Simulado o inerte:** recomendaciones de productos (OpenAI genera texto + URL de búsqueda; mock si no hay clave), todo el matching visual real (proveedores caídos), crops para búsqueda (no existen), enlaces "Amazon/Google Shopping" (deep-links de búsqueda, ya etiquetados como "Buscar manualmente").

## 3. Por qué solo se detecta 1 objeto (la camisa)

Causas concretas en `lib/vision.ts`:
1. **`detail: "low"`** (línea ~109): OpenAI reduce la imagen a ~512px → los objetos pequeños (reloj, taza, teclado) pierden resolución hasta ser indetectables.
2. **Prompt sesgado a moda**: la instrucción prioriza "ropa, calzado, accesorios" y pide "objetos que un espectador querría comprar" — el modelo interpreta "lo que lleva puesto la persona".
3. **Sin barrido sistemático**: no se le pide recorrer zonas (persona → escritorio → fondo → electrónica).
4. **`max_tokens: 2000`**: con el esquema por item (~150-200 tokens/objeto), ~8-10 objetos truncan el JSON → el parser rescata los primeros y descarta el resto.
5. **Umbral 0.45 + tope 8** recortan lo poco que sobrevive.

## 4. Por qué el matching está a 0 llamadas

`enrichAnalysisWithVisualMatches` corre en cada análisis pero `config.enabled` exige al menos un motor con credenciales (`lib/visualSearch/config.ts`). Hoy: SearchAPI sin clave, SerpAPI 401, DataForSEO 40104 → 0 candidatos, 0 llamadas contabilizadas. Además, aunque hubiera credenciales, se busca con el **frame entero**, no con el crop del objeto → precisión pobre.

## 5. Por qué el análisis es lento

- Un POST síncrono hace TODO (visión → matching → persistencia → recomendaciones) antes de responder: 2-6s reales, y antes del P0 previo +3s de timeout de DB.
- Intervalo fijo de 3s sin scheduler: o analiza tarde o repite escena.
- Recomendaciones OpenAI (subsistema B) añaden ~1-3s dentro del mismo request.

## 6. Por qué falla Supabase (`ENOTFOUND upnakevdnwnccduwcpee.supabase.co`)

`DATABASE_URL` contiene la **URL REST** del proyecto (`https://upnakevdnwnccduwcpee.supabase.co`), no una connection string `postgresql://`. `pg` intenta resolver ese host como servidor Postgres (a veces `ENOTFOUND` según red/DNS, a veces timeout). El proyecto en sí está VIVO (Storage responde 200 con la service key). **Corrección (acción del usuario):** copiar la connection string del pooler en Supabase → Settings → Database (formato `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`) y ponerla en `DATABASE_URL` de `.env` (y de Vercel). No se puede derivar automáticamente: requiere la contraseña de DB.
Mientras tanto la app ya lo detecta y funciona en memoria sin penalización; falta pulir el mensaje de UI (Fase 14).

## 7. Archivos a modificar

- `components/VideoProviderAnalyzer.tsx` — flag URLs, auto-análisis, estados, copy demo
- `hooks/useVideoCaptureEngine.ts` — scheduler (tick 400ms, min/max interval, force-after-skips)
- `lib/vision.ts` — prompt multiproducto por zonas, 15 objetos, detail alto, más tokens, nuevos campos
- `lib/types.ts` — campos nuevos (purchase_relevance, brand_evidence)
- `lib/crop.ts` (nuevo, cliente) — crop real por bounding box con padding
- `app/api/vision/match-object/route.ts` (nuevo) — matching por crop
- `lib/visualSearch/reverseImage/` (nuevo) — `ReverseImageProvider`, providers SearchAPI/SerpAPI, orquestador con fallback/presupuesto
- `hooks/useObjectMatching.ts` (nuevo) — cola de matching en cliente (concurrencia 3)
- `components/ProductCard.tsx` / `ProductResultsPanel.tsx` — estados progresivos por objeto
- `lib/server/costTracker.ts` — contadores por proveedor + fallbacks + presupuesto
- `app/page.tsx` — orquestación detección→matching
- `.env.example`, tests, docs

## 8. Plan P0 (orden de implementación)

1. Flag `NEXT_PUBLIC_ENABLE_VIDEO_URLS=false`: solo "Subir vídeo", copy limpio.
2. Auto-análisis al reproducir (auto-captura ON por defecto, analizar al pausar ON, botón Detener/Reanudar; manual relegado a menú técnico).
3. Scheduler: tick local 400ms + diff, min 1.5s / max 3s entre análisis, force tras 4 skips, 1 detección concurrente.
4. Prompt multiproducto (zonas, 15 objetos, no personas, marca con evidencia en 3 niveles).
5. Crops reales cliente (canvas + padding 10%) → nuevo endpoint de matching.
6. Reverse image search real por crop: SearchAPI Lens (estrategia A/B) con fallback SerpAPI, orquestador con estados de proveedor, cache por hash de crop, presupuesto.
7. Matching asíncrono: detección pinta primero, cards se actualizan al llegar Lens/Shopping.
8. DataForSEO como enriquecimiento no bloqueante (queda inerte hasta verificar la cuenta).
9. Costes: contadores por proveedor + fallback + estimación, visibles en CostPanel.
10. Supabase aislado con mensaje amable (fallback ya existente del P0 anterior).
11. Tests de aceptación + fixture del frame de oficina.

**Restricción externa conocida:** con las credenciales de HOY (sin SearchAPI, SerpAPI 401, DataForSEO 40104) el matching real no puede ejecutarse en vivo. El pipeline queda implementado y probado unitariamente; el benchmark y la activación quedan a una clave de distancia (ver `DEMO-API-COST-DECISION.md`).
