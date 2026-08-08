import assert from "node:assert/strict";
import { test } from "node:test";
import { persistPreprocessedProductsToCatalog } from "../lib/analysis/jobs/catalogPersistence";
import type {
  AnalysisJobRecord,
  UniqueProductRecord,
} from "../lib/analysis/jobs/types";
import { MemoryCatalogRepository } from "../lib/catalog/memoryRepository";
import { defaultAnalysisConfig } from "../lib/analysis/categories";
import { item } from "./fixtures/analysisJobFixtures";

function job(): AnalysisJobRecord {
  const now = Date.now();
  return {
    id: "job-preprocess",
    status: "running",
    media: {
      id: "media-preprocess",
      fileName: "look.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1000,
      durationSeconds: 12,
      fileHash: "a".repeat(64),
      catalogVersion: "catalog:v1",
      analysisVersion: "video-pipeline:v4",
      processedAt: null,
      createdAt: now,
    },
    matchingMode: "catalog_first",
    analysisConfig: defaultAnalysisConfig(),
    checkpoint: { processedUpToSeconds: 12, lastBatchAt: now },
    counters: {
      framesReceived: 1,
      framesAnalyzed: 1,
      framesSkippedSimilar: 0,
      framesSkippedCheckpoint: 0,
      scenes: 1,
      tracks: 1,
      uniqueProducts: 1,
      dedupMergedTracks: 0,
      externalSearchesUsed: 1,
      cacheHits: 0,
      catalogHits: 0,
      catalogTimeouts: 0,
      externalTimeouts: 0,
      externalCandidates: 1,
      possibleDuplicates: 0,
      matchingRetries: 0,
    },
    timings: {
      hashMs: 0,
      detectionMs: 0,
      trackingMs: 0,
      dedupMs: 0,
      matchingMs: 0,
      totalMs: 0,
    },
    warnings: [],
    error: null,
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    coverage: null,
    integrityErrors: [],
  };
}

function externalProduct(): UniqueProductRecord {
  const detected = item({
    name: "bolso caramelo",
    category: "bags_accessories",
    color: "caramelo",
    confidence: 0.9,
  });
  return {
    productId: "p1",
    trackIds: ["track-1"],
    item: detected,
    bestCrop: {
      timestampSeconds: 4.2,
      box: detected.bounding_box ?? null,
      quality: 0.8,
      sharpness: 0.8,
      frameDataUrl: null,
      cropDataUrl: null,
      signatureHash: "abc",
      embedding: null,
    },
    segments: [{ startSeconds: 4, endSeconds: 5 }],
    matching: {
      matches: [
        {
          source: "external",
          productId: null,
          title: "Bolso City caramelo",
          brand: "Pause Atelier",
          imageUrl: "https://cdn.example/bag.jpg",
          productUrl: "https://shop.example/bag",
          price: 89,
          currency: "EUR",
          merchant: "Example",
          availability: "in_stock",
          matchStage: null,
          provider: "searchapi_google_lens",
          category: "bags_accessories",
          model: null,
          matchType: "probable",
          scores: {
            detectionScore: 0.9,
            visualScore: 0.9,
            textScore: null,
            attributeScore: null,
            brandEvidenceScore: null,
            merchantScore: 1,
            finalScore: 0.9,
          },
          evidence: ["Similitud visual alta"],
        },
      ],
      matchLabel: "EXTERNAL_MATCH",
      providerUsed: "searchapi_google_lens",
      fallbackUsed: false,
      cached: false,
      timings: {},
    },
    detection: null,
    matchStatus: "external_candidate",
    matchAttempts: 1,
    matchError: null,
    matchDurationMs: 30,
    externalSearchesUsed: 1,
    possibleDuplicateOf: null,
    identity: {
      canonicalLabel: "bolso caramelo",
      canonicalCategory: "bags_accessories",
      category: "bags_accessories",
      subcategory: null,
      color: "caramelo",
      pattern: null,
      material: null,
      observedLabels: ["bolso caramelo"],
      firstSeenAtMs: 4000,
      lastSeenAtMs: 5000,
      timestampsMs: [4000, 5000],
      seenCount: 2,
      sceneIds: [1],
    },
    matchProgress: "completed",
  };
}

test("el preprocesado guarda el producto y su match en el catálogo público", async () => {
  const repo = new MemoryCatalogRepository();
  const product = externalProduct();

  const first = await persistPreprocessedProductsToCatalog(job(), [product], { repo });
  const second = await persistPreprocessedProductsToCatalog(job(), [product], { repo });

  assert.deepEqual(first, { saved: 1, failed: 0 });
  assert.deepEqual(second, { saved: 1, failed: 0 });
  const catalog = await repo.listItems({});
  assert.equal(catalog.total, 1, "reprocesar el mismo vídeo no duplica la ficha");
  assert.equal(catalog.items[0].status, "review_required");
  const detail = await repo.getItem(catalog.items[0].id);
  assert.equal(detail?.recommendations.length, 1);
  assert.equal(detail?.recommendations[0].title, "Bolso City caramelo");
});
