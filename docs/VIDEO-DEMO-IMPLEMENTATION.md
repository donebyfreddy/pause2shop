# VIDEO-DEMO-IMPLEMENTATION — Pipeline de análisis de vídeo

Implementación del refactor de demo (2026-07-09). Auditoría previa: `VIDEO-DEMO-AUDIT.md`. Referencia funcional: `SMALLSEOTOOLS-REVERSE-IMAGE-ANALYSIS.md`. Costes: `DEMO-API-COST-DECISION.md`.

## 1. Arquitectura final

```
Usuario sube vídeo (único flujo visible; URLs tras NEXT_PUBLIC_ENABLE_VIDEO_URLS)
  └─ play → auto-análisis (ON por defecto)
       │
       ├── COLA A · Tick local (400 ms, useAutoCaptureInterval + useVideoCaptureEngine)
       │     mini-frame 32×18 → diff → analiza si: escena nueva (≥0.10)
       │     | ≥4 skips | >3 s sin analizar; nunca antes de 1.5 s; pausa = inmediato
       │
       ├── COLA B · Detección (1 concurrente)
       │     POST /api/vision/analyze-frame
       │     gpt-5-mini (reasoning minimal, detail high, esquema recortado)
       │     → hasta 15 objetos con bounding boxes por barrido de 6 zonas
       │     → persistencia resiliente (memoria si DB cae) → UI pinta YA
       │
       └── COLA C · Matching (3 concurrentes, useObjectMatching)
             top-3 crops por frame (relevancia ≥ confianza 0.55, sin repetidos)
             crop real cliente (canvas, padding 10%, ≤640 px)
             POST /api/vision/match-object:
               hash → cache → publicar crop (Supabase Storage /crops)
               → ReverseImageOrchestrator:
                    SearchAPI Lens (estrategia A: all+q → escala a products;
                    estrategia B para reloj/bolso/calzado/logo/electrónica:
                    exact+products+visual en paralelo)
                    → fallback SerpAPI Lens (circuit breaker 60 s, registrado)
               → DataForSEO Shopping si faltan precios (no bloquea si falla)
               → re-rank (marca/OCR/color/tienda) → exact | near_exact | similar
               → persistencia best-effort → card se actualiza
```

## 2. Archivos

**Nuevos:** `lib/visualSearch/reverseImage/{types,providers,orchestrator}.ts`, `app/api/vision/match-object/route.ts`, `lib/crop.ts`, `hooks/useObjectMatching.ts`, `lib/server/searchBudget.ts`, `test/reverseImage.test.ts`, `test/searchBudget.test.ts`, este doc + 2 docs más.

**Modificados:** `lib/vision.ts` (prompt por zonas + gpt-5 + esquema corto), `lib/types.ts`, `hooks/useVideoCaptureEngine.ts` (scheduler), `components/VideoProviderAnalyzer.tsx` (upload-only + auto-análisis + Detener/Reanudar), `app/page.tsx` (cola de matching + merge), `components/ProductCard.tsx` (estados progresivos + fuentes), `components/CostPanel.tsx` (por proveedor + fallbacks), `lib/server/{analyzeFrameHandler,costTracker}.ts`, `lib/visualSearch/{engine,storage}.ts`, `app/api/demo-check/route.ts`, `.env.example`.

## 3. Decisiones clave (con benchmark real, foto oficina 1280×1622)

| Configuración | Latencia | Objetos | Boxes |
|---|---|---|---|
| Prompt viejo + gpt-4o-mini + detail low (estado inicial) | ~15 s | **1-4, solo ropa** | a veces |
| Prompt nuevo + gpt-4.1-mini + detail high | 36 s | 8 | 8 |
| Prompt nuevo recortado + **gpt-5-mini minimal** (elegido) | **17-30 s** | **11-12** | **12** |
| gpt-5-nano minimal | 6.6 s | 4 (pierde la ropa) | 4 |

- Causa del "solo una camisa": `detail:"low"` (frame a ~512 px), prompt sesgado a moda sin barrido por zonas, `max_tokens:2000` truncando el JSON.
- Causa de la latencia: los **tokens de salida** dominan (~64-90 tok/s); por eso el esquema por item se recortó a lo que el pipeline consume.
- El ejemplo JSON del prompt mostraba `bounding_box: null` y el modelo lo copiaba → ahora es obligatorio con ejemplo numérico.
- Frames de vídeo 16:9 (1280×720) tienen ~la mitad de tiles que el retrato del benchmark: latencia esperada en demo ~12-20 s por escena analizada. Los objetos de escenas anteriores permanecen y el matching corre en paralelo — la UI nunca se bloquea.

