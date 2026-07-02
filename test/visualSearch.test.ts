import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchQueries } from "../lib/visualSearch/queryBuilder";
import { rankCandidates, scoreCandidate, dedupeCandidates } from "../lib/visualSearch/rank";
import { decodeImageDataUrl } from "../lib/visualSearch/storage";
import { lensCacheKey, shoppingCacheKey } from "../lib/visualSearch/cache";
import type { VisualCandidate } from "../lib/visualSearch/types";
import type { DetectedItem } from "../lib/types";

function detectedItem(over: Partial<DetectedItem> = {}): DetectedItem {
  return {
    name: "camiseta burdeos con logo en manga",
    category: "ropa",
    subcategory: "camiseta",
    color: "burdeos",
    visible_brand: "Moncler",
    brand_guess: null,
    logo_visible: true,
    logo_description: "logo bordado en la manga izquierda",
    visible_text: null,
    style: "luxury",
    description: "Camiseta burdeos de algodón con logo en manga.",
    search_query_es: "camiseta moncler burdeos logo manga",
    alternative_queries: ["camiseta burdeos hombre premium"],
    verified_provider_queries: [],
    confidence: 0.9,
    gender_fit: "hombre",
    ...over,
  };
}

function candidate(over: Partial<VisualCandidate> = {}): VisualCandidate {
  return {
    source: "serpapi_google_shopping",
    title: "Camiseta básica",
    link: "https://example.com/p/1",
    store: "Example",
    domain: "example.com",
    imageUrl: null,
    price: null,
    currency: null,
    brand: null,
    position: 5,
    exactImageMatch: false,
    queryUsed: "camiseta",
    ...over,
  };
}

test("buildSearchQueries genera queries con marca, color EN y detalle de logo", () => {
  const queries = buildSearchQueries(detectedItem(), 4);
  assert.ok(queries.length >= 2);
  // La primera query debe llevar la marca detectada.
  assert.match(queries[0].toLowerCase(), /moncler/);
  // Alguna query debe traducir burdeos → burgundy y detectar el logo en manga.
  assert.ok(queries.some((q) => /burgundy/.test(q.toLowerCase())));
  assert.ok(queries.some((q) => /logo sleeve|sleeve/.test(q.toLowerCase())));
});

test("buildSearchQueries no inventa marca si no hay evidencia", () => {
  const queries = buildSearchQueries(
    detectedItem({ visible_brand: null, brand_guess: null, search_query_es: "camiseta burdeos hombre" }),
    4
  );
  assert.ok(queries.every((q) => !/moncler|nike|adidas/i.test(q)));
});

test("scoring: marca + color + categoría + tienda fiable puntúan según la spec", () => {
  const item = detectedItem();
  const ranked = scoreCandidate(
    candidate({
      title: "Moncler camiseta burgundy logo manga hombre",
      link: "https://www.zalando.es/moncler-camiseta",
      domain: "zalando.es",
      store: "Zalando",
      price: 250,
    }),
    item
  );
  assert.equal(ranked.scoreBreakdown.same_brand, 50);
  assert.equal(ranked.scoreBreakdown.same_color, 15);
  assert.equal(ranked.scoreBreakdown.same_category, 10);
  assert.equal(ranked.scoreBreakdown.trusted_store, 30);
  assert.equal(ranked.scoreBreakdown.unknown_store, undefined);
  assert.equal(ranked.matchType, "near_exact");
});

test("scoring: exact image match domina y marca match_type=exact", () => {
  const item = detectedItem();
  const exact = scoreCandidate(
    candidate({
      source: "serpapi_google_lens",
      exactImageMatch: true,
      queryUsed: null,
      title: "Moncler t-shirt burgundy",
      link: "https://www.moncler.com/es/camiseta",
      domain: "moncler.com",
    }),
    item
  );
  assert.equal(exact.scoreBreakdown.exact_image_match, 100);
  assert.equal(exact.matchType, "exact");
  // Dominio oficial de la marca detectada cuenta como tienda fiable.
  assert.equal(exact.scoreBreakdown.trusted_store, 30);
});

test("scoring: tienda desconocida resta 20", () => {
  const ranked = scoreCandidate(
    candidate({ title: "camiseta roja", domain: "tienda-random.biz", link: "https://tienda-random.biz/x" }),
    detectedItem()
  );
  assert.equal(ranked.scoreBreakdown.unknown_store, -20);
});

test("rankCandidates ordena por score y deduplica por URL y dominio+título", () => {
  const item = detectedItem();
  const generic = candidate({ title: "camiseta genérica", link: "https://example.com/p/2" });
  const good = candidate({
    title: "Moncler camiseta burgundy",
    link: "https://www.amazon.es/dp/B0XYZ",
    domain: "amazon.es",
    store: "Amazon.es",
  });
  const dupe = { ...good };
  const ranked = rankCandidates([generic, good, dupe], item);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].link, good.link);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("dedupeCandidates conserva el primer candidato de cada URL", () => {
  const a = candidate({ link: "https://x.com/1", title: "A" });
  const b = candidate({ link: "https://x.com/1", title: "B" });
  assert.equal(dedupeCandidates([a, b]).length, 1);
});

test("decodeImageDataUrl produce hash estable por contenido", () => {
  const png = `data:image/png;base64,${Buffer.from("fake-image-bytes").toString("base64")}`;
  const one = decodeImageDataUrl(png);
  const two = decodeImageDataUrl(png);
  assert.ok(one && two);
  assert.equal(one.hash, two.hash);
  assert.equal(one.mime, "image/png");
  assert.equal(decodeImageDataUrl("data:text/plain;base64,aGk="), null);
});

test("claves de caché: lens por hash, shopping por query normalizada", () => {
  assert.equal(lensCacheKey("abc123"), "lens:v1:abc123");
  assert.equal(
    shoppingCacheKey("serpapi_google_shopping", "  Moncler   Burgundy T-Shirt "),
    "shop:v1:serpapi_google_shopping:moncler burgundy t-shirt"
  );
});
