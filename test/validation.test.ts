import assert from "node:assert/strict";
import { test } from "node:test";
import { validateProcessedVideoResult } from "../lib/analysis/jobs/validation";
import type {
  JobCounters,
  JobTimings,
  SceneRecord,
  TemporalCoverage,
  UniqueProductRecord,
} from "../lib/analysis/jobs/types";
import type { MatchingMode } from "../lib/matching/types";
import { item } from "./fixtures/analysisJobFixtures";

function scene(partial: Partial<SceneRecord> & { sceneId: number }): SceneRecord {
  return {
    sceneId: partial.sceneId,
    startSeconds: partial.startSeconds ?? 0,
    endSeconds: partial.endSeconds ?? 1,
    frameCount: partial.frameCount ?? 1,
    analyzedFrameCount: partial.analyzedFrameCount ?? 1,
    status: partial.status ?? "completed",
    lastAnalyzedSeconds: partial.lastAnalyzedSeconds ?? null,
    failureReason: partial.failureReason ?? null,
  };
}

const HEALTHY_COVERAGE: TemporalCoverage = {
  videoDurationMs: 10_000,
  coveredDurationMs: 10_000,
  coveragePercent: 100,
  uncoveredRanges: [],
  sceneCount: 1,
  scenesWithZeroAnalyzedFrames: [],
};

const COUNTERS: JobCounters = {
  framesReceived: 10,
  framesAnalyzed: 10,
  framesSkippedSimilar: 0,
  framesSkippedCheckpoint: 0,
  scenes: 1,
  tracks: 1,
  uniqueProducts: 1,
  dedupMergedTracks: 0,
  externalSearchesUsed: 0,
  cacheHits: 0,
  catalogHits: 0,
  catalogTimeouts: 0,
  externalTimeouts: 0,
  externalCandidates: 0,
  possibleDuplicates: 0,
  matchingRetries: 0,
};

const TIMINGS: JobTimings = {
  hashMs: 0,
  detectionMs: 0,
  trackingMs: 0,
  dedupMs: 0,
  matchingMs: 100,
  totalMs: 100,
};

function product(partial: Partial<UniqueProductRecord> = {}): UniqueProductRecord {
  return {
    productId: "p1",
    trackIds: ["t1"],
    item: item({ name: "camiseta" }),
    bestCrop: {
      timestampSeconds: 0,
      box: null,
      quality: 0.5,
      sharpness: 0.5,
      frameDataUrl: "data:image/jpeg;base64,Zg==",
      cropDataUrl: null,
      signatureHash: null,
      embedding: null,
    },
    segments: [],
    matching: null,
    detection: null,
    matchStatus: "catalog_matched",
    matchAttempts: 1,
    matchError: null,
    matchDurationMs: 10,
    externalSearchesUsed: 0,
    possibleDuplicateOf: null,
    matchProgress: "catalog_matched",
    identity: {
      canonicalLabel: "camiseta",
      canonicalCategory: "t-shirt",
      category: "ropa",
      subcategory: null,
      color: null,
      pattern: null,
      material: null,
      observedLabels: ["camiseta"],
      firstSeenAtMs: 0,
      lastSeenAtMs: 1000,
      timestampsMs: [0, 1000],
      seenCount: 2,
      sceneIds: [1],
    },
    ...partial,
  };
}

const BASE = {
  scenes: [scene({ sceneId: 1 })],
  products: [product()],
  coverage: HEALTHY_COVERAGE,
  externalSearchEnabled: true,
  unresolvedProducts: 0,
};

function job(partial: {
  status?: "completed" | "partially_completed";
  warnings?: string[];
  timings?: JobTimings;
  counters?: JobCounters;
  matchingMode?: MatchingMode;
} = {}) {
  return {
    status: partial.status ?? "completed",
    warnings: partial.warnings ?? [],
    timings: partial.timings ?? TIMINGS,
    counters: partial.counters ?? COUNTERS,
    matchingMode: partial.matchingMode ?? "catalog_first",
  };
}

test("un job sano no produce ningún error de integridad", () => {
  const errors = validateProcessedVideoResult({ job: job(), ...BASE });
  assert.deepEqual(errors, []);
});

test("escena sin estado terminal", () => {
  const errors = validateProcessedVideoResult({
    job: job(),
    ...BASE,
    scenes: [scene({ sceneId: 1, status: "tracking" })],
  });
  assert.ok(errors.some((e) => e.code === "scene_missing_terminal_status"));
});

test("cobertura por debajo del umbral", () => {
  const errors = validateProcessedVideoResult({
    job: job({ status: "partially_completed" }),
    ...BASE,
    coverage: { ...HEALTHY_COVERAGE, coveragePercent: 50 },
  });
  assert.ok(errors.some((e) => e.code === "coverage_below_threshold"));
});

test("producto con mejor crop pero 0 apariciones", () => {
  const errors = validateProcessedVideoResult({
    job: job(),
    ...BASE,
    products: [
      product({
        identity: { ...product().identity, seenCount: 0 },
      }),
    ],
  });
  assert.ok(errors.some((e) => e.code === "product_seen_count_zero_with_crop"));
});

test("matching con tiempo > 0 pero todos los productos sin buscar", () => {
  const errors = validateProcessedVideoResult({
    job: job(),
    ...BASE,
    products: [product({ matchStatus: "not_searched", matchProgress: "not_started" })],
  });
  assert.ok(errors.some((e) => e.code === "matching_ran_but_no_outcomes"));
});

test("fallback externo activo, productos sin resolver, 0 búsquedas externas", () => {
  const errors = validateProcessedVideoResult({
    job: job(),
    ...BASE,
    unresolvedProducts: 2,
  });
  assert.ok(errors.some((e) => e.code === "external_fallback_unused"));
});

test("fallback externo activo pero en catalog_only: NO se exige búsqueda externa", () => {
  const errors = validateProcessedVideoResult({
    job: job({ matchingMode: "catalog_only" }),
    ...BASE,
    unresolvedProducts: 2,
  });
  assert.ok(!errors.some((e) => e.code === "external_fallback_unused"));
});

test("partially_completed sin ningún motivo registrado", () => {
  const errors = validateProcessedVideoResult({
    job: job({ status: "partially_completed" }),
    ...BASE,
  });
  assert.ok(errors.some((e) => e.code === "partially_completed_without_reason"));
});

test("partially_completed CON productos sin resolver no dispara la invariante defensiva", () => {
  const errors = validateProcessedVideoResult({
    job: job({ status: "partially_completed" }),
    ...BASE,
    unresolvedProducts: 1,
    externalSearchEnabled: false,
  });
  assert.ok(!errors.some((e) => e.code === "partially_completed_without_reason"));
});
