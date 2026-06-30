# Pause2Shop 🛍️

Pega una URL de YouTube (o sube un vídeo local), reprodúcelo y **ponlo en pausa**:
Pause2Shop analiza el frame visible con **IA Vision**, detecta objetos comprables (ropa,
calzado, electrónica, muebles, decoración, accesorios…), **guarda cada elemento en un
catálogo interno persistente** y te recomienda productos con enlaces a Amazon España y
tiendas verificadas.

> Shopping visual con IA. No identificamos personas ni guardamos imágenes en el servidor.

## ✨ Características

- **Captura al pausar**: YouTube (vía captura de pantalla autorizada) y vídeo local
  (captura directa con `<canvas>`). Detección de PLAYING / PAUSED / ENDED.
- **Análisis con IA Vision**: el frame se manda al backend, que pide a OpenAI Vision un
  JSON estructurado de objetos detectados (tipo, categoría, color, material, estilo…).
- **Catálogo interno persistente**: cada objeto se guarda en base de datos (Postgres /
  Supabase) con **deduplicación** por huella, estado y contador de detecciones.
- **Página de catálogo** (`/catalog`): grid con buscador y filtros (categoría, color,
  tipo, vídeo, estado), detalle de cada elemento y **recomendaciones de producto**.
- **Recomendaciones extensibles**: interfaz `ProductProvider` con un `MockProductProvider`
  realista; preparada para Amazon (PA-API), tiendas verificadas y catálogo propio.
- **Modo demo doble**: sin `OPENAI_API_KEY` la visión usa datos mock; sin `DATABASE_URL`
  el catálogo funciona en memoria. La app funciona de principio a fin sin configurar nada.

## 🚀 Instalación

