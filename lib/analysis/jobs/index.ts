/**
 * Job de análisis asíncrono de vídeo (Parte 3 de la spec).
 *
 * Arquitectura (ver también store.ts para el plan multi-worker):
 *   cliente (decodifica el vídeo, extrae frames a VIDEO_DETECTION_FPS)
 *     → POST /api/analysis/jobs                (validación + jobId)
 *     → POST /api/analysis/jobs/[id]/frames    (lotes con checkpoint)
 *     → POST /api/analysis/jobs/[id]/crops     (mejor crop real por track)
 *     → POST /api/analysis/jobs/[id]/finalize  (dedup global + matching)
 *     → GET  /api/analysis/jobs/[id]           (estado/progreso/timeline)
 *     → POST /api/analysis/jobs/[id]/cancel
 */
export * from "./types";
export * from "./config";
export * from "./perceptualHash";
export { getAnalysisJobStore, InMemoryAnalysisJobStore } from "./store";
export type { AnalysisJobStore, FrameMetaRow } from "./store";
export {
  attachCrops,
  buildSegments,
  cancelAnalysisJob,
  createAnalysisJob,
  dedupTracksIntoProducts,
  finalizeAnalysisJob,
  getJobAppearances,
  getJobStatusView,
  MAX_FRAMES_PER_BATCH,
  processFrameBatch,
  sameProductSignature,
  validateCreateJobInput,
  type JobEngineDeps,
  type MatchProductFn,
} from "./engine";
