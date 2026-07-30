import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { discoverProductUrls } from "../../lib/catalogIngestion/discovery/index";
import { parseRobots, isPathAllowed } from "../../lib/catalogIngestion/connectors/base/robots";
import { DeclarativeConnector } from "../../lib/catalogIngestion/connectors/base/BaseConnector";
import { declarative } from "../../lib/catalogIngestion/connectors/sources/spec";
import { FileCatalogStore } from "../../lib/catalogIngestion/catalog/fileStore";
import { ingestProduct } from "../../lib/catalogIngestion/catalog/ingest";
import { findDuplicate } from "../../lib/catalogIngestion/catalog/dedup";
import {
  clearJobLogs,
  createJobLogger,
  queryMemoryJobLogs,
  jobLogSummary,
  setJobLogSink,
  flushJobLogs,
  type JobLogEntry,
} from "../../lib/catalogIngestion/observability/jobLog";
import { emptyJobProgress, isActiveJobStatus, hydrateJobProgress } from "../../lib/catalogIngestion/catalog/types";
import type { FetchResult } from "../../lib/catalogIngestion/connectors/base/httpClient";
import { tempDataDir, makeNormalized } from "./helpers";

/**
 * Tests del pipeline de sync completo: descubrimiento con checkpoint, robots,
 * deduplicación, logs por etapas, persistencia e idempotencia.
 *
 * Todo con dobles: el objetivo es probar NUESTRA lógica de forma determinista.
 * La verificación contra tiendas reales es otra cosa y vive en
 * `npm run scraper:smoke` / `npm run scraper:probe`.
 */

/* ------------------------- Descubrimiento ------------------------------- */

const SITEMAP_INDEX = `<?xml version="1.0"?><sitemapindex>
  <sitemap><loc>https://tienda.example.com/sitemap-blog.xml</loc></sitemap>
  <sitemap><loc>https://tienda.example.com/sitemap-products-1.xml</loc></sitemap>
</sitemapindex>`;

const SITEMAP_PRODUCTS = `<?xml version="1.0"?><urlset>
  <url><loc>https://tienda.example.com/es/p/camisa-1001.html</loc></url>
  <url><loc>https://tienda.example.com/es/p/pantalon-1002.html</loc></url>
  <url><loc>https://tienda.example.com/es/categoria/camisas</loc></url>
  <url><loc>https://tienda.example.com/es/p/falda-1003.html</loc></url>
</urlset>`;

const SITEMAP_BLOG = `<?xml version="1.0"?><urlset>
  <url><loc>https://tienda.example.com/es/blog/tendencias</loc></url>
</urlset>`;

const isProductUrl = (url: string): boolean => /\/p\/[a-z]+-\d+\.html/.test(url);
const canonicalize = (url: string): string => {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
};

function docFetcher(docs: Record<string, string>, log?: string[]) {
  return async (url: string): Promise<string | null> => {
    log?.push(url);
    return docs[url] ?? null;
  };
}

test("Descubrimiento: recorre el índice, prioriza el sitemap de producto y filtra", async () => {
  const visited: string[] = [];
  const result = await discoverProductUrls({
    strategies: [{ kind: "sitemap", urls: ["https://tienda.example.com/sitemap.xml"] }],
    robotsSitemaps: [],
    isProductUrl,
    canonicalize,
    limit: 10,
    fetchDocument: docFetcher(
      {
        "https://tienda.example.com/sitemap.xml": SITEMAP_INDEX,
        "https://tienda.example.com/sitemap-products-1.xml": SITEMAP_PRODUCTS,
        "https://tienda.example.com/sitemap-blog.xml": SITEMAP_BLOG,
      },
      visited
    ),
  });

  assert.equal(result.urls.length, 3, "solo las tres fichas");
  assert.ok(result.urls.every(isProductUrl), "ninguna categoría ni blog");
  // Prioridad: tras el índice va el sitemap que suena a producto, NO el de blog.
  assert.equal(visited[1], "https://tienda.example.com/sitemap-products-1.xml");
  assert.ok(result.checkpoint.done);
  assert.deepEqual(result.strategiesUsed, ["sitemap"]);
});

