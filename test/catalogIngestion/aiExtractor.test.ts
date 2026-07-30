import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AiProductExtractor, aiOutcomeToLayer } from "../../lib/catalogIngestion/ai/extractor";
import { MemoryAiCache, aiCacheKey, LayeredAiCache, type AiCacheEntry } from "../../lib/catalogIngestion/ai/cache";
import { condenseHtml } from "../../lib/catalogIngestion/ai/condense";
import { AiExtractionSchema, SCHEMA_VERSION, AI_JSON_SCHEMA } from "../../lib/catalogIngestion/ai/schema";
import { estimateCostUsd, isModelPriced } from "../../lib/catalogIngestion/ai/cost";
import { mergeLayers } from "../../lib/catalogIngestion/extraction/types";

/**
 * Tests del extractor por IA con OpenAI SIMULADO. No se llama a la API real:
 * lo que se verifica es nuestro contrato — condensado del HTML, validación de la
 * respuesta, caché, contabilidad de coste y el hecho de que la IA no puede pisar
 * a un extractor fiable.
 */

const PRODUCT_HTML = `<!doctype html><html><head><title>Chaqueta | TiendaX</title>
<script>window.dataLayer=[{"ecommerce":{"detail":true}}];function track(){}</script>
<style>.pdp{color:#000}</style>
<link rel="stylesheet" href="/a.css">
</head><body>
<nav class="menu"><a href="/mujer">Mujer</a><span class="price">Desde 9,99 €</span></nav>
<main><div class="pdp" data-product-id="884221">
  <h1 class="titulo">Chaqueta técnica cortavientos</h1>
  <div class="importe"><s>159,00 €</s><strong>119,50 €</strong></div>
  <table><tr><th>Color</th><td>Verde oliva</td></tr></table>
  <img class="foto" src="https://cdn.tiendax.com/1.jpg" width="900" height="1200">
</div></main>
<div class="recommended"><h2>También te puede gustar</h2><span class="price">39,00 €</span></div>
<footer><span class="price">Envío 4,95 €</span></footer></body></html>`;

/** Respuesta válida del modelo. */
const GOOD_RESPONSE = {
  productType: "product",
  sourceProductId: "884221",
  canonicalUrl: "https://tiendax.com/es/chaqueta-884221",
  brand: null,
  title: "Chaqueta técnica cortavientos",
  model: null,
  description: null,
  category: "chaqueta",
  subcategory: null,
  gender: null,
  color: "Verde oliva",
  secondaryColors: [],
  material: null,
  pattern: null,
  price: 119.5,
  originalPrice: 159,
  currency: "EUR",
  availability: "in_stock",
  sku: null,
  gtin: null,
  sizes: ["S", "M"],
  variants: [],
  imageUrls: ["https://cdn.tiendax.com/1.jpg"],
  confidence: 0.91,
  evidence: [
    { field: "title", snippet: '<h1 class="titulo">Chaqueta técnica cortavientos</h1>', confidence: 1 },
    { field: "price", snippet: "<strong>119,50 €</strong>", confidence: 0.95 },
  ],
  warnings: [],
};

/** Fetch simulado de OpenAI: devuelve lo que se le indique. */
function fakeOpenAi(
  payload: unknown,
  options: { status?: number; usage?: { prompt_tokens: number; completion_tokens: number }; calls?: { n: number } } = {}
): typeof fetch {
  return (async () => {
    if (options.calls) options.calls.n++;
    const status = options.status ?? 200;
    if (status !== 200) {
      return new Response("rate limited", { status });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: typeof payload === "string" ? payload : JSON.stringify(payload) } }],
        usage: options.usage ?? { prompt_tokens: 1000, completion_tokens: 300 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test-fake";
  process.env.OPENAI_MODEL = "gpt-4o-mini";
  process.env.SCRAPER_AI_ENABLED = "true";
  process.env.SCRAPER_MAX_RETRIES = "1";
  delete process.env.OPENAI_PRICE_INPUT_PER_MTOK;
  delete process.env.OPENAI_PRICE_OUTPUT_PER_MTOK;
});

/* ----------------------------- Condensado ------------------------------ */

