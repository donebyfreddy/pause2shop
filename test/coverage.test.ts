import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTemporalCoverage } from "../lib/analysis/jobs/coverage";
import type { SceneRecord } from "../lib/analysis/jobs/types";

function scene(partial: Partial<SceneRecord> & { sceneId: number }): SceneRecord {
  return {
    sceneId: partial.sceneId,
    startSeconds: partial.startSeconds ?? 0,
    endSeconds: partial.endSeconds ?? 0,
    frameCount: partial.frameCount ?? 1,
    analyzedFrameCount: partial.analyzedFrameCount ?? 1,
    status: partial.status ?? "completed",
    lastAnalyzedSeconds: partial.lastAnalyzedSeconds ?? null,
    failureReason: partial.failureReason ?? null,
  };
}

test("escenas contiguas cubriendo todo el vídeo: 100%, sin huecos", () => {
  const coverage = computeTemporalCoverage({
    videoDurationMs: 10_000,
    scenes: [
      scene({ sceneId: 1, startSeconds: 0, endSeconds: 5 }),
      scene({ sceneId: 2, startSeconds: 5, endSeconds: 10 }),
    ],
    requireSceneCoverage: true,
  });
  assert.equal(coverage.coveragePercent, 100);
  assert.deepEqual(coverage.uncoveredRanges, []);
  assert.equal(coverage.coveredDurationMs, 10_000);
});

test("hueco ENTRE escenas se detecta con el rango exacto", () => {
  const coverage = computeTemporalCoverage({
    videoDurationMs: 10_000,
    scenes: [
      scene({ sceneId: 1, startSeconds: 0, endSeconds: 3 }),
      scene({ sceneId: 2, startSeconds: 7, endSeconds: 10 }),
    ],
    requireSceneCoverage: true,
  });
  assert.equal(coverage.uncoveredRanges.length, 1);
  assert.deepEqual(coverage.uncoveredRanges[0], {
    startMs: 3000,
    endMs: 7000,
    reason: "gap_between_scenes",
  });
  assert.equal(coverage.coveragePercent, 60);
});

test("hueco ANTES de la primera escena y DESPUÉS de la última", () => {
  const coverage = computeTemporalCoverage({
    videoDurationMs: 10_000,
    scenes: [scene({ sceneId: 1, startSeconds: 2, endSeconds: 6 })],
    requireSceneCoverage: true,
  });
  const reasons = coverage.uncoveredRanges.map((r) => r.reason).sort();
  assert.deepEqual(reasons, ["after_last_scene", "before_first_scene"]);
  assert.equal(coverage.coveragePercent, 40);
});

test("sin ninguna escena: el vídeo entero cuenta como sin cubrir", () => {
  const coverage = computeTemporalCoverage({
    videoDurationMs: 5000,
    scenes: [],
    requireSceneCoverage: true,
  });
  assert.equal(coverage.coveragePercent, 0);
  assert.equal(coverage.uncoveredRanges.length, 1);
  assert.equal(coverage.uncoveredRanges[0].reason, "before_first_scene");
});

test("escena con 0 frames analizados: se marca solo si se requiere cobertura por escena", () => {
  const scenes = [
    scene({ sceneId: 1, startSeconds: 0, endSeconds: 5, analyzedFrameCount: 0 }),
    scene({ sceneId: 2, startSeconds: 5, endSeconds: 10 }),
  ];

  const required = computeTemporalCoverage({
    videoDurationMs: 10_000,
    scenes,
    requireSceneCoverage: true,
  });
  assert.deepEqual(required.scenesWithZeroAnalyzedFrames, [1]);
  assert.ok(required.uncoveredRanges.some((r) => r.reason === "scene_zero_frames"));
  assert.ok(required.coveragePercent < 100);

  const notRequired = computeTemporalCoverage({
    videoDurationMs: 10_000,
    scenes,
    requireSceneCoverage: false,
  });
  assert.deepEqual(notRequired.scenesWithZeroAnalyzedFrames, []);
  assert.equal(notRequired.coveragePercent, 100);
});

test("vídeo de duración 0: no falla y reporta 100% (nada que cubrir)", () => {
  const coverage = computeTemporalCoverage({
    videoDurationMs: 0,
    scenes: [],
    requireSceneCoverage: true,
  });
  assert.equal(coverage.coveragePercent, 100);
  assert.deepEqual(coverage.uncoveredRanges, []);
});