test("Descubrimiento: prioriza el sitemap del mercado declarado", async () => {
  const visited: string[] = [];
  const index = `<sitemapindex>
    <sitemap><loc>https://t.example.com/pt_PT/products.xml</loc></sitemap>
    <sitemap><loc>https://t.example.com/en_AT/products.xml</loc></sitemap>
    <sitemap><loc>https://t.example.com/es_ES/products.xml</loc></sitemap>
  </sitemapindex>`;
  await discoverProductUrls({
    strategies: [{ kind: "sitemap", urls: ["https://t.example.com/sitemap.xml"] }],
    robotsSitemaps: [],
    isProductUrl,
    canonicalize,
    limit: 5,
    localeHints: ["es_ES"],
    maxRequests: 2,
    fetchDocument: docFetcher({ "https://t.example.com/sitemap.xml": index }, visited),
  });
  // Con presupuesto para 2 peticiones, la segunda DEBE ser la de es_ES: es lo
  // que evita gastar el presupuesto en Portugal y Austria.
  assert.equal(visited[1], "https://t.example.com/es_ES/products.xml");
});

test("Descubrimiento: se reanuda desde el checkpoint sin repetir peticiones", async () => {
  const docs = {
    "https://tienda.example.com/sitemap.xml": SITEMAP_INDEX,
    "https://tienda.example.com/sitemap-products-1.xml": SITEMAP_PRODUCTS,
    "https://tienda.example.com/sitemap-blog.xml": SITEMAP_BLOG,
  };

  const firstVisits: string[] = [];
  const first = await discoverProductUrls({
    strategies: [{ kind: "sitemap", urls: ["https://tienda.example.com/sitemap.xml"] }],
    robotsSitemaps: [],
    isProductUrl,
    canonicalize,
    limit: 10,
    // Solo una petición: se queda a medias a propósito.
    maxRequests: 1,
    fetchDocument: docFetcher(docs, firstVisits),
  });
  assert.equal(first.urls.length, 0);
  assert.equal(first.checkpoint.done, false, "queda trabajo pendiente");
  assert.ok(first.checkpoint.queue.length > 0);

  const secondVisits: string[] = [];
  const second = await discoverProductUrls({
    strategies: [{ kind: "sitemap", urls: ["https://tienda.example.com/sitemap.xml"] }],
    robotsSitemaps: [],
    isProductUrl,
    canonicalize,
    limit: 10,
    checkpoint: first.checkpoint,
    fetchDocument: docFetcher(docs, secondVisits),
  });
  assert.equal(second.urls.length, 3, "la reanudación completa el trabajo");
  assert.ok(
    !secondVisits.includes("https://tienda.example.com/sitemap.xml"),
    "no vuelve a pedir lo ya visitado"
  );
});

test("Descubrimiento: crawl de categorías sigue la paginación", async () => {
  const page1 = `<html><body>
    <a href="/es/p/camisa-2001.html">A</a><a href="/es/p/camisa-2002.html">B</a>
    <link rel="next" href="/es/categoria/camisas?page=2">
  </body></html>`;
  const page2 = `<html><body><a href="/es/p/camisa-2003.html">C</a></body></html>`;

  const result = await discoverProductUrls({
    strategies: [
      { kind: "category_crawl", urls: ["https://tienda.example.com/es/categoria/camisas"], maxPages: 3 },
    ],
    robotsSitemaps: [],
    isProductUrl,
    canonicalize,
    limit: 10,
    fetchDocument: docFetcher({
      "https://tienda.example.com/es/categoria/camisas": page1,
      "https://tienda.example.com/es/categoria/camisas?page=2": page2,
    }),
  });
  assert.equal(result.urls.length, 3, "sigue a la página 2");
  assert.deepEqual(result.strategiesUsed, ["category_crawl"]);
});