test("Condensado: quita scripts, estilos, nav, footer y recomendados", () => {
  const result = condenseHtml(PRODUCT_HTML, 30000);
  assert.ok(result.html.length < result.originalChars, "debe reducir el tamaño");
  assert.ok(!/window\.dataLayer/.test(result.html), "fuera el JS");
  assert.ok(!/color:#000/.test(result.html), "fuera el CSS");
  assert.ok(!/Mujer<\/a>/.test(result.html), "fuera el nav");
  assert.ok(!/Envío 4,95/.test(result.html), "fuera el footer");
  // Los "también te puede gustar" son especialmente dañinos: traen OTROS
  // precios que el modelo podría confundir con el del producto.
  assert.ok(!/39,00/.test(result.html), "fuera los recomendados");
  // Y se conserva lo que ES evidencia del producto.
  assert.ok(/Chaqueta técnica cortavientos/.test(result.html));
  assert.ok(/119,50/.test(result.html));
  assert.ok(/Verde oliva/.test(result.html), "la tabla de atributos se conserva");
});

test("Condensado: conserva el JSON-LD residual y los atributos con datos", () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Product","name":"X"}</script></head>
    <body><div data-price="19.99" class="ruido-de-tailwind grid grid-cols-4">19,99</div></body></html>`;
  const result = condenseHtml(html, 30000);
  assert.ok(/application\/ld\+json/.test(result.html));
  assert.ok(/data-price/.test(result.html), "los data-* con datos se conservan");
  assert.ok(!/grid-cols-4/.test(result.html), "las clases de maquetación se van");
});

test("Condensado: trunca al límite y lo declara", () => {
  const result = condenseHtml(PRODUCT_HTML, 200);
  assert.ok(result.truncated);
  assert.ok(result.html.length <= 200 + 60, "cabe el aviso de truncado");
});

test("Condensado: el hash es estable e ignora cambios irrelevantes", () => {
  const a = condenseHtml(PRODUCT_HTML, 30000);
  const b = condenseHtml(PRODUCT_HTML, 30000);
  assert.equal(a.hash, b.hash);

  // Cambiar solo el tracking NO debe invalidar la caché.
  const conTracking = PRODUCT_HTML.replace('{"ecommerce":{"detail":true}}', '{"ecommerce":{"detail":false}}');
  assert.equal(condenseHtml(conTracking, 30000).hash, a.hash);

  // Cambiar el PRECIO sí debe invalidarla.
  const conPrecio = PRODUCT_HTML.replace("119,50", "99,00");
  assert.notEqual(condenseHtml(conPrecio, 30000).hash, a.hash);
});

/* ------------------------------ Esquema -------------------------------- */

test("Esquema: coacciona precios de texto y trata 'N/A' como ausencia", () => {
  const parsed = AiExtractionSchema.parse({
    ...GOOD_RESPONSE,
    price: "119,50 €",
    originalPrice: "1.159,00",
    brand: "N/A",
    material: "  ",
    sizes: null,
  });
  assert.equal(parsed.price, 119.5, "formato europeo con símbolo");
  assert.equal(parsed.originalPrice, 1159, "separador de miles europeo");
  assert.equal(parsed.brand, null, "'N/A' no es una marca");
  assert.equal(parsed.material, null);
  assert.deepEqual(parsed.sizes, []);
});

test("Esquema: un productType inventado cae a 'unknown'", () => {
  const parsed = AiExtractionSchema.parse({ ...GOOD_RESPONSE, productType: "ficha-de-producto" });
  assert.equal(parsed.productType, "unknown");
});

test("Esquema: la confianza se acota a 0-1", () => {
  assert.equal(AiExtractionSchema.parse({ ...GOOD_RESPONSE, confidence: 42 }).confidence, 1);
  assert.equal(AiExtractionSchema.parse({ ...GOOD_RESPONSE, confidence: -3 }).confidence, 0);
  assert.equal(AiExtractionSchema.parse({ ...GOOD_RESPONSE, confidence: "0.8" }).confidence, 0.8);
});

test("Esquema: el JSON Schema enviado a OpenAI es strict y completo", () => {
  assert.equal(AI_JSON_SCHEMA.strict, true);
  assert.equal(AI_JSON_SCHEMA.schema.additionalProperties, false);
  // En modo strict la API exige TODAS las propiedades en `required`.
  const properties = Object.keys(AI_JSON_SCHEMA.schema.properties);
  assert.deepEqual([...properties].sort(), [...AI_JSON_SCHEMA.schema.required].sort());
});

/* ------------------------------- Coste --------------------------------- */

test("Coste: se estima por tokens y se puede sobrescribir la tarifa", () => {
  // 1M entrada + 1M salida de gpt-4o-mini = 0,15 + 0,60 USD.
  assert.equal(estimateCostUsd("gpt-4o-mini", 1_000_000, 1_000_000), 0.75);
  // Los ids con fecha se resuelven por prefijo.
  assert.ok(estimateCostUsd("gpt-4o-mini-2024-07-18", 1_000_000, 0) > 0);
  // Un modelo desconocido devuelve 0 en vez de inventar un precio.
  assert.equal(estimateCostUsd("modelo-inventado-xyz", 1_000_000, 1_000_000), 0);
  assert.equal(isModelPriced("modelo-inventado-xyz"), false);

  process.env.OPENAI_PRICE_INPUT_PER_MTOK = "1";
  process.env.OPENAI_PRICE_OUTPUT_PER_MTOK = "2";
  assert.equal(estimateCostUsd("modelo-inventado-xyz", 1_000_000, 1_000_000), 3);
});

/* ------------------------------- Caché --------------------------------- */

test("Caché: la clave incluye dominio, URL, hash del DOM, esquema y modelo", () => {
  const base = { url: "https://tiendax.com/p/1", domHash: "abc", model: "gpt-4o-mini" };
  const key = aiCacheKey(base);
  assert.notEqual(key, aiCacheKey({ ...base, url: "https://tiendax.com/p/2" }));
  assert.notEqual(key, aiCacheKey({ ...base, domHash: "def" }), "otro DOM, otra clave");
  assert.notEqual(key, aiCacheKey({ ...base, model: "gpt-4o" }), "otro modelo, otra clave");
  assert.equal(key, aiCacheKey({ ...base }), "misma entrada, misma clave");
});

test("Caché en dos niveles: el acierto persistente sube a memoria", async () => {
  const entry: AiCacheEntry = {
    extraction: AiExtractionSchema.parse(GOOD_RESPONSE),
    model: "gpt-4o-mini",
    schemaVersion: SCHEMA_VERSION,
    promptTokens: 100,
    completionTokens: 50,
    costUsd: 0.0001,
    createdAt: new Date().toISOString(),
  };
  let persistentReads = 0;
  const layered = new LayeredAiCache({
    async get(): Promise<AiCacheEntry | null> {
      persistentReads++;
      return entry;
    },
    async set(): Promise<void> {},
  });
  assert.ok(await layered.get("k"));
  assert.ok(await layered.get("k"));
  assert.equal(persistentReads, 1, "el segundo acierto sale de memoria");
});

/* --------------------------- Extractor --------------------------------- */

test("IA: extrae, valida y contabiliza tokens y coste", async () => {
  const ai = new AiProductExtractor(new MemoryAiCache(), fakeOpenAi(GOOD_RESPONSE));
  const out = await ai.extract({
    url: "https://tiendax.com/es/chaqueta-884221",
    html: PRODUCT_HTML,
    domain: "tiendax.com",
    missingFields: ["price", "currency"],
  });

  assert.equal(out.error, null);
  assert.equal(out.extraction.title, "Chaqueta técnica cortavientos");
  assert.equal(out.extraction.price, 119.5);
  assert.equal(out.promptTokens, 1000);
  assert.equal(out.completionTokens, 300);
  assert.equal(out.costUsd, estimateCostUsd("gpt-4o-mini", 1000, 300));
  assert.ok(out.costUsd > 0);
  assert.equal(out.cached, false);
  assert.ok(out.condensed.chars < out.condensed.originalChars);
});

test("IA: el segundo intento con la misma ficha NO vuelve a pagar", async () => {
  const calls = { n: 0 };
  const ai = new AiProductExtractor(new MemoryAiCache(), fakeOpenAi(GOOD_RESPONSE, { calls }));
  const input = {
    url: "https://tiendax.com/es/chaqueta-884221",
    html: PRODUCT_HTML,
    domain: "tiendax.com",
    missingFields: [],
  };
  const first = await ai.extract(input);
  const second = await ai.extract(input);

  assert.equal(calls.n, 1, "una sola llamada a la API");
  assert.equal(second.cached, true);
  assert.equal(second.costUsd, 0, "un acierto de caché no cuesta");
  assert.equal(second.extraction.title, first.extraction.title);
});

test("IA: dos peticiones concurrentes de la misma ficha se fusionan", async () => {
  const calls = { n: 0 };
  const ai = new AiProductExtractor(new MemoryAiCache(), fakeOpenAi(GOOD_RESPONSE, { calls }));
  const input = {
    url: "https://tiendax.com/es/chaqueta-884221",
    html: PRODUCT_HTML,
    domain: "tiendax.com",
    missingFields: [],
  };
  const [a, b] = await Promise.all([ai.extract(input), ai.extract(input)]);
  assert.equal(calls.n, 1, "no se paga dos veces por una carrera");
  assert.equal(a.extraction.title, b.extraction.title);
});

test("IA: una respuesta que no es JSON no rompe nada", async () => {
  const ai = new AiProductExtractor(new MemoryAiCache(), fakeOpenAi("esto no es json {{{"));
  const out = await ai.extract({
    url: "https://tiendax.com/p/1",
    html: PRODUCT_HTML,
    domain: "tiendax.com",
    missingFields: [],
  });
  assert.ok(out.error?.includes("JSON"));
  assert.equal(out.extraction.title, null, "no inventa un título");
});

test("IA: una respuesta que incumple el esquema se rechaza", async () => {
  const ai = new AiProductExtractor(
    new MemoryAiCache(),
    fakeOpenAi({ title: 42, price: { raro: true }, productType: "product" })
  );
  const out = await ai.extract({
    url: "https://tiendax.com/p/1",
    html: PRODUCT_HTML,
    domain: "tiendax.com",
    missingFields: [],
  });
  assert.ok(out.error, "debe reportar el incumplimiento");
});

test("IA: un 4xx no se reintenta en bucle y se reporta", async () => {
  const calls = { n: 0 };
  const ai = new AiProductExtractor(new MemoryAiCache(), fakeOpenAi(null, { status: 401, calls }));
  const out = await ai.extract({
    url: "https://tiendax.com/p/1",
    html: PRODUCT_HTML,
    domain: "tiendax.com",
    missingFields: [],
  });
  assert.equal(calls.n, 1, "un 401 no mejora reintentando");
  assert.ok(out.error?.includes("401"));
});

test("IA desactivada: no llama a la API y lo dice", async () => {
  process.env.SCRAPER_AI_ENABLED = "false";
  const calls = { n: 0 };
  const ai = new AiProductExtractor(new MemoryAiCache(), fakeOpenAi(GOOD_RESPONSE, { calls }));
  assert.equal(ai.isEnabled(), false);
  const out = await ai.extract({
    url: "https://tiendax.com/p/1",
    html: PRODUCT_HTML,
    domain: "tiendax.com",
    missingFields: [],
  });
  assert.equal(calls.n, 0);
  assert.ok(out.error?.includes("desactivada"));
});

test("Sin OPENAI_API_KEY la IA queda deshabilitada sola", async () => {
  delete process.env.OPENAI_API_KEY;
  const ai = new AiProductExtractor(new MemoryAiCache(), fakeOpenAi(GOOD_RESPONSE));
  assert.equal(ai.isEnabled(), false);
});

/* --------------------- La IA como capa del pipeline -------------------- */

test("Capa de IA: un listado no aporta campos de producto", () => {
  const layer = aiOutcomeToLayer({
    extraction: AiExtractionSchema.parse({
      ...GOOD_RESPONSE,
      productType: "listing",
      title: "Chaquetas de mujer",
      price: 49,
    }),
    model: "gpt-4o-mini",
    promptTokens: 100,
    completionTokens: 20,
    costUsd: 0.0001,
    durationMs: 500,
    cached: false,
    error: null,
    condensed: { chars: 100, originalChars: 1000, truncated: false },
  });
  assert.equal(layer.fields.productType, "listing");
  assert.equal(layer.fields.title, undefined, "no se cuela el título del listado");
  assert.equal(layer.fields.price, undefined, "ni el precio");
});

test("Capa de IA: nunca pisa a JSON-LD, solo rellena huecos", () => {
  const aiLayer = aiOutcomeToLayer({
    extraction: AiExtractionSchema.parse({ ...GOOD_RESPONSE, price: 999, color: "Verde oliva" }),
    model: "gpt-4o-mini",
    promptTokens: 10,
    completionTokens: 10,
    costUsd: 0,
    durationMs: 1,
    cached: false,
    error: null,
    condensed: { chars: 1, originalChars: 1, truncated: false },
  });
  const merged = mergeLayers("https://tiendax.com/p/1", [
    { kind: "jsonld", fields: { title: "Título real", price: 119.5, currency: "EUR" } },
    aiLayer,
  ]);
  assert.equal(merged.price, 119.5, "el precio de JSON-LD manda");
  assert.equal(merged.color, "Verde oliva", "el color lo aporta la IA");
  assert.equal(merged.evidence.find((e) => e.field === "price")?.source, "jsonld");
  assert.equal(merged.evidence.find((e) => e.field === "color")?.source, "ai");
});

test("Capa de IA: la evidencia declarada por el modelo se conserva", () => {
  const layer = aiOutcomeToLayer({
    extraction: AiExtractionSchema.parse(GOOD_RESPONSE),
    model: "gpt-4o-mini",
    promptTokens: 10,
    completionTokens: 10,
    costUsd: 0,
    durationMs: 1,
    cached: false,
    error: null,
    condensed: { chars: 1, originalChars: 1, truncated: false },
  });
  assert.ok(layer.snippets?.price?.includes("119,50"), "la cita literal se guarda");
  assert.ok(layer.snippets?.title?.startsWith("IA:"), "se marca como venida de IA");
});
