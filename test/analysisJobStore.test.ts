import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryAnalysisJobStore } from "../lib/analysis/jobs/store";
import type {
  AnalysisJobRecord,
  JobRuntimeState,
  UniqueProductRecord,
} from "../lib/analysis/jobs/types";
import { item } from "./fixtures/analysisJobFixtures";

function jobRecord(id: string): AnalysisJobRecord {
  return {
    id,
    status: "queued",
    media: {
      id: `media-${id}`,
      fileName: "demo.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1024,
      durationSeconds: 60,
      fileHash: null,
      catalogVersion: "catalog:v1",
      analysisVersion: "video-pipeline:v2",
      processedAt: null,
      createdAt: 1,
    },
    matchingMode: "external_only",
    analysisConfig: {
      categories: ["all"],
      analysisIntensity: "standard",
      personCentric: false,
      reverseImageSearch: true,
      matchingMode: "external_only",
    },
    checkpoint: { processedUpToSeconds: -1, lastBatchAt: null },
    counters: {
      framesReceived: 0,
      framesAnalyzed: 0,
      framesSkippedSimilar: 0,
      framesSkippedCheckpoint: 0,
      scenes: 0,
      tracks: 0,
      uniqueProducts: 0,
      dedupMergedTracks: 0,
      externalSearchesUsed: 0,
      cacheHits: 0,
      catalogHits: 0,
      catalogTimeouts: 0,
      externalTimeouts: 0,
      externalCandidates: 0,
      possibleDuplicates: 0,
      matchingRetries: 0,
    },
    timings: { hashMs: 0, detectionMs: 0, trackingMs: 0, dedupMs: 0, matchingMs: 0, totalMs: 0 },
    warnings: [],
    error: null,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
  };
}

function runtimeState(): JobRuntimeState {
  return {
    lastThumb: null,
    lastAnalyzedHash: null,
    currentSceneId: 0,
    scenes: [],
    trackerTracks: [],
    trackerNextId: 1,
    tracks: {},
    appearances: [],
  };
}

test("create/get/update de job y aislamiento por clonado", async () => {
  const store = new InMemoryAnalysisJobStore();
  const job = jobRecord("j1");
  await store.createJob(job, runtimeState());

  // Mutar el original no debe afectar a lo guardado (snapshots).
  job.status = "failed";
  const stored = await store.getJob("j1");
  assert.equal(stored?.status, "queued");

  stored!.status = "running";
  stored!.counters.framesAnalyzed = 7;
  await store.updateJob(stored!);
  const updated = await store.getJob("j1");
  assert.equal(updated?.status, "running");
  assert.equal(updated?.counters.framesAnalyzed, 7);

  assert.equal(await store.getJob("no-existe"), null);
  await assert.rejects(() => store.updateJob(jobRecord("no-existe")));
});

test("runtime state se guarda y recupera completo", async () => {
  const store = new InMemoryAnalysisJobStore();
  await store.createJob(jobRecord("j2"), runtimeState());
  const state = runtimeState();
  state.currentSceneId = 2;
  state.scenes.push({ sceneId: 1, startSeconds: 0, endSeconds: 3, frameCount: 4 });
  state.appearances.push({
    trackId: "t1",
    timestampSeconds: 1.2,
    sceneId: 1,
    box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    confidence: 0.8,
  });
  await store.saveRuntimeState("j2", state);
  const loaded = await store.getRuntimeState("j2");
  assert.equal(loaded?.currentSceneId, 2);
  assert.equal(loaded?.scenes.length, 1);
  assert.equal(loaded?.appearances[0].trackId, "t1");
  assert.equal(await store.getRuntimeState("nope"), null);
});

test("products y frame meta", async () => {
  const store = new InMemoryAnalysisJobStore();
  await store.createJob(jobRecord("j3"), runtimeState());
  const products: UniqueProductRecord[] = [
    {
      productId: "p1",
      trackIds: ["t1", "t3"],
      item: item({ name: "taza roja" }),
      bestCrop: {
        timestampSeconds: 0.4,
        box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        quality: 0.5,
        sharpness: 0.6,
        frameDataUrl: null,
        cropDataUrl: null,
        signatureHash: "abcd",
        embedding: null,
      },
      segments: [{ startSeconds: 0, endSeconds: 0.4 }],
      matching: null,
      detection: null,
      matchStatus: "not_searched",
      matchAttempts: 0,
      matchError: null,
      matchDurationMs: 0,
      externalSearchesUsed: 0,
      possibleDuplicateOf: null,
      identity: {
        canonicalLabel: "taza roja",
        canonicalCategory: "general",
        category: "general",
        subcategory: null,
        color: null,
        pattern: null,
        material: null,
        observedLabels: ["taza roja"],
        firstSeenAtMs: 0,
        lastSeenAtMs: 400,
        timestampsMs: [0, 400],
        seenCount: 2,
        sceneIds: [1],
      },
    },
  ];
  await store.saveProducts("j3", products);
  const loaded = await store.getProducts("j3");
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0].trackIds, ["t1", "t3"]);
  assert.deepEqual(await store.getProducts("nope"), []);

  await store.recordFrames("j3", [
    { timestampSeconds: 0, analyzed: true, sceneId: 1 },
  ]);
});