test("Descubrimiento: deduplica URLs que llegan por varias vías", async () => {
  const duplicado = `<urlset>
    <url><loc>https://tienda.example.com/es/p/camisa-1001.html</loc></url>
    <url><loc>https://tienda.example.com/es/p/camisa-1001.html?utm_source=x</loc></url>
    <url><loc>https://tienda.example.com/es/p/camisa-1001.html#reviews</loc></url>
  </urlset>`;
  const result = await discoverProductUrls({
    strategies: [{ kind: "sitemap", urls: ["https://tienda.example.com/s.xml"] }],
    robotsSitemaps: [],
    isProductUrl,
    canonicalize,
    limit: 10,
    fetchDocument: docFetcher({ "https://tienda.example.com/s.xml": duplicado }),
  });
  // El tracking y el fragmento no hacen un producto nuevo.
  assert.equal(result.urls.length, 1);
});

test("Descubrimiento: respeta el límite exacto", async () => {
  const result = await discoverProductUrls({
    strategies: [{ kind: "sitemap", urls: ["https://tienda.example.com/s.xml"] }],
    robotsSitemaps: [],
    isProductUrl,
    canonicalize,
    limit: 2,
    fetchDocument: docFetcher({ "https://tienda.example.com/s.xml": SITEMAP_PRODUCTS }),
  });
  assert.equal(result.urls.length, 2);
});

/* ------------------------------- robots -------------------------------- */

test("robots.txt: Disallow, Allow más específico y Crawl-delay", () => {
  const rules = parseRobots(
    `User-agent: *
Crawl-delay: 2
Disallow: /checkout/
Disallow: /es/carrito
Allow: /es/carrito/publico
Sitemap: https://tienda.example.com/sitemap.xml`,
    "catalog-scraper/1.0"
  );
  assert.equal(rules.crawlDelaySeconds, 2);
  assert.deepEqual(rules.sitemaps, ["https://tienda.example.com/sitemap.xml"]);
  assert.equal(isPathAllowed(rules, "/es/p/camisa-1.html"), true);
  assert.equal(isPathAllowed(rules, "/checkout/pago"), false);
  assert.equal(isPathAllowed(rules, "/es/carrito"), false);
  // Allow más específico gana al Disallow, como manda el estándar.
  assert.equal(isPathAllowed(rules, "/es/carrito/publico"), true);
});

test("robots.txt: un grupo específico para nuestro agente gana al comodín", () => {
  const rules = parseRobots(
    `User-agent: *
Disallow: /

User-agent: catalog-scraper
Disallow: /admin/`,
    "catalog-scraper/1.0"
  );
  assert.equal(isPathAllowed(rules, "/es/p/x-1.html"), true);
  assert.equal(isPathAllowed(rules, "/admin/panel"), false);
});

/* ------------------------- Dedup y persistencia ------------------------ */

let store: FileCatalogStore;

beforeEach(async () => {
  tempDataDir(`sync-${Math.random().toString(36).slice(2)}`);
  store = new FileCatalogStore();
  await store.init();
  clearJobLogs();
  setJobLogSink(null);
});

test("Dedup: la misma ficha revisitada actualiza, no duplica", async () => {
  const first = await ingestProduct(store, makeNormalized({ sourceProductId: "A1", contentHash: "h1" }));
  assert.equal(first.isNew, true);

  const second = await ingestProduct(
    store,
    makeNormalized({
      sourceProductId: "A1",
      canonicalUrl: first.product.canonicalUrl,
      contentHash: "h2",
      price: 24.99,
    })
  );
  assert.equal(second.isNew, false);
  assert.equal(second.changed, true, "cambió el contentHash: se actualiza");
  assert.equal(second.dedupLevel, "source_product_id");
  assert.equal(await store.countProducts(), 1, "sigue habiendo UN producto");
  assert.equal((await store.getProduct(first.product.id))?.price, 24.99);
});

test("Dedup: contentHash idéntico solo refresca lastSeenAt", async () => {
  const first = await ingestProduct(store, makeNormalized({ sourceProductId: "B1", contentHash: "same" }));
  const second = await ingestProduct(
    store,
    makeNormalized({
      sourceProductId: "B1",
      canonicalUrl: first.product.canonicalUrl,
      contentHash: "same",
    })
  );
  assert.equal(second.changed, false);
  assert.equal(await store.countProducts(), 1);
});