```bash
npm install
cp .env.example .env.local      # rellena OPENAI_API_KEY y DATABASE_URL (opcional)
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). El catálogo está en
[http://localhost:3000/catalog](http://localhost:3000/catalog).

## 🔑 Variables de entorno

| Variable                    | Descripción                                                        | Por defecto    |
| --------------------------- | ------------------------------------------------------------------ | -------------- |
| `OPENAI_API_KEY`            | Clave de OpenAI. Vacía → **visión y matching en modo demo** (mock). | _(vacío)_      |
| `VISION_MODEL`              | Modelo de visión (con visión: `gpt-4o-mini`, `gpt-4.1-mini`, …).   | `gpt-4.1-mini` |
| `PRODUCT_MODEL`             | Modelo para el matching de productos.                              | `VISION_MODEL` |
| `INITIAL_MATCH_ITEMS`       | Nº máx. de items con matching automático al pausar.                | `3`            |
| `AMAZON_AFFILIATE_TAG`      | Tag de afiliado; se añade a los enlaces de Amazon (`&tag=`).        | _(vacío)_      |
| `NEXT_PUBLIC_APP_NAME`      | Nombre de la app (cliente).                                        | `Pause2Shop`   |
| `DATABASE_URL`              | Postgres/Supabase. Vacía → **catálogo en memoria** (no persiste).  | _(vacío)_      |
| `DATABASE_SSL`              | `true` exige SSL (Supabase); `false` en local sin SSL.             | `true`         |
| `SUPABASE_URL`              | _(opcional)_ Solo para subir frames/crops a Storage (futuro).      | _(vacío)_      |
| `SUPABASE_SERVICE_ROLE_KEY` | _(opcional)_ Igual que arriba. **Nunca** se expone al cliente.     | _(vacío)_      |
| `STORAGE_BUCKET`            | _(opcional)_ Bucket de Supabase Storage para imágenes.             | `frames`       |
| `ENABLE_MOCK_PRODUCTS`      | `false` desactiva el mock (solo aplica si no hay `OPENAI_API_KEY`). | `true`         |

> 🔒 La llamada a OpenAI y el acceso a la base de datos se hacen **siempre desde el
> backend**. Ninguna clave llega al navegador.

## 🛢️ Base de datos (Postgres / Supabase)

El catálogo persiste en Postgres mediante `pg` (node-postgres) usando `DATABASE_URL`.
Funciona con Supabase, Neon, RDS o un Postgres local.

### Opción A — Supabase (recomendado)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **Project Settings → Database → Connection string** y copia la URL (usa el _pooler_
   para serverless). Pégala en `.env.local` como `DATABASE_URL`. Deja `DATABASE_SSL=true`.
3. Aplica el esquema con una de estas opciones:
   - `npm run db:migrate` (incluido; aplica los `.sql` de `supabase/migrations/`), o
   - `supabase db push` (Supabase CLI), o
   - copia/pega el SQL en el **SQL Editor** de Supabase.

### Opción B — Postgres local

```bash
createdb pause2shop
export DATABASE_URL="postgres://localhost:5432/pause2shop"
export DATABASE_SSL=false
npm run db:migrate
```

### Tablas

`video_sources`, `analyzed_frames`, `detected_items`, `product_recommendations`,
`item_feedback`. Ver `supabase/migrations/20260627000001_init_catalog.sql`.

> Sin `DATABASE_URL` la app no falla: usa un repositorio **en memoria** (mismo patrón
> "modo demo" que la visión sin clave). Útil para probar sin instalar nada, pero los
> datos se pierden al reiniciar.

## 🔌 API

| Método + ruta                                  | Descripción                                            |
| ---------------------------------------------- | ------------------------------------------------------ |
| `POST /api/vision/analyze-frame`               | Analiza un frame, guarda elementos (dedupe) y recomendaciones iniciales. |
| `GET  /api/catalog/items`                      | Lista elementos. Filtros: `category, color, type, videoId, status, q, limit, offset`. |
| `GET  /api/catalog/items/:id`                  | Detalle de un elemento + recomendaciones.              |
| `PATCH /api/catalog/items/:id`                 | Actualiza estado, nombre, categoría o metadatos.       |
| `POST /api/catalog/items/:id/search-products`  | Busca y guarda recomendaciones para el elemento.       |
| `POST /api/catalog/feedback`                   | Guarda feedback (`clicked, saved, rejected, purchased, ignored`). |
| `GET  /api/videos/:id/frames`                  | Frames analizados de un vídeo.                         |

> `POST /api/analyze-frame` se mantiene como alias de compatibilidad de
> `POST /api/vision/analyze-frame`.

## 🎬 Cómo probar con YouTube

1. Pega un enlace de YouTube (`watch?v=`, `youtu.be/` o `/shorts/`) y pulsa **Cargar vídeo**.
2. Pulsa **Activar captura de pantalla** y selecciona **esta misma pestaña o ventana**.
3. Deja activado **Analizar al pausar**.
4. Reproduce y **pausa**: el panel derecho muestra los objetos y se guardan en el catálogo.

### ¿Por qué YouTube necesita captura de pantalla?

El reproductor de YouTube se incrusta en un `<iframe>` de otro origen. Por restricciones
del navegador (CORS), **no se pueden leer los píxeles** de ese iframe con
`canvas.drawImage()`. Por eso, para YouTube usamos `navigator.mediaDevices.getDisplayMedia()`:
tú autorizas compartir la pestaña/ventana y la app captura el frame del `MediaStream`.
Para el MVP, las fuentes soportadas son: **vídeo subido**, **captura de pantalla
autorizada** y **URLs de vídeo directas compatibles**.

## 🎞️ Cómo probar con vídeo local

1. Pestaña **Vídeo local** → sube un `.mp4`, `.mov` o `.webm`.
2. Reproduce y **pausa**: el frame se captura con `<canvas>` (sin permisos). Ideal para
   pruebas rápidas y para ver el flujo completo de catálogo.

## 🗂️ Catálogo y deduplicación

Cada objeto detectado se normaliza (`lib/catalog/normalize.ts`) y se le calcula una
**huella** = `videoId | categoría | color | estilo | marca | bucket_de_timestamp`
(bucket de 5 s). En base de datos, `detected_items.fingerprint` es **único**: si el mismo
objeto reaparece en un timestamp cercano, en vez de duplicar se **actualiza** la fila
(sube `detection_count`, refresca confianza/metadatos) conservando el estado que hayas
puesto (revisado / ignorado). Estados posibles: `detected · reviewed · matched · ignored`.

## 🛒 Matching de producto (automático con OpenAI)

`lib/products` define la interfaz `ProductProvider` y dos implementaciones:

- **`OpenAIProductProvider`** _(por defecto si hay `OPENAI_API_KEY`)_: matching
  **automático**. Para cada elemento detectado pide a OpenAI varios productos concretos
  y comprables (título, marca, retailer, precio estimado, similitud, motivo) en JSON, y
  **nosotros** construimos la URL de búsqueda real del retailer (Amazon España por
  defecto, con `&tag=` de afiliado si configuras `AMAZON_AFFILIATE_TAG`). El modelo
  **no** inventa URLs ni SKUs, así que los enlaces siempre resuelven.
- **`MockProductProvider`** _(fallback sin clave)_: productos ficticios realistas y
  deterministas, para demo/tests.

El matching se dispara **solo** al pausar (para los `INITIAL_MATCH_ITEMS` items más
fiables) y al pulsar **Buscar productos** en el catálogo. Si OpenAI falla, cae al mock
para que siempre veas algo.

> Esto es matching de **Fase 1 (MVP)**: OpenAI sugiere productos por atributos + texto.
> No identifica el SKU exacto del frame; eso es la Fase 2 (embeddings CLIP + índice
> vectorial sobre un catálogo). La interfaz `ProductProvider` está pensada para enchufar
> esos proveedores sin tocar el resto:

```ts
interface ProductProvider {
  name: string;
  isEnabled(): boolean;
  search(query: string, item: CatalogItem): Promise<RecommendationInput[]>;
}
```

## 🧪 Tests

```bash
npm test
```

Cubre funciones puras y de catálogo: normalización, `generateItemFingerprint`,
deduplicación por ventana de timestamp, parseo de la respuesta de IA y proveedor mock.

## 🔒 Privacidad y seguridad

- No se identifican personas ni rasgos biométricos (instruido en el prompt).
- **No se guardan imágenes** del frame en el servidor (sí el `bounding_box`, para poder
  recortar en el futuro). El catálogo muestra un tile con el color + icono del tipo.
- Validación de tamaño de payload (~8 MB) y **rate limit** básico por IP.
- Llamadas a IA Vision y a la base de datos **solo desde el backend**.

## 📁 Estructura

```
app/
  layout.tsx · page.tsx · globals.css · catalog/page.tsx
  api/
    vision/analyze-frame/route.ts      · analyze-frame/route.ts (alias)
    catalog/items/route.ts             · catalog/items/[id]/route.ts
    catalog/items/[id]/search-products/route.ts
    catalog/feedback/route.ts          · videos/[id]/frames/route.ts
