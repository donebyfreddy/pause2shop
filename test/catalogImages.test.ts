import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveImagePersistenceStatus,
  isDataUrl,
  isHttpUrl,
  itemImageCandidates,
  pickBestRecommendation,
  recommendationMatchType,
} from "../lib/catalog/images";
import { MemoryCatalogRepository } from "../lib/catalog/memoryRepository";
import type {
  DetectedItemInput,
  ProductRecommendation,
} from "../lib/catalog/types";

// --- helpers de URL --------------------------------------------------------

test("isDataUrl / isHttpUrl distinguen la forma de la URL", () => {
  assert.equal(isDataUrl("data:image/jpeg;base64,abc"), true);
  assert.equal(isDataUrl("https://x.test/a.jpg"), false);
  assert.equal(isHttpUrl("https://x.test/a.jpg"), true);
  assert.equal(isHttpUrl("data:image/jpeg;base64,abc"), false);
  assert.equal(isHttpUrl(null), false);
});

// --- estado de persistencia de la imagen ------------------------------------

test("deriveImagePersistenceStatus: sin crop → none", () => {
  assert.equal(
    deriveImagePersistenceStatus({ imageCropUrl: null }, "postgres"),
    "none"
  );
});

test("deriveImagePersistenceStatus: data URL → local_only (Storage caído)", () => {
  assert.equal(
    deriveImagePersistenceStatus(
      { imageCropUrl: "data:image/jpeg;base64,abc" },
      "postgres"
    ),
    "local_only"
  );
});

test("deriveImagePersistenceStatus: URL http + Postgres → synced", () => {
  assert.equal(
    deriveImagePersistenceStatus(
      { imageCropUrl: "https://storage.test/crops/a.jpg" },
      "postgres"
    ),
    "synced"
  );
});

test("deriveImagePersistenceStatus: URL http + memoria → pending_database_sync", () => {
  assert.equal(
    deriveImagePersistenceStatus(
      { imageCropUrl: "https://storage.test/crops/a.jpg" },
      "memory_fallback"
    ),
    "pending_database_sync"
  );
});

// --- orden de fallback de la imagen de la tarjeta ---------------------------

test("itemImageCandidates: crop primero, luego frame, luego match", () => {
  const candidates = itemImageCandidates(
    { imageCropUrl: "crop.jpg", frameImageUrl: "frame.jpg" },
    "match.jpg"
  );
  assert.deepEqual(candidates, ["crop.jpg", "frame.jpg", "match.jpg"]);
});

test("itemImageCandidates: sin crop usa frame y match", () => {
  const candidates = itemImageCandidates(
    { imageCropUrl: null, frameImageUrl: "frame.jpg" },
    "match.jpg"
  );
  assert.deepEqual(candidates, ["frame.jpg", "match.jpg"]);
});

test("itemImageCandidates: sin ninguna imagen → lista vacía (placeholder)", () => {
  assert.deepEqual(
    itemImageCandidates({ imageCropUrl: null, frameImageUrl: null }, null),
    []
  );
});

// --- tipo de coincidencia ----------------------------------------------------