test("Dedup: DOS productos de la MISMA tienda con fotos parecidas NO se fusionan", async () => {
  // Regresión de un fallo real: tres productos distintos de Ecoalf se
  // fusionaron en uno porque su fotografía de catálogo (objeto centrado sobre
  // fondo blanco) hacía colisionar el dHash. Dentro de una tienda, el id de la
  // tienda es la autoridad.
  const hash = "4cb2b3717171310c";
  await ingestProduct(
    store,
    makeNormalized({
      source: "ecoalf",
      sourceProductId: "BOTELLA-NEGRA",
      canonicalUrl: "https://ecoalf.com/es/products/botella-negra",
      perceptualHash: hash,
      title: "Botella negra",
    })
  );
  const second = await ingestProduct(
    store,
    makeNormalized({
      source: "ecoalf",
      sourceProductId: "BOTELLA-VERDE",
      canonicalUrl: "https://ecoalf.com/es/products/botella-verde",
      perceptualHash: hash, // MISMO hash perceptual
      title: "Botella verde",
    })
  );

  assert.equal(second.isNew, true, "debe crearse como producto nuevo");
  assert.equal(await store.countProducts("ecoalf"), 2);
});

test("Dedup: el MISMO producto en tiendas DISTINTAS sí se detecta como duplicado", async () => {
  // El caso legítimo del dedup visual, que la guarda anterior no debe romper.
  const hash = "aaaabbbbccccdddd";
  await ingestProduct(
    store,
    makeNormalized({ source: "zara", sourceProductId: "Z1", perceptualHash: hash })
  );
  const match = await findDuplicate(store, {
    source: "elcorteingles",
    sourceProductId: "E1",
    canonicalUrl: "https://elcorteingles.es/x",
    sku: null,
    gtin: null,
    brand: "Zara",
    title: "Otro título",
    color: null,
    imageSha256: null,
    perceptualHash: hash,
    imageEmbedding: null,
  });
  assert.equal(match?.level, "perceptual_hash");
});

test("Dedup: dos fichas de la misma tienda con el MISMO SKU sí se unifican", async () => {
  await ingestProduct(
    store,
    makeNormalized({ source: "mango", sourceProductId: "M1", sku: "SKU-9", perceptualHash: "1111" })
  );
  const match = await findDuplicate(store, {
    source: "mango",
    sourceProductId: "M2",
    canonicalUrl: "https://shop.mango.com/otro",
    sku: "SKU-9",
    gtin: null,
    brand: "Mango",
    title: "x",
    color: null,
    imageSha256: null,
    perceptualHash: null,
    imageEmbedding: null,
  });
  assert.equal(match?.level, "sku_gtin");
});

test("Persistencia: una talla NO crea un producto por talla", async () => {
  const result = await ingestProduct(
    store,
    makeNormalized({
      sourceProductId: "T1",
      sizes: ["XS", "S", "M", "L", "XL"],
      variants: [
        { id: "T1-0", color: "negro", size: "XS", sku: "T1-XS", price: 19.99, currency: "EUR", availability: "in_stock" },
        { id: "T1-1", color: "negro", size: "S", sku: "T1-S", price: 19.99, currency: "EUR", availability: "out_of_stock" },
      ],
    })
  );
  assert.equal(await store.countProducts(), 1, "un producto, no cinco");
  const saved = await store.getProduct(result.product.id);
  assert.equal(saved?.sizes.length, 5);
  assert.equal(saved?.variants.length, 2);
});

test("Persistencia: el histórico de precios registra el cambio", async () => {
  const first = await ingestProduct(store, makeNormalized({ sourceProductId: "P1", price: 50, contentHash: "a" }));
  await ingestProduct(
    store,
    makeNormalized({
      sourceProductId: "P1",
      canonicalUrl: first.product.canonicalUrl,
      price: 35,
      contentHash: "b",
    })
  );
  const saved = await store.getProduct(first.product.id);
  assert.ok((saved?.priceHistory.length ?? 0) >= 2, "hay histórico de al menos dos precios");
  assert.equal(saved?.price, 35);
});

