import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryAnalysisJobStore } from "../lib/analysis/jobs/store";
import { resolveIdentity } from "../lib/analysis/jobs/pgStore";
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
    coverage: null,
    integrityErrors: [],
  };
}

function runtimeState(): JobRuntimeState {
  return {
    lastThumb: null,
    lastAnalyzedHash: null,
    lastAnalyzedThumb: null,
    lastAnalyzedAtSeconds: null,
    pendingFlushFrame: null,
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
  state.scenes.push({
    sceneId: 1,
    startSeconds: 0,
    endSeconds: 3,
    frameCount: 4,
    analyzedFrameCount: 4,
    status: "completed",
    lastAnalyzedSeconds: 3,
    failureReason: null,
  });
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
      matchProgress: "not_started",
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
    { timestampSeconds: 0, analyzed: true, sceneId: 1, reason: "kept:scene_first" },
  ]);
});

test("updateProductProgress actualiza SOLO el progreso de ese producto", async () => {
  const store = new InMemoryAnalysisJobStore();
  await store.createJob(jobRecord("j4"), runtimeState());
  const products: UniqueProductRecord[] = [
    { ...baseProduct("p1"), matchProgress: "not_started" },
    { ...baseProduct("p2"), matchProgress: "not_started" },
  ];
  await store.saveProducts("j4", products);

  await store.updateProductProgress("j4", "p1", "catalog_search");
  const loaded = await store.getProducts("j4");
  assert.equal(loaded.find((p) => p.productId === "p1")?.matchProgress, "catalog_search");
  assert.equal(loaded.find((p) => p.productId === "p2")?.matchProgress, "not_started");

  // Job/producto inexistente: no lanza, simplemente no hace nada.
  await store.updateProductProgress("no-existe", "p1", "completed");
});

test("resolveIdentity: backfill de filas legacy — {} cuenta como ausente, no como identidad vacía válida", () => {
  const it = item({ name: "taza roja", category: "taza" });

  // Fila de ANTES de la migración 13: la columna vino con NULL.
  assert.equal(resolveIdentity(null, it).seenCount, 0);
  assert.equal(resolveIdentity(null, it).canonicalLabel, "taza roja");

  // Fila que la migración 13 rellenó con '{}'::jsonb (verdadero, sin forma):
  // el bug real era que `?? emptyIdentity()` nunca disparaba aquí.
  assert.equal(resolveIdentity({} as UniqueProductRecord["identity"], it).seenCount, 0);
  assert.equal(
    resolveIdentity({} as UniqueProductRecord["identity"], it).canonicalLabel,
    "taza roja"
  );

  // Identidad real y completa: se conserva tal cual, no se sustituye.
  const real: UniqueProductRecord["identity"] = {
    canonicalLabel: "taza roja grande",
    canonicalCategory: "taza",
    category: "taza",
    subcategory: null,
    color: "rojo",
    pattern: null,
    material: null,
    observedLabels: ["taza roja grande"],
    firstSeenAtMs: 0,
    lastSeenAtMs: 7000,
    timestampsMs: [0, 7000],
    seenCount: 5,
    sceneIds: [1, 2],
  };
  assert.deepEqual(resolveIdentity(real, it), real);
});

function baseProduct(productId: string): UniqueProductRecord {
  return {
    productId,
    trackIds: [`t-${productId}`],
    item: item({ name: "producto" }),
    bestCrop: {
      timestampSeconds: 0,
      box: null,
      quality: 0.5,
      sharpness: 0.5,
      frameDataUrl: null,
      cropDataUrl: null,
      signatureHash: null,
      embedding: null,
    },
    segments: [],
    matching: null,
    detection: null,
    matchStatus: "not_searched",
    matchAttempts: 0,
    matchError: null,
    matchDurationMs: 0,
    externalSearchesUsed: 0,
    possibleDuplicateOf: null,
    matchProgress: "not_started",
    identity: {
      canonicalLabel: "producto",
      canonicalCategory: "general",
      category: "general",
      subcategory: null,
      color: null,
      pattern: null,
      material: null,
      observedLabels: ["producto"],
      firstSeenAtMs: 0,
      lastSeenAtMs: 0,
      timestampsMs: [0],
      seenCount: 1,
      sceneIds: [1],
    },
  };
}
