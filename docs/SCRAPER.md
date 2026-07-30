# Scraper de catálogo

Motor de ingesta modular: descubre fichas de producto en tiendas de moda, las
extrae por capas (datos estructurados → DOM → navegador → IA), las normaliza y
las guarda en el catálogo con trazabilidad de dónde salió cada campo.

- [Política](#política)
- [Cómo funciona](#cómo-funciona)
- [Cómo añadir un conector](#cómo-añadir-un-conector)
- [Herramientas de línea de comandos](#herramientas-de-línea-de-comandos)
- [Variables de entorno](#variables-de-entorno)
- [Jobs, lotes y reanudación](#jobs-lotes-y-reanudación)
- [Playwright en Vercel](#playwright-en-vercel)
- [Jobs grandes: el camino](#jobs-grandes-el-camino)
- [Limitaciones conocidas](#limitaciones-conocidas)

---

## Política

No negociable, y está codificada — no solo documentada:

| Regla | Dónde vive |
| --- | --- |
| robots.txt se comprueba ANTES de cada petición, también al renderizar | `connectors/base/httpClient.ts` → `ensureRobotsAllowed()` |
| `Crawl-delay` se respeta; hay rate limit por dominio y concurrencia acotada | `httpClient.ts` → `acquireDomainSlot()` |
| Nunca se resuelven CAPTCHAs ni se evaden protecciones anti-bot | `browser/playwrightService.ts` → `BrowserChallengeError` |
| El User-Agent NO se falsea: lleva nuestro nombre y un contacto | `config/index.ts` → `userAgent` |
| Ante un challenge se PARA y se reporta, no se insiste | `BaseConnector.syncProducts()` |
| Una fuente que requiere acuerdo no ingiere nada hasta tenerlo | `canSpecSync()` |
| `robotsPolicy` solo admite el valor `"respect"` | `connectors/base/types.ts` |

El tipo `RobotsPolicy = "respect"` tiene un solo valor a propósito: no existe una
forma de configurar "ignorar robots.txt". Hay un test que lo verifica para las
68 fuentes.

## Cómo funciona

### Descubrimiento

`discovery/index.ts`. Tres estrategias, declaradas por fuente:

- **`sitemap`** — recorre el índice y sus hijos. Usa una **cola con prioridad**,
  no FIFO: prefiere los sitemaps que suenan a producto y los del mercado que
  interesa. Sin esto, una tienda que declara 26 sitemaps (uno por país) gasta
  todo el presupuesto de peticiones recorriendo Portugal y Austria antes de
  llegar a España.
- **`category_crawl`** — recorre páginas de listado siguiendo `rel=next` o el
  selector `nextPage` de la fuente.
- **`feed`** — la resuelve el conector (es la vía preferente cuando existe).

Todo es reanudable: el estado (cola, visitados, encontrados) va al checkpoint del
job, así que una invocación cortada no vuelve a descubrir desde cero.

### Extracción por capas

`extraction/pipeline.ts`. De barato-y-fiable a caro-y-aproximado, y **solo se
escala si quedan huecos**:

| # | Capa | Módulo |
| --- | --- | --- |
| 1 | Feed/API autorizado | hook `fetchFromFeed()` del conector |
| 2 | Metadatos del sitemap | `discovery/` |
| 3 | JSON-LD `schema.org/Product` | `extraction/structured.ts` |
| 4 | JSON embebido de la tienda | hook `extractEmbeddedLayer()` |
| 5 | Microdata `itemprop` | `extraction/structured.ts` |
| 6 | OpenGraph / `<meta>` | `extraction/structured.ts` |
| 7 | Selectores CSS de la fuente | `extraction/dom.ts` |
| 8 | Heurísticas de DOM | `extraction/dom.ts` |
| 9 | **Playwright** — se repiten 3-8 sobre el DOM renderizado | `browser/playwrightService.ts` |
| 10 | **OpenAI** sobre HTML condensado | `ai/extractor.ts` |

Cada capa devuelve el MISMO shape parcial y `mergeLayers()` las combina: para
cada campo gana la primera capa por prioridad, y queda registrado en
`evidence[]` qué extractor lo resolvió y con qué recorte del HTML. Eso es lo que
el admin muestra en el inspector de evidencia.

> OpenGraph va **después** del JSON embebido a propósito: `og:title` suele llevar
> el nombre de la tienda pegado y `og:image` es una miniatura de compartir. Con
> más prioridad, pisaba la galería real de la ficha.

Los pasos 9 y 10 son condicionales: se activan si falta algún campo **esencial**
(`title`, `price`, `currency`, `imageUrls`) o si faltan 3+ campos deseables. Una
tienda con JSON-LD correcto no paga ni renderizado ni tokens — y en la práctica,
la mayoría no los paga.

### IA como fallback

`ai/extractor.ts`. Nunca se envía la página completa:

1. `ai/condense.ts` quita scripts, CSS, nav, footer, cookies y **recomendados**
   (los "también te puede gustar" traen otros precios que contaminarían), y
   conserva título, `<meta>`, atributos con datos, tablas y JSON-LD residual.
2. Se acota a `SCRAPER_AI_MAX_HTML_CHARS`.
3. La salida se fuerza con `response_format: json_schema` (strict) **y** se
   re-valida con Zod: un precio que llega como `"39,95 €"` se coacciona a
   `39.95`, y `"N/A"` se convierte en `null`.
4. Se cachea por `dominio + URL + hash del DOM + versión del esquema + modelo`.
   Un acierto de caché cuesta 0 y se contabiliza como tal.
5. Se registran tokens, duración, modelo y coste estimado por llamada.

El prompt prohíbe explícitamente inventar, deducir la marca por el dominio,
calcular precios y confundir un listado con una ficha. Si el modelo dice que la
página es un listado, sus campos de producto se descartan.

## Cómo añadir un conector

### Caso normal: solo datos

La mayoría de tiendas publican JSON-LD por SEO. Para esas, un conector es una
entrada declarativa — **no hay que escribir una clase**.

**1. Averigua qué publica la tienda de verdad.** No adivines el patrón de URL:

```bash
npm run scraper:infer -- --json > /tmp/inferencia.json   # todas
npm run scraper:infer -- mi-tienda                        # una
```

La herramienta recorre sus sitemaps reales, agrupa las URLs por forma y propone
un `productUrlPattern` con el número de aciertos sobre la muestra. Si dice
`patrón actual acierta 0 · propuesto acierta 3534`, el propuesto es el bueno.

**2. Añade la entrada** en el fichero de su grupo (`connectors/sources/*.ts`):

```ts
declarative({
  id: "mi-tienda",
  label: "Mi Tienda",
  brand: "MiTienda",
  group: null,
  homeUrl: "https://www.mitienda.com/es/",
  // Vacío es válido: el motor lee los `Sitemap:` del robots.txt.
  sitemapUrls: ["https://www.mitienda.com/sitemap.xml"],
  productUrlPattern: String.raw`mitienda\.com\/.+\/p\/\d{6}([?#]|$)`,
  productIdPattern: String.raw`\/p\/(\d{6})`,
  markets: ["ES"],
  tier: "fast_fashion",
  segments: ["women", "men"],
  categories: ["clothing", "footwear"],
  notes: "Sitemap público + JSON-LD en ficha. Sin verificar contra la tienda.",
})
```

**3. Compruébalo contra la tienda real:**

```bash
npm run scraper:probe -- mi-tienda
```

Reporta robots/health, cuántas URLs descubre, y para una ficha: qué extractores
la resolvieron, si hizo falta navegador o IA, y qué campos faltan. No escribe
nada en el catálogo.

**4. Guarda productos de verdad y comprueba la idempotencia:**

```bash
npm run scraper:smoke -- mi-tienda --limit 3
```

Hace dos pases (completo + incremental) y verifica que el segundo no duplica.

**5. Deja el estado honesto.** `verification` y `notes` describen lo que has
comprobado, no lo que esperas. `implemented_verified` **no se declara**: el
servidor lo deriva de que haya productos reales de esa fuente en el catálogo.

### Si la tienda no publica datos estructurados

Añade selectores CSS al spec — sin escribir código:

```ts
selectors: {
  title: "h1.pdp-title",
  price: ".price--current",
  originalPrice: ".price--old",
  images: ".gallery img",
  sizes: ".size-selector button",
  color: "[data-selected-color]",
  productLink: "a.product-card__link",   // para crawl de categorías
  nextPage: "a[rel=next]",
},
```

Y si necesita renderizado, declara qué esperar:

```ts
extraction: { allowBrowser: true, allowAi: true, waitForSelector: ".price--current" },
```

### Si la tienda necesita lógica propia

Solo entonces se hace subclase. Un ejemplo mínimo:

```ts
export class MiTiendaConnector extends BaseConnector {
  constructor(fetchFn?: FetchFn) {
    super(SPEC, fetchFn);
  }

  /** La ficha es una SPA: el estado va en un JSON embebido. */
  protected extractEmbeddedLayer(html: string, $: CheerioAPI): ExtractionLayer | null {
    // `extractBalancedJson` cuenta llaves: un regex perezoso corta en la
    // primera llave anidada y eso significa un precio a null.
    const raw = extractBalancedJson(html, /__STATE__\s*=\s*/i);
    if (!raw) return null;
    const state = JSON.parse(raw);
    return {
      kind: "embedded",
      fields: { title: state.product?.name, price: state.product?.price },
      snippets: { title: "__STATE__ → product.name" },
    };
  }
}
```

Regístrala en `connectors/registry.ts` (mapa `BESPOKE`) y pon
`implementation: "bespoke"` en el spec.

Hooks disponibles: `extractEmbeddedLayer`, `fetchFromFeed`, `isProductUrl`,
`extractSourceProductId`, `parseUrlTaxonomy`, `canonicalize`, `localeHints`.

### Si la tienda requiere acuerdo

Usa `scaffold({...})` con `notes` explicando exactamente qué falta. No
sincronizará, y el admin mostrará `partner_required` con ese motivo literal.

## Herramientas de línea de comandos

| Comando | Qué hace | Escribe en el catálogo |
| --- | --- | --- |
| `npm run scraper:probe [-- ids] [--limit N]` | Diagnóstico por fuente: robots, descubrimiento, extracción | No |
| `npm run scraper:infer [-- ids] [--json]` | Infiere `productUrlPattern` de los sitemaps reales | No |
| `npm run scraper:smoke -- <id> [--limit N]` | E2E: sync, productos, logs, segundo pase sin duplicados | **Sí** |
| `npm run db:migrate` | Aplica migraciones | — |

## Variables de entorno

Todas en `.env.example`. Las que importan:

```env
OPENAI_MODEL=gpt-4o-mini          # extractor de IA (solo fallback)
SCRAPER_AI_ENABLED=true           # false → el scraper sigue, sin fallback de IA
SCRAPER_PLAYWRIGHT_ENABLED=true   # false → solo HTTP plano
SCRAPER_HEADLESS=true
SCRAPER_MAX_CONCURRENCY=2         # páginas/peticiones simultáneas (global)
SCRAPER_REQUEST_DELAY_MS=1200     # espera adicional al Crawl-delay
SCRAPER_NAVIGATION_TIMEOUT_MS=30000
SCRAPER_MAX_RETRIES=2
SCRAPER_AI_MAX_HTML_CHARS=30000   # techo del HTML condensado
SCRAPER_BATCH_SIZE=10             # fichas por invocación
SCRAPER_MAX_PRODUCTS_PER_JOB=100  # techo por job
SCRAPER_LOG_LEVEL=info
SCRAPER_BROWSER_WS_ENDPOINT=      # navegador remoto (producción serverless)
SCRAPER_CHROMIUM_PATH=            # binario concreto de Chromium
```

`OPENAI_API_KEY` se lee **solo en servidor**. Ningún módulo de `ai/` lleva
`"use client"` ni se importa desde componentes: la clave nunca llega al
navegador. `GET /api/catalog/scraper/status` devuelve `apiKeyPresent: true/false`
— nunca la clave.

## Jobs, lotes y reanudación

Un job atraviesa: `queued → discovering → scraping → normalizing → saving →
embedding → completed | partially_completed | failed | cancelled`.

La clave para serverless es que **cada invocación procesa un lote y se va**:

- se procesan hasta `SCRAPER_BATCH_SIZE` fichas, o hasta agotar el presupuesto
  de tiempo de la invocación (`VERCEL_FUNCTION_MAX_DURATION` menos un margen de
  15 s);
- se guarda el checkpoint (URLs descubiertas + índice + contadores);
- se devuelve `completed: false` con el motivo en `stoppedReason`, que **no es un
  fallo**: significa "queda trabajo";
- la siguiente invocación continúa desde el checkpoint sin re-descubrir nada.

`resumeStalled()` recupera lo que una invocación anterior dejó a medias: un job
`running` sin proceso vivo detrás es, de hecho, un `queued` con checkpoint.

## Playwright en Vercel

Hay que ser claro con esto, porque es donde se rompen las expectativas.

**En local funciona sin más.** `playwright-core` está en las dependencias y usa
el Chromium de la caché de Playwright (`npx playwright install chromium`).

**En Vercel, empaquetar Chromium es posible pero mala idea para este uso.** El
límite de tamaño de función es de 5 GB, así que cabe; el problema es el arranque
en frío: descomprimir y lanzar Chromium se come una parte grande del
presupuesto de la invocación, y un job que procesa 10 fichas acabaría gastando
más tiempo arrancando el navegador que extrayendo.

**La vía recomendada es un navegador remoto por CDP:**

```env
SCRAPER_BROWSER_WS_ENDPOINT=wss://tu-navegador-gestionado/?token=...
```

El servicio se conecta con `chromium.connectOverCDP()` y todo lo demás es
idéntico: mismos contextos aislados, mismo rate limit, misma detección de
challenge. Vale cualquier proveedor de navegador gestionado o un contenedor
propio con Chromium expuesto por CDP.

**Y funciona sin navegador.** Con `SCRAPER_PLAYWRIGHT_ENABLED=false`, el
pipeline usa las capas 1-8. Las tiendas con JSON-LD —la mayoría— se extraen
igual; las que dependen de JavaScript quedarán con campos a null y el admin lo
mostrará como tal, en vez de fingir.

El streaming de logs por SSE tiene el mismo tipo de límite: solo entrega los
eventos de **la invocación que atiende el stream**. Por eso el admin cae a
polling contra `/api/catalog/scraper/logs`, que lee de la base de datos y sí ve
lo que hizo otra invocación. La consola dice cuál de los dos transportes está
usando.

## Jobs grandes: el camino

Lo que hay hoy sirve para lotes desde el admin y para catálogos de miles de
productos con cron. Para cientos de miles, el contrato no cambia — cambia quién
llama a `syncProducts()`:

1. **Hoy: cron + lotes.** `/api/cron/catalog-jobs` invoca `drainCatalogJobs()`,
   que reanuda lo pendiente y procesa un lote. Subiendo la frecuencia del cron y
   `SCRAPER_BATCH_SIZE` se escala bastante.

2. **Siguiente: cola durable.** `JobQueue` ya expone `enqueue` / `cancel` /
   `resumeStalled`. Sustituirla por Vercel Queues o similar es implementar esa
   misma interfaz contra la cola: los handlers (`jobs/handlers.ts`) no se tocan,
   porque ya son idempotentes y reanudables por checkpoint.

3. **Para volumen real: worker externo.** Un contenedor con Chromium local, sin
   límite de duración, consumiendo la misma cola y usando `PostgresCatalogStore`
   y `PostgresJobLogSink`. El admin sigue viendo los mismos jobs y los mismos
   logs porque están en la base de datos, no en la memoria del proceso.

Lo que hace posible los tres: **el trabajo se define por checkpoint, no por
proceso**. Nada del pipeline asume que la invocación que empezó el job es la que
lo va a terminar.

## Limitaciones conocidas

- **Embeddings.** El provider por defecto es `hash` (64 dimensiones). Es un
  **fallback de desarrollo**, no un embedding de producción: sirve para dedup
  aproximado, no para búsqueda semántica. Los logs lo dicen en cada ficha
  (`FALLBACK de desarrollo`) y el admin lo marca. Para producción,
  `CATALOG_EMBEDDING_PROVIDER=local` con CLIP, y `reindex_embeddings` después
  (la dimensión cambia y los vectores viejos dejan de ser comparables).
- **Store de fichero.** Sin `DATABASE_URL` válida (cadena `postgres://`) el
  catálogo cae a JSON en disco. Funciona completo para desarrollo, pero **no es
  persistencia de producción** y en Vercel se lanza un error explícito antes de
  usarlo.
- **Coste de IA.** Es una estimación local a partir de los tokens que devuelve la
  API y una tabla de tarifas, no la factura. Un modelo sin tarifa conocida
  devuelve 0 con un aviso, en vez de inventar un precio.
- **Zara, Mango, H&M y otras marcas grandes** bloquean el acceso automatizado a
  nivel de red desde entornos de datacenter. Ver `ESTADO_FUENTES.md` para el
  detalle medido de cada fuente.