test("Persistencia: la trazabilidad de extracción se guarda y se agrega", async () => {
  await ingestProduct(
    store,
    makeNormalized({
      source: "tienda-x",
      sourceProductId: "X1",
      extraction: {
        extractorsUsed: ["jsonld"],
        primaryExtractor: "jsonld",
        aiUsed: false,
        browserUsed: false,
        aiModel: null,
        aiCostUsd: 0,
        aiTokens: 0,
        confidence: 0.9,
        evidence: [{ field: "title", source: "jsonld", snippet: "ld+json name", confidence: 0.97 }],
        warnings: [],
        extractedAt: new Date().toISOString(),
        durationMs: 120,
      },
    })
  );
  await ingestProduct(
    store,
    makeNormalized({
      source: "tienda-x",
      sourceProductId: "X2",
      extraction: {
        extractorsUsed: ["heuristics", "ai"],
        primaryExtractor: "ai",
        aiUsed: true,
        browserUsed: true,
        aiModel: "gpt-4o-mini",
        aiCostUsd: 0.00035,
        aiTokens: 1400,
        confidence: 0.6,
        evidence: [],
        warnings: ["IA: el HTML se truncó antes de enviarlo"],
        extractedAt: new Date().toISOString(),
        durationMs: 8000,
      },
    })
  );

  const stats = await store.extractionStats("tienda-x");
  assert.equal(stats.total, 2);
  assert.equal(stats.withAi, 1);
  assert.equal(stats.withoutAi, 1);
  assert.equal(stats.withBrowser, 1);
  assert.equal(stats.aiRatio, 0.5);
  assert.equal(stats.aiCostUsd, 0.00035);
  assert.deepEqual(stats.byPrimaryExtractor, { jsonld: 1, ai: 1 });
});

/* ------------------------------- Logs ---------------------------------- */

test("Logs: se registran por etapa y se pueden filtrar y resumir", () => {
  const log = createJobLogger("job-1", "zara");
  log({ stage: "robots", level: "info", message: "permitido · crawl-delay 1,2 s" });
  log({ stage: "discover", level: "info", message: "248 URLs encontradas" });
  log({ stage: "parse_jsonld", level: "success", message: "extraído sin IA", durationMs: 40 });
  log({ stage: "ai_extract", level: "warn", message: "falta color, activando IA" });
  log({ stage: "error", level: "error", message: "HTTP 500", url: "https://zara.com/x" });

  const all = queryMemoryJobLogs({ jobId: "job-1" });
  assert.equal(all.length, 5);
  // Más recientes primero: es como los lee el admin.
  assert.equal(all[0].stage, "error");

  assert.equal(queryMemoryJobLogs({ jobId: "job-1", level: "warn" }).length, 2);
  assert.equal(queryMemoryJobLogs({ jobId: "job-1", stage: "discover" }).length, 1);
  assert.equal(queryMemoryJobLogs({ jobId: "job-1", q: "IA" }).length, 2);
  assert.equal(queryMemoryJobLogs({ connectorId: "otra" }).length, 0);

  const summary = jobLogSummary("job-1");
  assert.equal(summary.total, 5);
  assert.equal(summary.byLevel.error, 1);
  assert.equal(summary.byStage.discover, 1);
});

test("Logs: el cursor `seq` permite streaming incremental sin repetir", () => {
  const log = createJobLogger("job-2", "mango");
  log({ stage: "job", level: "info", message: "primera" });
  const afterFirst = queryMemoryJobLogs({ jobId: "job-2" })[0].seq;
  log({ stage: "job", level: "info", message: "segunda" });
  log({ stage: "job", level: "info", message: "tercera" });

  const nuevas = queryMemoryJobLogs({ jobId: "job-2", afterSeq: afterFirst });
  assert.equal(nuevas.length, 2);
  assert.ok(nuevas.every((e) => e.seq > afterFirst));
});

test("Logs: un sink que falla NO rompe el job", async () => {
  setJobLogSink({
    async write(): Promise<void> {
      throw new Error("la base de datos se cayó");
    },
    async query(): Promise<JobLogEntry[]> {
      return [];
    },
  });
  const log = createJobLogger("job-3", "hm");
  assert.doesNotThrow(() => log({ stage: "job", level: "info", message: "sigue funcionando" }));
  await assert.doesNotReject(() => flushJobLogs());
  // El evento sigue en memoria aunque no se haya persistido.
  assert.equal(queryMemoryJobLogs({ jobId: "job-3" }).length, 1);
  setJobLogSink(null);
});

