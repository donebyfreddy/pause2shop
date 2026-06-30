import { test } from "node:test";
import assert from "node:assert/strict";
import { MockProductProvider } from "../lib/products/mockProvider";
import { searchProducts } from "../lib/products/searchProducts";
import type { CatalogItem } from "../lib/catalog/types";

function catalogItem(over: Partial<CatalogItem> = {}): CatalogItem {
  const now = new Date().toISOString();
  return {
    id: "item-1",
    videoId: "v1",
    frameId: null,
    sourceType: "uploaded",
    sourceUrl: null,
    timestampSeconds: 10,
    timestampBucket: 10,
    fingerprint: "v1|ropa|blanco|oversize|_|10",
    type: "clothing",
    category: "ropa",
    subcategory: "camiseta",
    name: "Camiseta blanca oversize",
    description: "Camiseta blanca.",
    color: "blanco",
    secondaryColors: [],
    style: "oversize",
    pattern: "liso",
    materialGuess: "algodón",
    genderFit: "unisex",
    visibleBrand: null,
    confidence: 0.9,
    searchQuery: "camiseta blanca oversize",
    marketplaceKeywords: ["camiseta blanca oversize"],
    boundingBox: null,
    imageCropUrl: null,
    frameImageUrl: null,
    status: "detected",
    detectionCount: 1,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

test("MockProductProvider devuelve productos realistas y completos", async () => {
  const provider = new MockProductProvider();
  assert.equal(provider.isEnabled(), true);

  const item = catalogItem();
  const recs = await provider.search(item.searchQuery!, item);

  assert.ok(recs.length >= 3 && recs.length <= 5);
  for (const r of recs) {
    assert.ok(r.title.length > 0);
    assert.ok(r.productUrl.startsWith("http"));
    assert.ok(r.imageUrl && r.imageUrl.startsWith("data:image/svg+xml"));
    assert.equal(r.currency, "EUR");
    assert.ok((r.price ?? 0) > 0);
    assert.ok((r.similarityScore ?? 0) >= 0.4 && (r.similarityScore ?? 0) <= 1);
    assert.ok(r.provider.includes("(demo)"));
  }
  // Ordenadas por similitud descendente.
  for (let i = 1; i < recs.length; i++) {
    assert.ok((recs[i - 1].similarityScore ?? 0) >= (recs[i].similarityScore ?? 0));
  }
});

test("MockProductProvider es determinista por item", async () => {
  const provider = new MockProductProvider();
  const item = catalogItem();
  const a = await provider.search(item.searchQuery!, item);
  const b = await provider.search(item.searchQuery!, item);
  assert.deepEqual(a, b);
});

test("searchProducts agrega proveedores y respeta el límite", async () => {
  const item = catalogItem();
  const recs = await searchProducts(item, { limit: 4 });
  assert.ok(recs.length > 0);
  assert.ok(recs.length <= 4);
});

test("searchProducts sin query devuelve vacío", async () => {
  const item = catalogItem({ searchQuery: null, name: "" });
  const recs = await searchProducts(item);
  assert.deepEqual(recs, []);
});
