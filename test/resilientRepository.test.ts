import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryCatalogRepository } from "../lib/catalog/memoryRepository";
import { ResilientCatalogRepository } from "../lib/catalog/resilientRepository";
import type { CatalogRepository } from "../lib/catalog/repository";
import type { VideoSourceInput } from "../lib/catalog/types";

const VIDEO: VideoSourceInput = {
  externalKey: "test:video",
  sourceType: "uploaded",
  title: "Vídeo de prueba",
  url: null,
};

/** Repositorio que falla siempre, simulando una DB caída. */
function brokenRepository(): CatalogRepository {
  const fail = () => Promise.reject(new Error("connection timeout"));
  return {
    upsertVideoSource: fail,
    listVideos: fail,
    createFrame: fail,
    listFramesByVideo: fail,
    upsertDetectedItem: fail,
    listItems: fail,
    getItem: fail,
    updateItem: fail,
    replaceRecommendations: fail,
    listRecommendations: fail,
    addFeedback: fail,
  } as unknown as CatalogRepository;
}

test("con la DB sana, opera contra el repositorio primario", async () => {
  const primary = new MemoryCatalogRepository();
  const fallback = new MemoryCatalogRepository();
  const repo = new ResilientCatalogRepository(primary, fallback);

  const video = await repo.upsertVideoSource(VIDEO);
  assert.ok(video.id);
  assert.equal(repo.mode, "postgres");
  // El primario tiene el dato; el fallback no.
  assert.equal((await primary.listVideos()).length, 1);
  assert.equal((await fallback.listVideos()).length, 0);
});

test("con la DB caída, cae a memoria SIN lanzar y abre el circuito", async () => {
  const repo = new ResilientCatalogRepository(
    brokenRepository(),
    new MemoryCatalogRepository()
  );

  // La operación no lanza: se resuelve contra el fallback.
  const video = await repo.upsertVideoSource(VIDEO);
  assert.ok(video.id);
  assert.equal(repo.mode, "memory_fallback");
  assert.match(repo.lastError ?? "", /connection timeout/);

  // Con el circuito abierto, las siguientes operaciones van directas a memoria
  // (ninguna espera del timeout del primario) y ven los datos de la sesión.
  const { items } = await repo.listItems({});
  assert.equal(items.length, 0);
  const videos = await repo.listVideos();
  assert.equal(videos.length, 1);
});

test("los items analizados sobreviven en la sesión aunque la DB falle", async () => {
  const repo = new ResilientCatalogRepository(
    brokenRepository(),
    new MemoryCatalogRepository()
  );
  const video = await repo.upsertVideoSource(VIDEO);
  const frame = await repo.createFrame({ videoId: video.id, timestampSeconds: 3 });
  const { item, created } = await repo.upsertDetectedItem({
    videoId: video.id,
    frameId: frame.id,
    sourceType: "uploaded",
    sourceUrl: null,
    timestampSeconds: 3,
    timestampBucket: 0,
    fingerprint: "v|camiseta|ropa|blanco|_|_|0",
    type: "clothing",
    category: "ropa",
    subcategory: null,
    name: "Camiseta blanca",
    description: null,
    color: "blanco",
    secondaryColors: [],
    style: null,
    pattern: null,
    materialGuess: null,
    genderFit: null,
    visibleBrand: null,
    confidence: 0.8,
    searchQuery: "camiseta blanca",
    marketplaceKeywords: [],
    boundingBox: null,
    imageCropUrl: null,
    frameImageUrl: null,
  });
  assert.ok(created);
  const found = await repo.getItem(item.id);
  assert.equal(found?.name, "Camiseta blanca");
});
