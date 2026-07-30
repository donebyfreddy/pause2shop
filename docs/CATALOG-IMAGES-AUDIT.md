# Auditoría — Imágenes reales en el catálogo

Fecha: 2026-07-09. Objetivo: que cada elemento del catálogo muestre (A) el crop
real detectado en el vídeo y (B) la imagen del mejor producto encontrado en
Internet, en lugar del emoji/degradado.

## Por qué hoy aparece el emoji

La cadena se rompe en la **persistencia de la URL de imagen**, no en la UI ni
en la captura:

1. `components/catalog/catalogUi.tsx` → `ItemThumb` ya prefiere
   `item.imageCropUrl || item.frameImageUrl` y solo cae al degradado+emoji si
   ambos son `null`. **Siempre son null.**
2. `lib/catalog/normalize.ts` → `normalizeDetectedItem` escribe
   `imageCropUrl: null` siempre, y `frameImageUrl` solo si el contexto lo trae
   — pero `persist()` en `lib/server/analyzeFrameHandler.ts` nunca lo pasaba.
3. El crop **sí se genera** (cliente, `lib/crop.ts` desde el canvas del frame
   con la bounding box normalizada) y **sí se sube** a Supabase Storage en
   `app/api/vision/match-object/route.ts` (`uploadFramePublic(..., "crops")`),
   pero la URL resultante solo se usaba para Google Lens y se **descartaba**.
4. En modo vídeo el cliente ni siquiera enviaba `itemId` a `match-object`
   (`app/page.tsx` llamaba a `matching.enqueue` sin `itemIdByFingerprint`),
   así que ni las recomendaciones ni el crop podían asociarse a la fila.
5. El `ON CONFLICT` de `upsertDetectedItem` (Postgres) no actualizaba
   `image_crop_url` / `frame_image_url`, y el PATCH de
   `/api/catalog/items/[id]` no aceptaba esos campos pese a estar en
   `ItemPatch`.

## Qué ya existía (no se duplica)

- Columnas `bounding_box`, `image_crop_url`, `frame_image_url` en
  `detected_items` (migración `20260627000001_init_catalog.sql`).
- Crop real con padding configurable (`NEXT_PUBLIC_CROP_PADDING_PERCENT`,
  default 10%), clamp a límites y tope de 640 px (`lib/crop.ts`).
- Subida idempotente por hash a Supabase Storage
  (`lib/visualSearch/storage.ts`).
- Resultados normalizados del matching (`VisualCandidate`) con `imageUrl`,
  `link`, `price`, `brand`, `store`, `score` y `matchType`
  (`exact | near_exact | similar`), y persistencia en
  `product_recommendations` (con `image_url`).
- Catálogo resiliente: Postgres → fallback en memoria con circuit breaker
  (`lib/catalog/resilientRepository.ts`).

## Qué faltaba (implementado en este cambio)

| Hueco | Fix |
| --- | --- |
| URL del crop nunca persistida | `match-object` hace `updateItem(itemId, { imageCropUrl })` tras subir el crop |
| Storage caído ⇒ sin imagen | Fallback: se persiste el **data URL** del crop (`local_only`) para no perder la evidencia visual |
| `itemId` ausente en modo vídeo | `useFrameAnalysis.analyze` devuelve `savedItems`; `page.tsx` construye `itemIdByFingerprint` y lo pasa a la cola de matching |
| Frame completo no persistido (modo imagen) | `handleAnalyzeFrame` pasa `outcome.frameImageUrl` al contexto de `persist()` |
| Dedup borra/ignora imágenes | `ON CONFLICT` y repo en memoria conservan la URL existente (`coalesce`) |
| Sin tipo de coincidencia persistido | Columna `match_type` en `product_recommendations` (migración `20260709000004_catalog_images.sql`) |
| La tarjeta no distinguía detectado vs encontrado | Nueva tarjeta: crop como imagen principal + miniatura del mejor match con badge; drawer con secciones Detectado / Mejor coincidencia / Alternativas / Auditoría |
| API de listado sin imagen del match | `GET /api/catalog/items` adjunta `bestMatch` (mejor recomendación) e `imagePersistenceStatus` por item |
| Imagen externa rota deja hueco | `<img>` con `onError` → fallback ordenado: crop → frame → imagen del match → placeholder por categoría → genérico |

## Campos añadidos

- `product_recommendations.match_type` (`exact | near_exact | similar`, nullable).
- En la respuesta del listado (derivados, sin columna nueva):
  `bestMatch: ProductRecommendation | null` y
  `imagePersistenceStatus: "none" | "local_only" | "pending_database_sync" | "synced"`.

`imagePersistenceStatus` se deriva (sin migración):
- sin crop → `none`
- crop en data URL → `local_only` (imagen solo en la fila/memoria, no en Storage)
- crop en URL http(s) + persistencia memoria → `pending_database_sync`
- crop en URL http(s) + Postgres → `synced`

## Archivos modificados

- `supabase/migrations/20260709000004_catalog_images.sql` (nueva)
- `lib/catalog/types.ts`, `lib/catalog/images.ts` (nuevo),
  `lib/catalog/repository.ts`, `lib/catalog/postgresRepository.ts`,
  `lib/catalog/memoryRepository.ts`, `lib/catalog/resilientRepository.ts`
- `lib/cropBox.ts` (nuevo, geometría pura del crop), `lib/crop.ts`
- `lib/server/analyzeFrameHandler.ts`
- `app/api/vision/match-object/route.ts`
- `app/api/catalog/items/route.ts`, `app/api/catalog/items/[id]/route.ts`
- `hooks/useFrameAnalysis.ts`, `app/page.tsx`
- `components/catalog/catalogUi.tsx`, `CatalogItemCard.tsx`,
  `ItemDetailDrawer.tsx`, `CatalogClient.tsx`, `CatalogFilters.tsx`
- `test/catalogImages.test.ts`, `test/cropBox.test.ts` (nuevos)

## Limitaciones conocidas

- La subida a Supabase Storage requiere `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` válidas y bucket público (`STORAGE_BUCKET`).
  Con las credenciales actuales rotas, el sistema degrada a data URLs
  (`local_only`): las imágenes se ven igualmente en el catálogo.
- "Ir al momento del vídeo" no está cableado: el reproductor de la home no
  admite apertura por query param (`?videoId=&t=`) todavía. El timestamp sí se
  muestra en tarjeta y detalle. (P1)
- Selección de "mejor crop" entre repeticiones: se conserva el primer crop
  subido y se actualiza con el más reciente si el existente era null. Scoring
  de nitidez/oclusión queda para P1.
- Cache propia de imágenes externas del match (anti-hotlink) queda para P1;
  hay fallback visual si la imagen externa falla.
