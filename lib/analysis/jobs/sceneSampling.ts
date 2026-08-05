import type { BoundingBox } from "@/lib/types";
import { averageHash, hammingDistance, type DecodedThumb } from "./perceptualHash";
import type { FrameSamplingReason } from "./types";

/**
 * DECISIÓN de sampling por frame, aislada de `engine.ts` para poder testearla
 * sin levantar el motor entero.
 *
 * El bug que corrige: antes había UN umbral global (`NEAR_DUP_HAMMING = 5`,
 * hardcodeado) sobre el hash del frame COMPLETO, sin mínimo de frames por
 * escena ni cambio local. Un vídeo con fondo estable y una persona moviéndose
 * dentro del encuadre podía descartar casi todo (433 de 468 frames en el caso
 * real) porque el frame ENTERO seguía pareciendo el mismo aunque la prenda
 * cambiara de pose, quedara medio oculta o cambiara de escala.
 *
 * Aquí la decisión combina cuatro señales, en este orden:
 *   1. cambio de escena          → siempre se analiza (ya lo hacía);
 *   2. techo de la escena        → nunca más de `maxFramesPerScene`, antes de
 *      mirar nada más (protege el detector de vídeos estáticos largos);
 *   3. cambio VISUAL, global o LOCAL (región de un track activo) → se analiza;
 *   4. sin cambio visual: se analiza igual si falta para el mínimo de la
 *      escena, o si ha pasado demasiado tiempo de vídeo sin analizar nada
 *      (`sampleIntervalMs`).
 * Solo si nada de eso aplica, el frame se descarta.
 */

export type FrameSamplingDecision = {
  keep: boolean;
  reason: FrameSamplingReason;
};

export type FrameSamplingConfig = {
  perceptualHashEnabled: boolean;
  minFramesPerScene: number;
  maxFramesPerScene: number;
  sampleIntervalMs: number;
  phashDedupThreshold: number;
};

/**
 * ¿Cambió lo bastante la región de ALGÚN track activo entre dos thumbs?
 *
 * Compara la MISMA caja normalizada en el thumb actual y en el último
 * analizado: no es tracking real (el objeto puede haberse desplazado), pero
 * basta como señal de "algo cambió aquí" — una oclusión, un giro, una prenda
 * nueva superpuesta — que el hash del frame completo diluye.
 */
export function hasLocalChange(
  current: DecodedThumb,
  previous: DecodedThumb,
  activeBoxes: ReadonlyArray<BoundingBox | null | undefined>,
  threshold: number
): boolean {
  for (const box of activeBoxes) {
    if (!box) continue;
    const a = averageHash(current, box);
    const b = averageHash(previous, box);
    if (hammingDistance(a, b) > threshold) return true;
  }
  return false;
}

export function decideFrameSampling(args: {
  sceneChanged: boolean;
  hash: string | null;
  lastAnalyzedHash: string | null;
  /** Frames YA analizados en la escena actual, antes de este frame. */
  sceneAnalyzedCount: number;
  /** Segundos de vídeo desde el último frame analizado, o null si es el primero. */
  secondsSinceLastAnalyzed: number | null;
  localChange: boolean;
  config: FrameSamplingConfig;
}): FrameSamplingDecision {
  const {
    sceneChanged,
    hash,
    lastAnalyzedHash,
    sceneAnalyzedCount,
    secondsSinceLastAnalyzed,
    localChange,
    config,
  } = args;

  if (!config.perceptualHashEnabled) {
    return { keep: true, reason: "kept:hash_disabled" };
  }
  if (sceneChanged) {
    return { keep: true, reason: "kept:scene_first" };
  }
  if (sceneAnalyzedCount >= config.maxFramesPerScene) {
    return { keep: false, reason: "discarded:max_frames_cap" };
  }

  const isNearDuplicate =
    hash !== null &&
    lastAnalyzedHash !== null &&
    hammingDistance(hash, lastAnalyzedHash) <= config.phashDedupThreshold;

  if (!isNearDuplicate) {
    return { keep: true, reason: "kept:visual_change" };
  }
  if (localChange) {
    return { keep: true, reason: "kept:local_change" };
  }
  if (sceneAnalyzedCount < config.minFramesPerScene) {
    return { keep: true, reason: "kept:min_frames_quota" };
  }
  const maxGapSeconds = config.sampleIntervalMs / 1000;
  if (secondsSinceLastAnalyzed !== null && secondsSinceLastAnalyzed >= maxGapSeconds) {
    return { keep: true, reason: "kept:max_gap" };
  }
  return { keep: false, reason: "discarded:near_duplicate" };
}
