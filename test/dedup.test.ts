import { test } from "node:test";
import assert from "node:assert/strict";
import type { DetectedItem as VisionItem } from "../lib/types";
import { MemoryCatalogRepository } from "../lib/catalog/memoryRepository";
import { normalizeDetectedItem } from "../lib/catalog/normalize";
import type { FrameSourceType } from "../lib/catalog/types";

function vItem(over: Partial<VisionItem> = {}): VisionItem {
  // Los campos de texto se derivan del nombre para que al sobreescribir `name`
  // no queden valores "pegados" de otra prenda (p.ej. descripciones).
  const name = over.name ?? "Camiseta blanca oversize";
  return {
    name,
    category: "ropa",
    subcategory: "prenda",
    color: "blanco",
    visible_brand: null,
    style: "oversize",
    description: `${name}.`,
    search_query_es: name.toLowerCase(),
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.9,
    bounding_box: null,
    ...over,
  };
}

function inputFrom(
  v: VisionItem,
  videoId: string,
  ts: number,
  sourceType: FrameSourceType = "uploaded"
) {
  return normalizeDetectedItem(v, {
    videoId,
    frameId: null,
    sourceType,
    sourceUrl: null,
    timestampSeconds: ts,
  });
}

test("dedupe: mismo objeto en timestamps cercanos NO se duplica", async () => {
  const repo = new MemoryCatalogRepository();
  const video = await repo.upsertVideoSource({
    externalKey: "local:demo.mp4",
    sourceType: "uploaded",
  });

  const first = await repo.upsertDetectedItem(inputFrom(vItem(), video.id, 12));
  const second = await repo.upsertDetectedItem(inputFrom(vItem(), video.id, 14)); // mismo bucket (10)

  assert.equal(first.created, true);
  assert.equal(second.created, false, "segundo en ±ventana → actualiza, no crea");
  assert.equal(second.item.id, first.item.id);
  assert.equal(second.item.detectionCount, 2);

  const { items, total } = await repo.listItems({ videoId: video.id });
  assert.equal(total, 1);
  assert.equal(items.length, 1);
});

test("dedupe: distinto bucket de timestamp SÍ crea otro item", async () => {
  const repo = new MemoryCatalogRepository();
  const video = await repo.upsertVideoSource({
    externalKey: "v",
    sourceType: "uploaded",
  });
  await repo.upsertDetectedItem(inputFrom(vItem(), video.id, 2)); // bucket 0
  await repo.upsertDetectedItem(inputFrom(vItem(), video.id, 30)); // bucket 30
  const { total } = await repo.listItems({});
  assert.equal(total, 2);
});

test("dedupe: distinto color/categoría SÍ crea otro item", async () => {
  const repo = new MemoryCatalogRepository();
  const video = await repo.upsertVideoSource({ externalKey: "v", sourceType: "uploaded" });
  await repo.upsertDetectedItem(inputFrom(vItem({ color: "blanco" }), video.id, 5));
  await repo.upsertDetectedItem(inputFrom(vItem({ color: "negro" }), video.id, 5));
  const { total } = await repo.listItems({});
  assert.equal(total, 2);
});

test("dedupe conserva el status fijado por el usuario", async () => {
  const repo = new MemoryCatalogRepository();
  const video = await repo.upsertVideoSource({ externalKey: "v", sourceType: "uploaded" });
  const { item } = await repo.upsertDetectedItem(inputFrom(vItem(), video.id, 5));
  await repo.updateItem(item.id, { status: "ignored" });
  // Re-detección del mismo objeto.
  const again = await repo.upsertDetectedItem(inputFrom(vItem(), video.id, 6));
  assert.equal(again.item.status, "ignored", "no revierte a 'detected'");
  assert.equal(again.item.detectionCount, 2);
});

test("listItems aplica filtros category/color/type/status/q", async () => {
  const repo = new MemoryCatalogRepository();
  const video = await repo.upsertVideoSource({ externalKey: "v", sourceType: "uploaded" });
  await repo.upsertDetectedItem(
    inputFrom(vItem({ name: "Camiseta blanca", color: "blanco", category: "ropa" }), video.id, 5)
  );
  await repo.upsertDetectedItem(
    inputFrom(
      vItem({
        name: "Zapatillas negras",
        subcategory: "zapatillas",
        color: "negro",
        category: "calzado",
        style: "casual",
        search_query_es: "zapatillas negras casual",
        alternative_queries: ["sneakers negras"],
        verified_provider_queries: ["zapatillas negras"],
      }),
      video.id,
      40
    )
  );

  assert.equal((await repo.listItems({ color: "negro" })).total, 1);
  assert.equal((await repo.listItems({ category: "ropa" })).total, 1);
  assert.equal((await repo.listItems({ type: "footwear" })).total, 1);
  assert.equal((await repo.listItems({ q: "zapatillas" })).total, 1);
  assert.equal((await repo.listItems({ q: "camiseta" })).total, 1);
  assert.equal((await repo.listItems({})).total, 2);
});

test("replaceRecommendations marca 'matched' y addFeedback registra", async () => {
  const repo = new MemoryCatalogRepository();
  const video = await repo.upsertVideoSource({ externalKey: "v", sourceType: "uploaded" });
  const { item } = await repo.upsertDetectedItem(inputFrom(vItem(), video.id, 5));

  const recs = await repo.replaceRecommendations(item.id, [
    { provider: "Amazon (demo)", title: "Camiseta X", productUrl: "https://example.com/x", price: 19.99, currency: "EUR", similarityScore: 0.9 },
  ]);
  assert.equal(recs.length, 1);

  const detail = await repo.getItem(item.id);
  assert.equal(detail?.status, "matched");
  assert.equal(detail?.recommendations.length, 1);

  const fb = await repo.addFeedback({ detectedItemId: item.id, action: "clicked" });
  assert.equal(fb.action, "clicked");
  assert.equal(fb.detectedItemId, item.id);
});