/* -------------------- Sync completo con checkpoint --------------------- */

const SPEC = declarative({
  id: "tienda-test",
  label: "Tienda de prueba",
  brand: "TiendaTest",
  homeUrl: "https://tienda.example.com/es/",
  sitemapUrls: ["https://tienda.example.com/sitemap.xml"],
  productUrlPattern: String.raw`tienda\.example\.com\/es\/p\/[a-z]+-\d+\.html`,
  productIdPattern: String.raw`-(\d+)\.html`,
  // Sin navegador ni IA: este test comprueba el BUCLE, no la extracción.
  extraction: { allowBrowser: false, allowAi: false },
});

function productHtml(id: string, price: number): string {
  return `<html><head><script type="application/ld+json">
    {"@type":"Product","name":"Producto ${id}","brand":{"name":"TiendaTest"},
     "image":["https://tienda.example.com/img/${id}.jpg"],
     "offers":{"@type":"Offer","price":"${price}","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}
  </script></head><body><h1>Producto ${id}</h1></body></html>`;
}

/** Conector con red simulada: sitemap + tres fichas. */
function testConnector(counter?: { requests: string[] }): DeclarativeConnector {
  const fetchFn = async (url: string): Promise<FetchResult> => {
    counter?.requests.push(url);
    if (url.includes("sitemap")) {
      return { status: 200, body: SITEMAP_PRODUCTS, contentType: "application/xml" };
    }
    const id = /-(\d+)\.html/.exec(url)?.[1] ?? "0";
    return { status: 200, body: productHtml(id, 10 + Number(id) % 100), contentType: "text/html" };
  };
  return new DeclarativeConnector(SPEC, fetchFn);
}

test("Sync: extrae, guarda y reporta cada etapa en los logs", async () => {
  const connector = testConnector();
  const summary = await connector.syncProducts({
    store,
    mode: "full",
    limit: 5,
    downloadImages: false,
    jobId: "job-sync-1",
  });

  assert.equal(summary.completed, true);
  assert.equal(summary.progress.discovered, 3);
  assert.equal(summary.progress.fetched, 3);
  assert.equal(summary.progress.new, 3);
  assert.equal(summary.progress.errors, 0);
  // Sin IA ni navegador: todo resuelto con datos estructurados.
  assert.equal(summary.progress.withAi, 0);
  assert.equal(summary.progress.withoutAi, 3);
  assert.equal(summary.progress.aiCostUsd, 0);
  assert.equal(await store.countProducts("tienda-test"), 3);

  const stages = new Set(queryMemoryJobLogs({ jobId: "job-sync-1", limit: 500 }).map((e) => e.stage));
  for (const expected of ["robots", "discover", "navigate", "parse_jsonld", "normalize", "database", "complete"]) {
    assert.ok(stages.has(expected as never), `falta la etapa ${expected} en los logs`);
  }
});

test("Sync: un segundo pase incremental NO duplica", async () => {
  const connector = testConnector();
  await connector.syncProducts({ store, mode: "full", limit: 5, downloadImages: false });
  const afterFirst = await store.countProducts("tienda-test");

  const second = await connector.syncProducts({
    store,
    mode: "incremental",
    limit: 5,
    downloadImages: false,
  });
  assert.equal(await store.countProducts("tienda-test"), afterFirst, "sin productos nuevos");
  assert.equal(second.progress.new, 0);
  assert.equal(second.progress.duplicates, 3);
});

