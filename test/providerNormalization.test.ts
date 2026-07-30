import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  normalizeLensResponse,
  normalizeSection,
} from "../lib/visualSearch/reverseImage/providers";
import {
  evaluatePreliminaryResultQuality,
  isCommercialCandidate,
  isNonCommercialDomain,
} from "../lib/visualSearch/reverseImage/resultQuality";
import { lensCropCacheKey, queryHash, shoppingCacheKey } from "../lib/visualSearch/cache";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", name), "utf8")
  ) as Record<string, unknown>;
}

// --- normalización con fixtures reales (anonimizadas) --------------------------

test("SearchAPI all: normaliza exact_matches y visual_matches con alias de campos", () => {
  const results = normalizeLensResponse(
    fixture("searchapi-lens-all.json"),
    "searchapi_google_lens",
    "black floral shirt"
  );
  // 3 válidos (Zalando exact, Pinterest exact, visual con url/merchant/image);
  // el que no tiene link se descarta.
  assert.equal(results.length, 3);
  const zalando = results.find((r) => r.domain === "zalando.es")!;
  assert.equal(zalando.exactImageMatch, true);
  assert.equal(zalando.price, 49.95);
  assert.equal(zalando.queryUsed, "black floral shirt");
  // Alias: url→link, merchant→store, image→imageUrl, extracted_price→price.
  const visual = results.find((r) => r.domain === "store.example")!;
  assert.equal(visual.store, "Store Example");
  assert.equal(visual.imageUrl, "https://img.example/visual-1.jpg");
  assert.equal(visual.price, 39.9);
});

test("SearchAPI products: alias product_link/seller/image_url y precio en string", () => {
  const results = normalizeLensResponse(
    fixture("searchapi-lens-products.json"),
    "searchapi_google_lens",
    null
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].link, "https://www.amazon.es/dp/B0TESTFIX");
  assert.equal(results[0].store, "Amazon.es");
  assert.equal(results[0].imageUrl, "https://img.example/amazon-thumb.jpg");
  assert.equal(results[0].price, 39.95);
  assert.equal(results[0].currency, "EUR");
});

test("SerpAPI: normaliza ambas secciones con url/link indistintos", () => {
  const results = normalizeLensResponse(
    fixture("serpapi-lens.json"),
    "serpapi_google_lens",
    null
  );
  assert.equal(results.length, 2);
  assert.ok(results.some((r) => r.domain === "asos.com"));
  assert.ok(results.some((r) => r.domain === "ebay.es" && r.exactImageMatch));
});

test("normalizeSection no inventa valores: sin title o link → descartado y contado", () => {
  const metrics = { received: 0, discardedNoTitle: 0, discardedNoLink: 0 };
  const out = normalizeSection(
    [{ title: "solo título" }, { link: "https://x.test" }, "basura", null],
    "searchapi_google_lens",
    "products",
    null,
    "products",
    metrics
  );
  assert.equal(out.length, 0);
  assert.equal(metrics.received, 2);
  assert.equal(metrics.discardedNoLink, 1);
  assert.equal(metrics.discardedNoTitle, 1);
});

// --- evaluación preliminar ------------------------------------------------------

test("cero resultados → shouldFallback con no_results", () => {
  const q = evaluatePreliminaryResultQuality([]);
  assert.equal(q.shouldFallback, true);
  assert.equal(q.fallbackReason, "no_results");
});

test("un exact de Pinterest NO cuenta como señal comercial", () => {
  const results = normalizeLensResponse(
    fixture("searchapi-lens-all.json"),
    "searchapi_google_lens",
    null
  );
  const pinterest = results.find((r) => r.domain?.includes("pinterest"))!;
  assert.equal(isNonCommercialDomain(pinterest.domain), true);
  assert.equal(isCommercialCandidate(pinterest), false);
  const q = evaluatePreliminaryResultQuality(results);
  // Zalando (exact comercial) + visual comprable → señal suficiente.
  assert.equal(q.exactCount, 1);
  assert.equal(q.shouldFallback, false);
});

test("solo resultados no comerciales → shouldFallback (no_useful_results)", () => {
  const results = normalizeLensResponse(
    fixture("searchapi-lens-all.json"),
    "searchapi_google_lens",
    null
  ).filter((r) => r.domain?.includes("pinterest"));
  const q = evaluatePreliminaryResultQuality(results);
  assert.equal(q.shouldFallback, true);
  assert.equal(q.fallbackReason, "no_useful_results");
});

// --- caché versionada ------------------------------------------------------------

test("lensCropCacheKey v4 incluye query, estrategia, país y versiones (no v1)", () => {
  const key = lensCropCacheKey({
    cropHash: "abc123",
    query: "black floral shirt",
    strategy: "visual_first",
    country: "ES",
    language: "es",
  });
  assert.ok(key.startsWith("lens-raw:v4:abc123:"));
  assert.ok(key.includes(":visual_first:es:es:"));
  assert.ok(!key.includes("v1"));
});

test("la MISMA imagen con OTRA query produce otra cache key", () => {
  const base = { cropHash: "abc123", strategy: "visual_first", country: "ES", language: "es" };
  const a = lensCropCacheKey({ ...base, query: "black shirt" });
  const b = lensCropCacheKey({ ...base, query: "black hawaiian shirt floral" });
  assert.notEqual(a, b);
});

test("queryHash normaliza espacios/mayúsculas y shoppingCacheKey es v2", () => {
  assert.equal(queryHash("  Black  Shirt "), queryHash("black shirt"));
  assert.ok(shoppingCacheKey("dataforseo", "Camisa Negra").startsWith("shop:v2:"));
});
