import { test, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileCatalogStore } from "../../lib/catalogIngestion/catalog/fileStore";
import { matchProducts, textOverlapScore, attributeScore, combineScores } from "../../lib/catalogIngestion/catalog/matching";
import { tempDataDir, makeProduct } from "./helpers";

let store: FileCatalogStore;

before(async () => {
  const dir = tempDataDir("matching");
  store = new FileCatalogStore(join(dir, "catalog.json"));
  await store.init();

  await store.saveProduct(makeProduct({
    id: "prod-red-dress",
    title: "Vestido midi rojo",
    brand: "Zara",
    category: "dress",
    color: "red",
    perceptualHash: "aa00aa00aa00aa00",
    imageEmbedding: [1, 0, 0, 0],
    textEmbedding: null,
    images: [{ url: "http://x/red.jpg", localPath: null, sha256: "sha-red", perceptualHash: "aa00aa00aa00aa00", width: 1, height: 1 }],
  }));
  await store.saveProduct(makeProduct({
    id: "prod-blue-shirt",
    title: "Camisa azul de lino",
    brand: "Mango",
    category: "shirt",
    color: "blue",
    perceptualHash: "0f0f0f0f0f0f0f0f",
    imageEmbedding: [0, 1, 0, 0],
    images: [{ url: "http://x/blue.jpg", localPath: null, sha256: "sha-blue", perceptualHash: "0f0f0f0f0f0f0f0f", width: 1, height: 1 }],
  }));
  await store.saveProduct(makeProduct({
    id: "prod-inactive",
    title: "Vestido midi rojo inactivo",
    isActive: false,
    images: [{ url: "http://x/i.jpg", localPath: null, sha256: "sha-red", perceptualHash: null, width: 1, height: 1 }],
  }));
});

test("etapa 1: hash exacto gana con visualScore 1", async () => {
  const matches = await matchProducts(store, { imageSha256: "sha-red", minScore: 0.5 });
  assert.equal(matches[0].product.id, "prod-red-dress");
  assert.equal(matches[0].matchStage, "exact_hash");
  assert.equal(matches[0].visualScore, 1);
});

test("etapa 2: perceptual hash cercano", async () => {
  const matches = await matchProducts(store, { perceptualHash: "aa00aa00aa00aa03", minScore: 0.5 });
  assert.equal(matches[0].product.id, "prod-red-dress");
  assert.equal(matches[0].matchStage, "perceptual_hash");
  assert.ok(matches[0].visualScore > 0.9);
});

test("etapa 3: embedding coseno", async () => {
  const matches = await matchProducts(store, {
    perceptualHash: "ffffffffffffffff", // lejos de todo → cae a embedding
    imageEmbedding: [0.98, 0.1, 0, 0],
    minScore: 0.5,
  });
  assert.equal(matches[0].product.id, "prod-red-dress");
  assert.equal(matches[0].matchStage, "embedding");
});

test("los productos inactivos nunca se devuelven", async () => {
  const matches = await matchProducts(store, { imageSha256: "sha-red", minScore: 0.1 });
  assert.ok(matches.length > 0);
  assert.ok(!matches.some((m) => m.product.id === "prod-inactive"));
});

test("filtros duros por categoría y marca", async () => {
  const matches = await matchProducts(store, {
    imageEmbedding: [0.7, 0.7, 0, 0],
    category: "shirt",
    minScore: 0.1,
  });
  assert.ok(matches.length > 0);
  assert.ok(matches.every((m) => m.product.category === "shirt"));
});

test("búsqueda de texto puntúa por solapamiento", async () => {
  const matches = await matchProducts(store, { queryText: "vestido rojo", minScore: 0.3 });
  assert.equal(matches[0].product.id, "prod-red-dress");
  assert.ok(matches[0].textScore > 0.9);
});

test("minScore corta resultados flojos", async () => {
  const matches = await matchProducts(store, { queryText: "bolso amarillo piel", minScore: 0.6 });
  assert.equal(matches.length, 0);
});

test("scores auxiliares: overlap, atributos y combinación", () => {
  const p = makeProduct({ title: "Vestido midi rojo", brand: "Zara", category: "dress", color: "red" });
  assert.equal(textOverlapScore("vestido rojo", p), 1);
  assert.equal(attributeScore(p, { category: "dress", brand: "Zara", color: "rojo" }), 1);
  assert.equal(attributeScore(p, { category: "shirt" }), 0);
  assert.equal(attributeScore(p, {}), 0.5);
  assert.ok(Math.abs(combineScores(1, 1, 1, true, true) - 1) < 1e-9);
  assert.ok(combineScores(1, 0, 0, true, false) > combineScores(0.5, 0, 0, true, false));
});
