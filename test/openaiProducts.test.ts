import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProducts } from "../lib/products/openaiProvider";
import type { CatalogItem } from "../lib/catalog/types";

function item(over: Partial<CatalogItem> = {}): CatalogItem {
  const now = new Date().toISOString();
  return {
    id: "i1", videoId: "v1", frameId: null, sourceType: "uploaded", sourceUrl: null,
    timestampSeconds: 10, timestampBucket: 10, fingerprint: "fp", type: "clothing",
    category: "ropa", subcategory: "camiseta", name: "Camiseta blanca oversize",
    description: "Camiseta blanca", color: "blanco", secondaryColors: [], style: "oversize",
    pattern: "liso", materialGuess: "algodón", genderFit: "unisex", visibleBrand: null,
    confidence: 0.9, searchQuery: "camiseta blanca oversize", marketplaceKeywords: [],
    boundingBox: null, imageCropUrl: null, frameImageUrl: null, status: "detected",
    detectionCount: 1, createdAt: now, updatedAt: now, ...over,
  };
}

const SAMPLE = JSON.stringify({
  products: [
    { title: "Camiseta oversize algodón", brand: "Aura", retailer: "Amazon", approx_price_eur: 19.99, similarity: 0.92, reason: "Mismo corte y color" },
    { title: "Tee blanca holgada", brand: "Zalando Basics", retailer: "Zalando", approx_price_eur: 24.5, similarity: 80, reason: "Estilo similar" },
  ],
});

test("parseProducts mapea productos y construye URLs reales", () => {
  const recs = parseProducts(SAMPLE, item());
  assert.equal(recs.length, 2);

  const amazon = recs[0];
  assert.equal(amazon.title, "Camiseta oversize algodón");
  assert.equal(amazon.brand, "Aura");
  assert.ok(amazon.productUrl.startsWith("https://www.amazon.es/s?k="));
  assert.equal(amazon.price, 19.99);
  assert.equal(amazon.currency, "EUR");
  assert.equal(amazon.similarityScore, 0.92);
  assert.ok(amazon.provider.includes("· IA"));
  assert.ok(amazon.imageUrl?.startsWith("data:image/svg+xml"));

  const zalando = recs[1];
  assert.ok(zalando.productUrl.includes("zalando.es"));
  assert.equal(zalando.similarityScore, 0.8, "tolera escala 0-100");
});

test("parseProducts ordena por similitud desc", () => {
  const recs = parseProducts(SAMPLE, item());
  assert.ok((recs[0].similarityScore ?? 0) >= (recs[1].similarityScore ?? 0));
});

test("parseProducts tolera vallas ```json y retailer desconocido → Amazon", () => {
  const raw = "```json\n" + JSON.stringify({ products: [{ title: "Gorra negra", retailer: "TiendaRara", similarity: 0.7 }] }) + "\n```";
  const recs = parseProducts(raw, item());
  assert.equal(recs.length, 1);
  assert.ok(recs[0].productUrl.startsWith("https://www.amazon.es/s?k="));
  assert.equal(recs[0].brand, null);
});

test("parseProducts añade tag de afiliado si está configurado", () => {
  process.env.AMAZON_AFFILIATE_TAG = "mitienda-21";
  try {
    const recs = parseProducts(SAMPLE, item());
    assert.ok(recs[0].productUrl.includes("tag=mitienda-21"));
  } finally {
    delete process.env.AMAZON_AFFILIATE_TAG;
  }
});

test("parseProducts devuelve [] ante basura o sin productos", () => {
  assert.deepEqual(parseProducts("no json", item()), []);
  assert.deepEqual(parseProducts(JSON.stringify({ products: [] }), item()), []);
  assert.deepEqual(parseProducts(JSON.stringify({ products: [{ brand: "x" }] }), item()), []);
});
