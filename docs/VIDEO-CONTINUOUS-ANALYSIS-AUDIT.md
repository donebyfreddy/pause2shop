# Auditoría — Análisis continuo y categorizado de vídeo

Fecha: 2026-07-10. Alcance: por qué "solo se analiza un frame", estado real del
pipeline person-centric, errores de entorno/Storage/reverse-search, y plan P0/P1/P2.

> Regla de la auditoría: **no se imprime ningún valor secreto**. Solo se reporta
> el *nombre* de la variable y la *forma* del valor (p.ej. "empieza por
> `postgres://`", "es un JWT `eyJ…`", "es una URL REST `https://…supabase.co`").

---

## 1. Causa exacta del "solo se analiza el primer frame"

Tras leer el código actual, **el bucle de frames y el hook de análisis ya NO
tienen el bug original** (fue corregido en la revisión previa registrada en
memoria). Concretamente:

- [`hooks/useVideoFrameLoop.ts`](../hooks/useVideoFrameLoop.ts): el siguiente
  `requestVideoFrameCallback` se re-registra **siempre dentro de `finally`**
  (líneas 94-104). Una excepción del cuerpo no mata el bucle; el bucle sobrevive
  a pausas y se re-arma solo. El `signal.stopped` del cleanup no cancela
  prematuramente porque solo se marca al desmontar/cambiar `enabled`.
- [`hooks/useFrameAnalysis.ts`](../hooks/useFrameAnalysis.ts): el guard
  `inFlight` se libera **en `finally`** (línea 305-307) y hay un **timeout duro
  de 90 s** (`AbortSignal.timeout`, línea 56). `loading` se pone a `false` en
  `complete`, `error` y en el `catch` del timeout. → un request colgado ya no
  deja el spinner activo para siempre.
- [`hooks/useVideoCaptureEngine.ts`](../hooks/useVideoCaptureEngine.ts): el flag
  `analyzing` **solo** salta la *captura* (línea 123-127), no detiene el bucle de
  frames. Cuando el análisis termina, la siguiente captura procede.

**Conclusión:** los 17,9 s son la latencia normal de OpenAI Vision con
`detail:"high"` (procesa el frame a resolución real por tiles). No bloquean el
tracking (el bucle sigue) ni encolan infinitamente (una sola captura en vuelo).
Si en la práctica se observa "un solo frame", la causa es una de estas dos, ambas
**operativas, no de bucle**:

1. `loading` sigue `true` porque el stream NDJSON nunca emitió `complete`
   (p.ej. error 500 del backend sin el evento `error`). Mitigado por el timeout
   de 90 s, pero conviene endurecer el cierre del stream.
2. Con `MIN_ANALYSIS_INTERVAL_MS` alto y una escena estática, no se relanza
   análisis remoto (por diseño) — el tracking local sí sigue en cada frame.

## 2. Flujo actual real (resumido)

```
subir vídeo → play
  → useVideoFrameLoop (rVFC, cada frame presentado)
    → onFrame() cada ~400ms → directEngine.captureAuto()
      → diff de escena + min/max interval → captura JPEG
        → onRequestAnalysis(dataUrl, meta)  [app/page.tsx]
          → useFrameAnalysis.analyze() → POST /api/vision/analyze-frame-stream
            → analyzeWithOpenAIStream (PROMPT FIJO person-centric)
            → normalizeAnalysis (orden person-centric, boxes)
            → persist() (catálogo pg o memoria)
          → associateDetections (tracker de productos, trackId)
          → matching.enqueue (cola async → /api/vision/match-object
             → crop → publish público → Google Lens (SearchAPI/SerpApi)
             → verificación → DataForSEO solo enriquece precio)
          → sessionItems (dedup por nombre+categoría+color)
```

## 3. Flujo corregido (lo que añade esta entrega)

Se añade una **configuración de análisis** (`VideoAnalysisConfig`) elegida por el
usuario **antes** de analizar, y que se propaga por todo el pipeline:

```
selector de categorías + intensidad  (NUEVO, obligatorio antes de analizar)
  → VideoAnalysisConfig { categories, analysisIntensity, personCentric, reverseImageSearch }
  → request body (analysisConfig)  → parseBody
  → buildVisionPrompt(config)  (PROMPT DINÁMICO por categoría, NUEVO)
  → filterByCategories(items, config)  (isCategoryAllowed ES/EN, NUEVO)
  → resto del pipeline igual
```

`clothing` (solo) ⇒ `personCentric=true` automático; se aceptan
`relationship=worn` (y `held` si se seleccionó bolsos/accesorios), se rechaza
`background`. Puertas, sofás, plantas, muebles… quedan filtrados en backend
**y** en cliente.

## 4. Errores de entorno (nombres y forma — sin valores)

| Variable | Forma detectada en `.env` | Problema |
|---|---|---|
| `DATABASE_URL` | `https://…supabase.co` (URL REST) | **No** es `postgres://` → `isDatabaseConfigured()` (`lib/db/pool.ts:24`) devuelve `false` → catálogo en memoria. |
| `SUPABASE_URL` | `https://…supabase.co` | Correcta para REST/Storage. |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_…` (clave nueva) | La API de Storage recibe la clave como `Authorization: Bearer` y la intenta decodificar como **JWT** → `403 Invalid Compact JWS`. |
| `NEXT_PUBLIC_SUPABASE_URL` | ausente | — |
| `SUPABASE_ANON_KEY` | ausente | — |
| `SEARCHAPI_API_KEY` | ausente | Reverse image (proveedor primario) no configurado. |
| `SERPAPI_API_KEY` | presente (opaca) | Fallback de Lens disponible. |
| `DATAFORSEO_USERNAME/PASSWORD` | presentes | Solo enriquecimiento de precio (correcto). |
| `OPENAI_API_KEY` | `sk-…` | OK. |

Ninguno de estos tres bloqueos (`DATABASE_URL` REST, clave `sb_…`, `SEARCHAPI`
ausente) es un **bug de código**: son **valores de entorno**. Esta entrega
**no inventa** cadenas de conexión ni claves; añade validación (`env:check`) y
health-checks que reportan la causa exacta.

## 5. Error de Storage — `Invalid Compact JWS`

Causa exacta: `SUPABASE_SERVICE_ROLE_KEY` es una clave **de formato nuevo**
(`sb_secret_…`/`sb_publishable_…`), no un JWT `eyJ…`. En
[`lib/visualSearch/storage.ts`](../lib/visualSearch/storage.ts) la subida hace
`Authorization: Bearer <key>` contra la API REST de Storage, que espera un JWT y
falla con `403 Invalid Compact JWS`. Efecto encadenado:

- `uploadFramePublic()` devuelve `null`.
- `match-object` cae a `publishCropLocally()` → log `crop_published_locally`.
- El crop local solo se sirve por `/api/crops/[hash]` y **solo es alcanzable por
  Google Lens si el origen NO es localhost** (`isPubliclyReachable`,
  `lib/server/cropStore.ts`). En local ⇒ `status: "storage_unavailable"`.

Correcciones aplicables **sin credenciales**: validación de la *forma* de la
clave, distinción `localPreviewUrl` vs `publicSearchUrl`, y no marcar un crop
local como "publicado" para reverse search. La corrección definitiva requiere una
clave válida de servidor (`sb_secret_…` con el header correcto, o el JWT
`service_role`) — documentado, no fabricado.

## 6. Reverse image search — estado

Existe un pipeline **real** y visual-first en
[`lib/visualSearch/reverseImage/`](../lib/visualSearch/reverseImage/) (SearchAPI
Google Lens primario, SerpApi fallback), llamado desde
`app/api/vision/match-object`. Corre `exact_matches`+`visual_matches` con
`query=null` primero; el texto de OpenAI solo entra como fallback comercial.
DataForSEO **solo** enriquece precio/merchant (nunca identifica). El mensaje
"Búsqueda visual no disponible" (`components/ProductCard.tsx:259`) refleja
`matchingStatus === "provider_error"`, que se produce cuando **no hay proveedor
configurado / crop no público / timeout** — no es un "feature off" hardcodeado.

## 7. Archivos que se modifican en esta entrega

- **Nuevos**: `lib/analysis/categories.ts` (tipos + `isCategoryAllowed` +
  `buildVisionPrompt`), `lib/env/validateServerEnv.ts`, `scripts/envCheck.ts`,
  `components/AnalysisConfigSelector.tsx`, `app/api/health/database/route.ts`,
  `app/api/health/storage/route.ts`, `app/api/health/visual-search/route.ts`,
  tests asociados.
- **Modificados**: `lib/types.ts` (tipos de config), `lib/vision.ts`
  (`buildVisionPrompt`, filtro), `lib/server/analyzeFrameHandler.ts`
  (parse+propagación de config), `app/api/vision/analyze-frame-stream/route.ts`,
  `components/VideoProviderAnalyzer.tsx` y `app/page.tsx` (estado de config y UI),
  `package.json` (`env:check`).

## 8. Plan

### P0 (esta entrega — sin credenciales)
1. Selector de categorías + intensidad **antes** del análisis, obligatorio.
2. `VideoAnalysisConfig` propagado a backend (no solo estado visual).
3. Modo `person_centric` automático cuando solo se elige `clothing`.
4. Prompt dinámico `buildVisionPrompt(config)` — sin mencionar categorías no
   seleccionadas.
5. Filtro `isCategoryAllowed` (ES/EN) en backend **y** cliente.
6. `env:check` + `lib/env/validateServerEnv.ts` (sin exponer secretos).
7. Health checks `/api/health/{database,storage,visual-search}` con causa exacta.
8. Tests + build.

### P1 (requiere credenciales o infra)
- `DATABASE_URL` real `postgres://` (pooler Supabase 6543 + SSL) → catálogo
  persistente + `db:migrate`.
- Clave de Storage válida (`sb_secret_…`/JWT) → crops públicos reales →
  SearchAPI recibe URL pública.
- `SEARCHAPI_API_KEY` → reverse image primario.
- Persistir `trackId`/`personTrackId`/`relationship`/`bestCrop` en el catálogo y
  deduplicar por track/hash perceptual (hoy la dedup incluye bucket temporal de
  5 s ⇒ la misma prenda se duplica entre ventanas).

### P2 (producción)
- Worker de backend desacoplado del request de Next (cola durable, checkpoints,
  reintentos) para procesar el vídeo completo (FFmpeg/decoder + detector local).
- `PersonTrack` real + detector local/GPU (YOLO/RT-DETR/ONNX) en vez de OpenAI
  por frame.
