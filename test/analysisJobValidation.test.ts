import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAnalysisJob,
  validateCreateJobInput,
} from "../lib/analysis/jobs/engine";
import {
  fakeMatcher,
  makeDeps,
  ScriptedDetector,
  TEST_JOB_CONFIG,
} from "./fixtures/analysisJobFixtures";
import type { MatchCall } from "./fixtures/analysisJobFixtures";

const VALID_INPUT = {
  fileName: "demo.mp4",
  mimeType: "video/mp4",
  sizeBytes: 12 * 1024 * 1024,
  durationSeconds: 90,
};

test("acepta un vídeo válido dentro de los límites", () => {
  const res = validateCreateJobInput(VALID_INPUT, TEST_JOB_CONFIG);
  assert.equal(res.ok, true);
});

test("rechaza duración por encima de MAX_VIDEO_DURATION_SECONDS", () => {
  const res = validateCreateJobInput(
    { ...VALID_INPUT, durationSeconds: 121 },
    TEST_JOB_CONFIG
  );
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 413);
    assert.match(res.error, /máximo/);
  }
});

test("rechaza duración ausente o inválida", () => {
  for (const durationSeconds of [undefined, 0, -3, Number.NaN]) {
    const res = validateCreateJobInput(
      { ...VALID_INPUT, durationSeconds },
      TEST_JOB_CONFIG
    );
    assert.equal(res.ok, false);
  }
});

test("rechaza MIME que no sea video/*", () => {
  for (const mimeType of [undefined, "image/jpeg", "application/pdf", ""]) {
    const res = validateCreateJobInput({ ...VALID_INPUT, mimeType }, TEST_JOB_CONFIG);
    assert.equal(res.ok, false);
    if (!res.ok && mimeType) assert.equal(res.status, 415);
  }
});

test("rechaza tamaño por encima del techo", () => {
  const res = validateCreateJobInput(
    { ...VALID_INPUT, sizeBytes: TEST_JOB_CONFIG.maxVideoSizeBytes + 1 },
    TEST_JOB_CONFIG
  );
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 413);
});

test("createAnalysisJob crea el job en queued con checkpoint virgen", async () => {
  const calls: MatchCall[] = [];
  const deps = makeDeps(new ScriptedDetector({}), fakeMatcher(calls));
  const created = await createAnalysisJob(
    { ...VALID_INPUT, matchingMode: "hybrid" },
    deps
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.job.status, "queued");
  assert.equal(created.job.matchingMode, "hybrid");
  assert.equal(created.job.checkpoint.processedUpToSeconds, -1);
  const stored = await deps.store.getJob(created.job.id);
  assert.ok(stored);
});

test("un matchingMode desconocido cae al default sin romper", async () => {
  const calls: MatchCall[] = [];
  const deps = makeDeps(new ScriptedDetector({}), fakeMatcher(calls));
  const created = await createAnalysisJob(
    { ...VALID_INPUT, matchingMode: "lo-que-sea" },
    deps
  );
  assert.equal(created.ok, true);
  if (created.ok) assert.equal(created.job.matchingMode, "catalog_first");
});

test("createAnalysisJob propaga los errores de validación con su status", async () => {
  const calls: MatchCall[] = [];
  const deps = makeDeps(new ScriptedDetector({}), fakeMatcher(calls));
  const created = await createAnalysisJob(
    { ...VALID_INPUT, durationSeconds: 500 },
    deps
  );
  assert.equal(created.ok, false);
  if (!created.ok) assert.equal(created.status, 413);
});