test("Sync por lotes: guarda checkpoint y la siguiente invocación continúa", async () => {
  const connector = testConnector();
  let checkpoint: Record<string, unknown> = {};

  const first = await connector.syncProducts({
    store,
    mode: "full",
    limit: 5,
    downloadImages: false,
    batchSize: 2,
    onProgress: async (_p, cp) => {
      checkpoint = cp;
    },
  });
  assert.equal(first.completed, false, "queda trabajo: el lote era de 2");
  assert.ok(first.stoppedReason?.includes("lote"));
  assert.equal(await store.countProducts("tienda-test"), 2);
  assert.equal(checkpoint.index, 2);

  const second = await connector.syncProducts({
    store,
    mode: "full",
    limit: 5,
    downloadImages: false,
    batchSize: 2,
    checkpoint,
  });
  assert.equal(second.completed, true);
  assert.equal(await store.countProducts("tienda-test"), 3, "el tercer producto se procesó");
  // Los contadores del job se acumulan entre lotes, no se reinician.
  assert.equal(second.progress.new, 3);
});

test("Sync: el checkpoint evita re-descubrir el catálogo al reanudar", async () => {
  const counter = { requests: [] as string[] };
  const connector = testConnector(counter);
  let checkpoint: Record<string, unknown> = {};
  await connector.syncProducts({
    store,
    mode: "full",
    limit: 5,
    downloadImages: false,
    batchSize: 1,
    onProgress: async (_p, cp) => {
      checkpoint = cp;
    },
  });
  const sitemapRequests = counter.requests.filter((u) => u.includes("sitemap")).length;
  counter.requests.length = 0;

  await connector.syncProducts({
    store,
    mode: "full",
    limit: 5,
    downloadImages: false,
    batchSize: 1,
    checkpoint,
  });
  assert.equal(
    counter.requests.filter((u) => u.includes("sitemap")).length,
    0,
    `la reanudación no repite el descubrimiento (el primer pase hizo ${sitemapRequests})`
  );
});

test("Sync: cancelar deja el job reanudable, no roto", async () => {
  const connector = testConnector();
  let processed = 0;
  const summary = await connector.syncProducts({
    store,
    mode: "full",
    limit: 5,
    downloadImages: false,
    shouldCancel: () => processed++ >= 1,
  });
  assert.equal(summary.completed, false);
  assert.ok(summary.stoppedReason?.includes("cancel"));
  assert.ok(await store.countProducts("tienda-test") >= 1, "lo procesado se conserva");
});

test("Sync: una ficha que falla no tumba el job entero", async () => {
  const connector = new DeclarativeConnector(SPEC, async (url) => {
    if (url.includes("sitemap")) {
      return { status: 200, body: SITEMAP_PRODUCTS, contentType: "application/xml" };
    }
    if (url.includes("1002")) return { status: 500, body: "boom", contentType: "text/html" };
    const id = /-(\d+)\.html/.exec(url)?.[1] ?? "0";
    return { status: 200, body: productHtml(id, 20), contentType: "text/html" };
  });
  const summary = await connector.syncProducts({
    store,
    mode: "full",
    limit: 5,
    downloadImages: false,
    jobId: "job-err",
  });
  assert.equal(summary.progress.errors, 1);
  assert.equal(summary.progress.new, 2, "las otras dos sí entran");
  assert.equal(summary.completed, true);
  assert.ok(queryMemoryJobLogs({ jobId: "job-err", level: "error" }).length >= 1);
});

/* ----------------------- Modelo de jobs -------------------------------- */

test("Estados de job: las etapas cuentan como activas", () => {
  for (const status of ["running", "discovering", "scraping", "normalizing", "saving", "embedding"] as const) {
    assert.equal(isActiveJobStatus(status), true, `${status} debe ser activo`);
  }
  for (const status of ["queued", "completed", "failed", "cancelled", "partially_completed"] as const) {
    assert.equal(isActiveJobStatus(status), false, `${status} no debe ser activo`);
  }
});

test("hydrateJobProgress rellena los contadores de un job antiguo", () => {
  const legacy = { discovered: 5, fetched: 5, new: 5, updated: 0, duplicates: 0, errors: 0 };
  const hydrated = hydrateJobProgress(legacy as never);
  assert.equal(hydrated.discovered, 5);
  assert.equal(hydrated.withAi, 0);
  assert.equal(hydrated.aiCostUsd, 0);
  assert.equal(hydrated.stage, null);
  assert.deepEqual(Object.keys(hydrated).sort(), Object.keys(emptyJobProgress()).sort());
});
