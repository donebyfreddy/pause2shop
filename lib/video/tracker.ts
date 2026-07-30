import type { BoundingBox, DetectedItem } from "@/lib/types";
import { iou, isValidBox } from "./boxMapping";

/**
 * Tracker ligero de productos entre pasadas de detección (cliente, puro).
 *
 * La detección completa corre cada ~1-3s; entre pasadas este tracker asocia
 * los objetos nuevos a tracks existentes por IoU + categoría + nombre, de modo
 * que la misma camisa conserva el mismo `trackId` mientras está en escena y
 * dos tazas diferentes conviven como dos tracks. Sin dependencia del DOM →
 * test/tracker.test.ts.
 */

export type TrackedProduct = {
  trackId: string;
  category: string;
  name: string;
  firstSeenAt: number;
  lastSeenAt: number;
  seenFrameCount: number;
  currentBoundingBox: BoundingBox | null;
  bestBoundingBox: BoundingBox | null;
  /** Calidad del mejor encuadre visto: área × confianza (proxy sin CV). */
  bestCropQuality: number;
  confidence: number;
  status: "tracking" | "lost";
};

export type TrackerState = {
  tracks: Map<string, TrackedProduct>;
  nextId: number;
};

export function createTrackerState(): TrackerState {
  return { tracks: new Map(), nextId: 1 };
}

/** Un track se da por perdido si no reaparece en este tiempo. */
const LOST_AFTER_MS = 6000;
/** IoU mínimo para asociar detección↔track cuando la categoría coincide. */
const MATCH_IOU = 0.3;

function normText(s?: string | null): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function shortName(name: string): string {
  return normText(name).split(/\s+/).slice(0, 3).join(" ");
}

/** Calidad de encuadre: área normalizada × confianza (0-1). */
export function cropQualityScore(
  box: BoundingBox | null | undefined,
  confidence: number
): number {
  if (!isValidBox(box)) return 0;
  return Math.min(1, box.width * box.height * 4) * confidence;
}

/**
 * Asocia una pasada de detección con los tracks vivos.
 * Devuelve los items con `trackId` asignado (campo extra) y muta el estado.
 */
export function associateDetections(
  state: TrackerState,
  detections: DetectedItem[],
  now: number
): Array<DetectedItem & { trackId: string }> {
  // Marca como perdidos los tracks que llevan demasiado sin verse.
  for (const track of state.tracks.values()) {
    if (track.status === "tracking" && now - track.lastSeenAt > LOST_AFTER_MS) {
      track.status = "lost";
    }
  }

  const liveTracks = [...state.tracks.values()].filter((t) => t.status === "tracking");
  const claimed = new Set<string>();
  const out: Array<DetectedItem & { trackId: string }> = [];

  for (const det of detections) {
    let best: { track: TrackedProduct; score: number } | null = null;
    for (const track of liveTracks) {
      if (claimed.has(track.trackId)) continue;
      if (normText(track.category) !== normText(det.category)) continue;

      // Señal geométrica (IoU) + señal semántica (mismo nombre corto).
      const geo =
        isValidBox(det.bounding_box) && isValidBox(track.currentBoundingBox)
          ? iou(det.bounding_box, track.currentBoundingBox)
          : 0;
      const sameName = shortName(track.name) === shortName(det.name);
      const score = geo + (sameName ? 0.5 : 0);
      if (score >= (sameName ? 0.5 : MATCH_IOU) && (!best || score > best.score)) {
        best = { track, score };
      }
    }

    let track: TrackedProduct;
    if (best) {
      track = best.track;
      claimed.add(track.trackId);
      track.lastSeenAt = now;
      track.seenFrameCount += 1;
      track.currentBoundingBox = det.bounding_box ?? track.currentBoundingBox;
      track.confidence = Math.max(track.confidence, det.confidence);
      track.name = det.name.length > track.name.length ? det.name : track.name;
      const quality = cropQualityScore(det.bounding_box, det.confidence);
      if (quality > track.bestCropQuality) {
        track.bestCropQuality = quality;
        track.bestBoundingBox = det.bounding_box ?? track.bestBoundingBox;
      }
    } else {
      track = {
        trackId: `t${state.nextId++}`,
        category: det.category,
        name: det.name,
        firstSeenAt: now,
        lastSeenAt: now,
        seenFrameCount: 1,
        currentBoundingBox: det.bounding_box ?? null,
        bestBoundingBox: det.bounding_box ?? null,
        bestCropQuality: cropQualityScore(det.bounding_box, det.confidence),
        confidence: det.confidence,
        status: "tracking",
      };
      state.tracks.set(track.trackId, track);
      claimed.add(track.trackId);
    }
    out.push({ ...det, trackId: track.trackId });
  }

  return out;
}

/** Nº de tracks visibles ahora mismo. */
export function activeTrackCount(state: TrackerState): number {
  let n = 0;
  for (const t of state.tracks.values()) if (t.status === "tracking") n++;
  return n;
}
