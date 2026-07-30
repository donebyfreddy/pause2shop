import { test, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileCatalogStore } from "../../lib/catalogIngestion/catalog/fileStore";
import { findDuplicate } from "../../lib/catalogIngestion/catalog/dedup";
import { ingestProduct } from "../../lib/catalogIngestion/catalog/ingest";
import { tempDataDir, makeNormalized } from "./helpers";

/** Dedup multinivel contra un FileCatalogStore temporal. */

let store: FileCatalogStore;

before(async () => {
  const dir = tempDataDir("dedup");
  store = new FileCatalogStore(join(dir, "catalog.json"));
  await store.init();
});

test("nivel 1: source + sourceProductId", async () => {
  const base = makeNormalized({ source: "zara", sourceProductId: "111" });
  const first = await ingestProduct(store, base);
  assert.equal(first.isNew, true);

  const dup = await findDuplicate(store, {
    source: "zara", sourceProductId: "111",
    canonicalUrl: "https://otra.url/x.html",
    sku: null, gtin: null, brand: "Otra", title: "Otro título", color: null,
    imageSha256: null, perceptualHash: null, imageEmbedding: null,
  });
  assert.equal(dup?.level, "source_product_id");
  assert.equal(dup?.product.id, first.product.id);
});

test("nivel 2: canonicalUrl", async () => {
  const p = await ingestProduct(store, makeNormalized({ canonicalUrl: "https://www.zara.com/es/es/unico-p9.html" }));
  const dup = await findDuplicate(store, {
    source: "mango", sourceProductId: "zzz",
    canonicalUrl: "https://www.zara.com/es/es/unico-p9.html",
    sku: null, gtin: null, brand: null, title: "x", color: null,
    imageSha256: null, perceptualHash: null, imageEmbedding: null,
  });
  assert.equal(dup?.level, "canonical_url");
  assert.equal(dup?.product.id, p.product.id);
});

test("nivel 3: sha256 exacto de imagen", async () => {
  const sha = "a".repeat(64);
  await ingestProduct(store, makeNormalized({
    images: [{ url: "http://x/img.jpg", localPath: null, sha256: sha, perceptualHash: null, width: 1, height: 1 }],
  }));
  const dup = await findDuplicate(store, {
    source: "hm", sourceProductId: "nuevo1",
    canonicalUrl: "https://www2.hm.com/n1.html",
    sku: null, gtin: null, brand: null, title: "x", color: null,
    imageSha256: sha, perceptualHash: null, imageEmbedding: null,
  });
  assert.equal(dup?.level, "exact_image_hash");
});

test("nivel 4: perceptual hash con distancia Hamming ≤ umbral", async () => {
  await ingestProduct(store, makeNormalized({ perceptualHash: "ff00ff00ff00ff00" }));
  // Misma huella con 2 bits cambiados (≤ 6)
  const dup = await findDuplicate(store, {
    source: "hm", sourceProductId: "nuevo2",
    canonicalUrl: "https://www2.hm.com/n2.html",
    sku: null, gtin: null, brand: null, title: "x", color: null,
    imageSha256: null, perceptualHash: "ff00ff00ff00ff03", imageEmbedding: null,
  });
  assert.equal(dup?.level, "perceptual_hash");
});

test("nivel 5: similitud de embedding ≥ umbral", async () => {
  const v = Array.from({ length: 64 }, (_, i) => Math.sin(i + 1));
  await ingestProduct(store, makeNormalized({ imageEmbedding: v }));
  const near = v.map((x) => x * 1.0001);
  const dup = await findDuplicate(store, {
    source: "hm", sourceProductId: "nuevo3",
    canonicalUrl: "https://www2.hm.com/n3.html",
    sku: null, gtin: null, brand: null, title: "x", color: null,
    imageSha256: null, perceptualHash: null, imageEmbedding: near,
  });
  assert.equal(dup?.level, "embedding");
});

test("nivel 6: SKU/GTIN", async () => {
  await ingestProduct(store, makeNormalized({ sku: "SKU-COMPARTIDO-1", gtin: "8400000000017" }));
  const bySku = await findDuplicate(store, {
    source: "mango", sourceProductId: "n4",
    canonicalUrl: "https://shop.mango.com/n4.html",
    sku: "SKU-COMPARTIDO-1", gtin: null, brand: null, title: "x", color: null,
    imageSha256: null, perceptualHash: null, imageEmbedding: null,
  });
  assert.equal(bySku?.level, "sku_gtin");
  const byGtin = await findDuplicate(store, {
    source: "mango", sourceProductId: "n5",
    canonicalUrl: "https://shop.mango.com/n5.html",
    sku: null, gtin: "8400000000017", brand: null, title: "x", color: null,
    imageSha256: null, perceptualHash: null, imageEmbedding: null,
  });
  assert.equal(byGtin?.level, "sku_gtin");
});

test("nivel 7: marca + título normalizado + color", async () => {
  await ingestProduct(store, makeNormalized({ brand: "Zara", title: "Chaqueta Bomber Verde", color: "Verde" }));
  const dup = await findDuplicate(store, {
    source: "mango", sourceProductId: "n6",
    canonicalUrl: "https://shop.mango.com/n6.html",
    sku: null, gtin: null, brand: "ZARA", title: "chaqueta  bomber verde!", color: "green",
    imageSha256: null, perceptualHash: null, imageEmbedding: null,
  });
  assert.equal(dup?.level, "brand_title_color");
});

test("sin coincidencias devuelve null y la ingesta cuenta duplicados cross-source", async () => {
  const none = await findDuplicate(store, {
    source: "hm", sourceProductId: "inexistente-x",
    canonicalUrl: "https://www2.hm.com/inexistente-x.html",
    sku: null, gtin: null, brand: "Marca Nueva", title: "Título totalmente distinto xyz", color: "lilac",
    imageSha256: null, perceptualHash: null, imageEmbedding: null,
  });
  assert.equal(none, null);

  // Duplicado cross-source vía ingest: se conserva la ficha original
  const statsBefore = await store.stats();
  const r = await ingestProduct(store, makeNormalized({
    source: "mango", sourceProductId: "cross-1",
    canonicalUrl: "https://shop.mango.com/cross-1.html",
    brand: "Zara", title: "Chaqueta Bomber Verde", color: "green",
  }));
  assert.equal(r.isNew, false);
  assert.equal(r.deduplicated, true);
  const statsAfter = await store.stats();
  assert.equal(statsAfter.duplicatesDetected, statsBefore.duplicatesDetected + 1);
});
