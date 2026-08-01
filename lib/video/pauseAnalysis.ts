import type { DetectedItem } from "@/lib/types";

export const PAUSED_FRAME_TIME_TOLERANCE_MS = Number(
  process.env.NEXT_PUBLIC_PAUSED_FRAME_TIME_TOLERANCE_MS ?? "80"
);
export const VIDEO_NEAREST_FRAME_TOLERANCE_MS = Number(
  process.env.NEXT_PUBLIC_VIDEO_NEAREST_FRAME_TOLERANCE_MS ?? "250"
);
export const VIDEO_FRAME_CACHE_SECONDS = Number(
  process.env.NEXT_PUBLIC_VIDEO_FRAME_CACHE_SECONDS ?? "120"
);

export type CapturedVideoFrame = {
  frameId: string;
  videoId: string;
  mediaTime: number;
  currentTime: number;
  capturedAt: number;
  width: number;
  height: number;
  blob: Blob;
  hash: string;
};

export type FrameAnalysisSession = {
  sessionId: string;
  frameId: string;
  mediaTime: number;
  abortController: AbortController;
};

export type AnalysisIdentity = Pick<
  FrameAnalysisSession,
  "sessionId" | "frameId" | "mediaTime"
>;

export type AnalyzedVideoFrame = {
  videoId: string;
  frameId: string;
  mediaTime: number;
  frameHash: string;
  detections: DetectedItem[];
  tracks: string[];
  analyzedAt: number;
};

export type PausePerformanceMetrics = {
  pauseToCaptureMs: number | null;
  captureToDetectionMs: number | null;
  detectionCacheHit: boolean;
  cropMs: number | null;
  embeddingMs: number | null;
  vectorSearchMs: number | null;
  rankingMs: number | null;
  catalogFirstResultMs: number | null;
  externalSearchMs: number | null;
  totalMs: number | null;
};

export function responseMatchesActiveSession(
  response: AnalysisIdentity,
  active: AnalysisIdentity | null,
  toleranceMs = PAUSED_FRAME_TIME_TOLERANCE_MS
): boolean {
  if (!active) return false;
  return (
    response.sessionId === active.sessionId &&
    response.frameId === active.frameId &&
    Math.abs(response.mediaTime - active.mediaTime) * 1000 <= toleranceMs
  );
}

export function nearestAnalyzedFrame(
  frames: readonly AnalyzedVideoFrame[],
  videoId: string,
  mediaTime: number,
  toleranceMs = VIDEO_NEAREST_FRAME_TOLERANCE_MS
): AnalyzedVideoFrame | null {
  let best: AnalyzedVideoFrame | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    if (frame.videoId !== videoId) continue;
    const delta = Math.abs(frame.mediaTime - mediaTime) * 1000;
    if (delta <= toleranceMs && delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best;
}

/** Caché temporal acotada por vídeo para detecciones anticipadas. */
export function pruneAnalyzedFrames(
  frames: readonly AnalyzedVideoFrame[],
  newestMediaTime: number,
  maxAgeSeconds = VIDEO_FRAME_CACHE_SECONDS
): AnalyzedVideoFrame[] {
  const minTime = Math.max(0, newestMediaTime - maxAgeSeconds);
  const byIdentity = new Map<string, AnalyzedVideoFrame>();
  for (const frame of frames) {
    if (frame.mediaTime < minTime) continue;
    byIdentity.set(`${frame.videoId}:${frame.frameHash}:${frame.mediaTime.toFixed(3)}`, frame);
  }
  return [...byIdentity.values()].sort((a, b) => a.mediaTime - b.mediaTime);
}

export const EMPTY_PAUSE_METRICS: PausePerformanceMetrics = {
  pauseToCaptureMs: null,
  captureToDetectionMs: null,
  detectionCacheHit: false,
  cropMs: null,
  embeddingMs: null,
  vectorSearchMs: null,
  rankingMs: null,
  catalogFirstResultMs: null,
  externalSearchMs: null,
  totalMs: null,
};
