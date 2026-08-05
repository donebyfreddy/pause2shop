import type { SceneRecord, TemporalCoverage, UncoveredRange } from "./types";

/**
 * COBERTURA TEMPORAL del vídeo — no confundir con "frames analizados".
 *
 * "Procesar el vídeo completo" no significa analizar todos los FPS: significa
 * que ningún tramo de la línea temporal se quedó sin mirar. Esta función
 * calcula justo eso a partir de las escenas del job: huecos ANTES de la
 * primera escena, ENTRE escenas, DESPUÉS de la última, y escenas que
 * existieron pero terminaron con 0 frames analizados (si
 * `requireSceneCoverage`, eso también es un hueco, no solo un contador bajo).
 */
export function computeTemporalCoverage(params: {
  videoDurationMs: number;
  scenes: SceneRecord[];
  requireSceneCoverage: boolean;
}): TemporalCoverage {
  const { videoDurationMs, requireSceneCoverage } = params;
  const scenes = [...params.scenes].sort((a, b) => a.startSeconds - b.startSeconds);
  const uncoveredRanges: UncoveredRange[] = [];
  const scenesWithZeroAnalyzedFrames: number[] = [];

  if (scenes.length === 0) {
    if (videoDurationMs > 0) {
      uncoveredRanges.push({
        startMs: 0,
        endMs: videoDurationMs,
        reason: "before_first_scene",
      });
    }
  } else {
    const firstStartMs = Math.round(scenes[0].startSeconds * 1000);
    if (firstStartMs > 0) {
      uncoveredRanges.push({ startMs: 0, endMs: firstStartMs, reason: "before_first_scene" });
    }
    for (let i = 1; i < scenes.length; i++) {
      const prevEndMs = Math.round(scenes[i - 1].endSeconds * 1000);
      const nextStartMs = Math.round(scenes[i].startSeconds * 1000);
      if (nextStartMs > prevEndMs) {
        uncoveredRanges.push({
          startMs: prevEndMs,
          endMs: nextStartMs,
          reason: "gap_between_scenes",
        });
      }
    }
    const lastEndMs = Math.round(scenes[scenes.length - 1].endSeconds * 1000);
    if (lastEndMs < videoDurationMs) {
      uncoveredRanges.push({
        startMs: lastEndMs,
        endMs: videoDurationMs,
        reason: "after_last_scene",
      });
    }
    if (requireSceneCoverage) {
      for (const scene of scenes) {
        if (scene.analyzedFrameCount > 0) continue;
        scenesWithZeroAnalyzedFrames.push(scene.sceneId);
        uncoveredRanges.push({
          startMs: Math.round(scene.startSeconds * 1000),
          endMs: Math.round(scene.endSeconds * 1000),
          reason: "scene_zero_frames",
        });
      }
    }
  }

  const uncoveredMs = uncoveredRanges.reduce(
    (sum, r) => sum + Math.max(0, r.endMs - r.startMs),
    0
  );
  const coveredDurationMs = Math.max(0, videoDurationMs - uncoveredMs);
  const coveragePercent =
    videoDurationMs > 0 ? Math.round((coveredDurationMs / videoDurationMs) * 1000) / 10 : 100;

  return {
    videoDurationMs,
    coveredDurationMs,
    coveragePercent,
    uncoveredRanges: uncoveredRanges.sort((a, b) => a.startMs - b.startMs),
    sceneCount: scenes.length,
    scenesWithZeroAnalyzedFrames,
  };
}