components/
  UrlInput · YouTubeAnalyzer · LocalVideoAnalyzer · ProductResultsPanel
  ProductCard · FramePreview · LoadingAnalysis
  catalog/ CatalogClient · CatalogFilters · CatalogItemCard · ItemDetailDrawer · catalogUi
hooks/
  useScreenCapture · useYouTubePlayer · useFrameAnalysis
lib/
  vision · productLinks · youtube · frameCapture · storage · types · utils
  api/types                            (DTOs cliente↔servidor, solo tipos)
  db/pool                              (pool de pg + detección de DB)
  catalog/ types · normalize · repository · postgresRepository · memoryRepository · index
  products/ types · shared · mockProvider · openaiProvider · searchProducts
  server/analyzeFrameHandler           (pipeline de análisis + persistencia)
scripts/migrate.ts                     (aplicador de migraciones)
supabase/migrations/*.sql              (esquema del catálogo)
test/*.test.ts
```

## ⚠️ Limitaciones actuales

- **YouTube/CORS**: no se puede leer el iframe; se requiere captura de pantalla autorizada
  (ver arriba). Sin captura activa, YouTube no analiza (con mensaje claro, no falla en
  silencio).
- La calidad de la detección depende del frame y del modelo de visión.
- **Matching = Fase 1**: OpenAI sugiere productos por atributos + texto y enlazamos a la
  **búsqueda** del retailer (no al SKU exacto). Precios son **estimados** por el modelo y
  las imágenes son placeholders (no son la foto real del producto).
- `bounding_box` se guarda pero **no se recortan** imágenes todavía (no guardamos frames).
- El rate limit es en memoria por instancia (suficiente para desarrollo).

## 🗺️ Siguientes pasos (productos reales / proveedores)

- [ ] **Amazon Creators API** (⚠️ la antigua PA-API se retiró en mayo de 2026):
      implementar `AmazonProductProvider` (OAuth 2.0; productos reales, precios e imágenes)
      y registrarlo en `lib/products/searchProducts.ts`. Requiere cuenta de Amazon
      Associates aprobada con ventas cualificadas para obtener acceso.
- [ ] **Tags de afiliado**: ya soportado en enlaces de Amazon vía `AMAZON_AFFILIATE_TAG`.
- [ ] **Crops de prendas**: usar `bounding_box` + Supabase Storage (`STORAGE_BUCKET`) para
      recortar y guardar `imageCropUrl` / `frameImageUrl`.
- [ ] **Búsqueda visual / embeddings**: añadir `pgvector` y un embedding por elemento para
      recomendar por similitud visual, no solo por texto.
- [ ] **Recomendaciones personalizadas** combinando `item_feedback` + historial.
- [ ] Cuentas de usuario y multi-dispositivo.

## 🧰 Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · OpenAI Vision (vía
`fetch`) · Postgres/Supabase (vía `pg`).
