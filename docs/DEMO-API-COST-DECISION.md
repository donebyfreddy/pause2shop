# DEMO-API-COST-DECISION — Reverse image search y coste de la demo

Fecha: 2026-07-09. Presupuesto autorizado: `DEMO_EXTERNAL_API_BUDGET_EUR=10`. Precios verificados en las páginas oficiales el mismo día (no inventados).

## 1. Proveedores detectados en `.env` y estado real (probado hoy)

| Variable | Estado |
|---|---|
| `OPENAI_API_KEY` | ✅ válida y funcionando |
| `SEARCHAPI_API_KEY` | ❌ **no existe** en `.env` |
| `SERPAPI_API_KEY` | ❌ presente pero **inválida** (401 en `/account`) |
| `DATAFORSEO_USERNAME/PASSWORD` | ⚠️ auth válida, cuenta **sin verificar** → 40104 en toda la API. Saldo actual ~1 USD |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ es una clave `sb_publishable_…` (cliente); Storage rechaza subidas y no hay buckets |
| `EBAY_BROWSE_API_KEY` | ❌ no es un token OAuth utilizable (falta el client secret para generar tokens); no sirve como proveedor hoy |

## 2. Precios oficiales verificados (julio 2026)

| Proveedor | Gratis | Coste/búsqueda (plan mínimo) | Modelo | Riesgo renovación |
|---|---|---|---|---|
| SearchAPI | **100 requests de bienvenida** (único, sin tarjeta) | $0.004 (Developer $40/mes / 10k) | Suscripción | Sí (cancelable) |
| SerpAPI | **250 búsquedas/mes** recurrentes | $0.025 (Starter $25/mes / 1k) | Suscripción | Sí + "Early Renewal" opcional (desactivar) |
| DataForSEO | Sin tier gratuito publicado | Shopping: $0.001-0.002/tarea | **Prepago** (depósito mínimo $50) | Bajo (saldo, sin cargo recurrente) |

Nota: la página de DataForSEO devuelve 403 a fetch simple (Cloudflare); cifras obtenidas de las mismas páginas públicas vía scraper. El precio citado es del Merchant/Google Shopping API.

## 3. Coste estimado de una demo completa

Configuración: `MAX_REVERSE_SEARCHES_PER_FRAME=3`, `MAX_REVERSE_SEARCHES_PER_VIDEO=40`, cache por hash de crop (repetir el vídeo de demo = 0 llamadas).

| Partida | Cantidad | Coste |
|---|---|---|
| OpenAI visión (gpt-5-mini, ~2.4k in / ~1.5k out por frame) | ~20-30 frames | **~$0.10-0.20** |
| Lens (SearchAPI/SerpAPI) | ≤40 búsquedas | **0 €** en tier gratuito |
| DataForSEO Shopping (enriquecimiento) | ≤20 tareas | ~$0.04 (del saldo ya depositado) |
| **Total demo (incluida la preparación/precalentado)** | | **< 0.50 €** |

## 4. Benchmark

**OpenAI (ejecutado hoy, frame real de oficina):** ver tabla en `VIDEO-DEMO-IMPLEMENTATION.md` §3 — decisión: gpt-5-mini reasoning minimal (12 objetos/boxes, 17-30 s) frente a gpt-4.1-mini (8 en 36 s) y gpt-5-nano (4 en 6.6 s, pierde la ropa).

**Lens por crop (reloj/camisa/silla/monitor/taza): NO EJECUTABLE hoy** — no existe ninguna clave operativa de SearchAPI/SerpAPI y Storage no acepta subidas (clave publishable). La tabla por crop queda pendiente de 15 minutos de acción humana (§6). El pipeline, el fallback y el circuit breaker están cubiertos por tests unitarios con `fetch` mockeado (`test/reverseImage.test.ts`).

## 5. Recomendación final

**Pago NO necesario para la demo.**

1. **Crear cuenta gratuita de SerpAPI** (250 búsquedas/mes, sin tarjeta) → `SERPAPI_API_KEY`. Cubre la demo entera. Desactivar "Automatic Early Renewal".
2. **Crear cuenta gratuita de SearchAPI** (100 requests de bienvenida) → `SEARCHAPI_API_KEY`. Es el proveedor principal del pipeline (soporta `search_type` + `q` guiada); SerpAPI queda como fallback automático.
3. **No depositar los $50 de DataForSEO** solo para la demo. Verificar la cuenta existente (gratis, ya tiene ~1 USD de saldo) y usarla como enriquecimiento de precios; si la verificación se atasca, la demo funciona sin ella.
4. **No contratar SmallSEOTools Pro**: no es una API de backend (ver `SMALLSEOTOOLS-REVERSE-IMAGE-ANALYSIS.md`).
5. Sin suscripciones automáticas: nada de lo anterior requiere tarjeta.

Si más adelante el volumen supera los tiers gratuitos, el primer plan de pago razonable es SearchAPI Developer ($40/mes, $0.004/búsqueda) — **supera los 10 € del presupuesto y requiere autorización explícita**; para un piloto corto, SerpAPI Starter ($25/mes) también la requeriría.

## 6. Pasos manuales (≈15 min, antes de la demo)

1. serpapi.com → registro gratuito → copiar API key → `SERPAPI_API_KEY` en `.env`.
2. searchapi.io → registro gratuito → copiar API key → `SEARCHAPI_API_KEY` en `.env`.
3. Supabase → Settings → API keys → copiar la clave **secreta** (`sb_secret_…` o el JWT service_role) → `SUPABASE_SERVICE_ROLE_KEY`.
4. Supabase → Storage → crear bucket **público** `shoppable-media`.
5. (Opcional) app.dataforseo.com → completar verificación de cuenta.
6. Reiniciar `npm run dev` y pasar `/demo-check` → todo lo anterior se valida automáticamente.
7. Ejecutar entonces el benchmark real por crop (reloj/prenda/silla/monitor/taza) reproduciendo el vídeo de demo una vez: el panel de costes mostrará llamadas por proveedor, latencias y coste estimado, y la cache quedará precalentada.