**Streaming de detección (mejora clave de latencia percibida).** `/api/vision/analyze-frame-stream` (NDJSON): el servidor consume la respuesta SSE de OpenAI, un parser incremental (`lib/streamingParser.ts`, con tests) extrae cada objeto en cuanto el modelo cierra su `{…}`, y el cliente lo pinta al momento (box en la preview + card "Buscando coincidencias…"). Medido E2E con el frame de oficina: **primer objeto a 10,5 s y goteo continuo cada 2-3 s** (antes: pantalla vacía hasta los ~35 s). Fallback automático al endpoint clásico si el stream falla; desactivable con `NEXT_PUBLIC_STREAM_DETECTION=false`. Knob adicional para el día D: `OPENAI_SERVICE_TIER=priority` (menor latencia, ~2× coste de tokens; opcional).

**Segunda pasada por crop (Fase 6, implementada).** Para objetos premium (reloj/bolso/calzado/gafas/electrónica/logo), `match-object` lanza EN PARALELO con la subida del crop un análisis de detalle del recorte a alta resolución (`lib/visualSearch/cropEnrichment.ts`, ~500 tokens, timeout 10 s, best-effort): afina `visible_brand`/OCR/`brand_evidence`/rasgos y produce una `refined_query` en inglés que alimenta Lens y el re-ranking. Su latencia queda oculta bajo la subida a Storage.
- `INITIAL_MATCH_ITEMS` (sugerencias OpenAI inline) ya solo corre para imágenes sueltas; en vídeo el producto real llega por la cola C.

## 4. Estado de matching por objeto (UI)

`matchingStatus`: `pending → searching → matched | similar_only | no_match | budget_exhausted | provider_error`. La card muestra "Buscando coincidencias en tiendas…", el bloque de producto (exacto/casi exacto/similar) con "Fuentes de búsqueda" plegable y "Confirmado por N fuentes" solo con respaldo real, o "Buscar manualmente" como fallback.

## 5. Presupuesto y créditos (Fase 9E)

`lib/server/searchBudget.ts`: tope global (100 requests), por vídeo (40) y en euros (10 €). Al agotarse → `budget_exhausted`, la detección continúa. `CostPanel` muestra llamadas por proveedor, cache hits y fallbacks. Cache de crops por SHA-256 (`lenscrop:v1:<hash>`, TTL 7 días, DB o memoria).

## 6. Estado de dependencias externas (verificado 2026-07-09)

| Servicio | Estado | Acción del usuario |
|---|---|---|
| OpenAI | ✅ | — (`VISION_MODEL=gpt-5-mini` ya configurado) |
| SearchAPI (Lens principal) | ❌ sin clave | Crear cuenta/clave en searchapi.io → `SEARCHAPI_API_KEY` |
| SerpAPI (fallback) | ❌ clave inválida (401) | Regenerar en serpapi.com |
| DataForSEO | ❌ cuenta sin verificar (40104) | Verificar en app.dataforseo.com |
| Supabase Storage | ❌ clave `sb_publishable_…` (cliente) y **sin buckets** | Poner la clave secreta (`sb_secret_…`/service_role) y crear bucket público `shoppable-media` |
| Supabase Postgres | ❌ `DATABASE_URL` = URL REST | Copiar connection string del pooler (puerto 6543) |

**Sin la clave de Storage + al menos un proveedor Lens, el matching devuelve `storage_unavailable`/`provider_error` (degradación limpia, verificada en vivo) pero no hay productos reales.** Todo lo demás funciona hoy.

## 7. Cómo probar

1. `npm run dev` → `http://localhost:3000` → modo "📺 Analizar vídeo" (solo aparece "Subir vídeo").
2. Arrastra un MP4 → "Vídeo preparado · El análisis comenzará automáticamente al reproducirlo."
3. Pulsa play: barra "Análisis automático activo — solo se analizan escenas nuevas"; boxes sobre el vídeo; cards con crop y "Buscando coincidencias…"; historial acumulando.
4. Pausa → análisis inmediato del frame actual. "⏹ Detener análisis" / "▶ Reanudar análisis" controla el loop. "Opciones técnicas → Forzar análisis de este frame" para el manual.
5. `/demo-check` valida todos los proveedores (incluye detección del 40104 de DataForSEO, la clave publishable y el bucket ausente).
6. Tests: `npm test` (89) · `npm run lint` · `npx tsc --noEmit` · `npm run build` — todos en verde.