function rec(partial: Partial<ProductRecommendation>): ProductRecommendation {
  return {
    id: "r1",
    detectedItemId: "i1",
    provider: "searchapi_google_lens",
    title: "Ferrari 488 GTB",
    productUrl: "https://store.test/p",
    imageUrl: "https://store.test/p.jpg",
    price: 99,
    currency: "EUR",
    brand: "Ferrari",
    similarityScore: 0.9,
    matchType: null,
    reason: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

test("recommendationMatchType: usa la columna si existe", () => {
  assert.equal(recommendationMatchType(rec({ matchType: "exact" })), "exact");
});

test("recommendationMatchType: retro-compatible con reason antigua", () => {
  assert.equal(
    recommendationMatchType(rec({ reason: "near_exact match (112 pts, serpapi)" })),
    "near_exact"
  );
});

test("recommendationMatchType: cae a umbral por score", () => {
  assert.equal(recommendationMatchType(rec({ similarityScore: 0.85 })), "near_exact");
  assert.equal(recommendationMatchType(rec({ similarityScore: 0.4 })), "similar");
  assert.equal(recommendationMatchType(rec({ similarityScore: null })), null);
});

test("pickBestRecommendation elige el mayor score", () => {
  const a = rec({ id: "a", similarityScore: 0.5 });
  const b = rec({ id: "b", similarityScore: 0.9 });
  assert.equal(pickBestRecommendation([a, b])?.id, "b");
  assert.equal(pickBestRecommendation([]), null);
});

// --- repositorio en memoria: imágenes y matchType ---------------------------

function itemInput(overrides: Partial<DetectedItemInput> = {}): DetectedItemInput {
  return {
    videoId: "v1",
    frameId: null,
    sourceType: "youtube",
    sourceUrl: null,
    timestampSeconds: 10,
    timestampBucket: 10,
    fingerprint: "v1|ferrari coupe deportivo rojo|coche|rojo|_|_|10",
    type: "other",
    category: "coche",
    subcategory: null,
    name: "Ferrari coupé deportivo rojo",
    description: null,
    color: "rojo",
    secondaryColors: [],
    style: null,
    pattern: null,
    materialGuess: null,
    genderFit: null,
    visibleBrand: "Ferrari",
    confidence: 0.88,
    searchQuery: "ferrari coupe rojo",
    marketplaceKeywords: [],
    boundingBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
    imageCropUrl: null,
    frameImageUrl: null,
    ...overrides,
  };
}

test("memoria: updateItem persiste imageCropUrl y el item la conserva", async () => {
  const repo = new MemoryCatalogRepository();
  const { item } = await repo.upsertDetectedItem(itemInput());
  assert.equal(item.imageCropUrl, null);

  const updated = await repo.updateItem(item.id, {
    imageCropUrl: "https://storage.test/crops/ferrari.jpg",
  });
  assert.equal(updated?.imageCropUrl, "https://storage.test/crops/ferrari.jpg");

  const fetched = await repo.getItem(item.id);
  assert.equal(fetched?.imageCropUrl, "https://storage.test/crops/ferrari.jpg");
});

test("memoria: la deduplicación NO borra el crop existente", async () => {
  const repo = new MemoryCatalogRepository();
  const { item } = await repo.upsertDetectedItem(itemInput());
  await repo.updateItem(item.id, { imageCropUrl: "https://storage.test/c.jpg" });

  // Segunda detección del mismo objeto, sin crop (siempre llega null).
  const { item: deduped, created } = await repo.upsertDetectedItem(itemInput());
  assert.equal(created, false);
  assert.equal(deduped.imageCropUrl, "https://storage.test/c.jpg");
  assert.equal(deduped.detectionCount, 2);
});

test("memoria: replaceRecommendations guarda matchType y listTopRecommendations devuelve el mejor", async () => {
  const repo = new MemoryCatalogRepository();
  const { item } = await repo.upsertDetectedItem(itemInput());

  await repo.replaceRecommendations(item.id, [
    {
      provider: "serpapi_google_lens",
      title: "Ferrari similar",
      productUrl: "https://a.test",
      imageUrl: "https://a.test/img.jpg",
      similarityScore: 0.4,
      matchType: "similar",
    },
    {
      provider: "searchapi_google_lens",
      title: "Ferrari 488 GTB rojo",
      productUrl: "https://b.test",
      imageUrl: "https://b.test/img.jpg",
      similarityScore: 0.92,
      matchType: "near_exact",
    },
  ]);

  const top = await repo.listTopRecommendations([item.id]);
  const best = top.get(item.id);
  assert.equal(best?.title, "Ferrari 488 GTB rojo");
  assert.equal(best?.matchType, "near_exact");
  assert.equal(best?.imageUrl, "https://b.test/img.jpg");

  // El item queda "matched" y sus imágenes de match disponibles vía detalle.
  const detail = await repo.getItem(item.id);
  assert.equal(detail?.status, "matched");
  assert.equal(detail?.recommendations.length, 2);
});

test("memoria: listTopRecommendations con ids sin recomendaciones → mapa vacío", async () => {
  const repo = new MemoryCatalogRepository();
  const { item } = await repo.upsertDetectedItem(itemInput());
  const top = await repo.listTopRecommendations([item.id, "no-existe"]);
  assert.equal(top.size, 0);
});
