import type { MatchingMode, ProductMatchingResult } from "@/lib/matching/types";
import type { BoundingBox, DetectedItem, VideoAnalysisConfig } from "@/lib/types";
import type { RawThumb } from "./perceptualHash";

/**
 * Tipos del JOB DE ANÁLISIS ASÍNCRONO de vídeo subido (demo ≤ 2 min,
 * preparado para episodios largos).
 *
 * Principio de diseño: TODO el estado vive en el store (memoria o Postgres),
 * nunca en variables de módulo del route handler. Así:
 *  - un job es reanudable (checkpoint por timestamp procesado),
 *  - varios workers podrían procesar segmentos disjuntos del mismo contenido
 *    en el futuro (el estado compartido está serializado en el store),
 *  - GET /status es una lectura pura del store.
 */

export type AnalysisJobStatus =
  | "queued"
  | "running"
  | "partially_completed"
  | "completed"
  | "failed"
  | "cancelled";

/** Metadata del vídeo subido que declara el cliente al crear el job. */
export type CreateAnalysisJobInput = {
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  matchingMode?: string;
  analysisConfig?: unknown;
};

export type MediaContentRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  createdAt: number;
};

/** Frame que el cliente envía por lotes a POST /jobs/[id]/frames. */
export type FramePayload = {
  timestampSeconds: number;
  /** Frame como data URL JPEG (≤1280px, lib/frameCapture). */
  dataUrl: string;
  /**
   * Thumbnail RAW (RGB) para hash perceptual/escenas EN SERVIDOR: Node no
   * decodifica JPEG sin deps nativas, así que el cliente (que ya tiene el
   * canvas) manda estos ~7KB extra. Sin thumb, el servidor no puede dedupear
   * por hash y analiza el frame igualmente (degradación documentada).
   */
  thumb?: RawThumb;
};

export type SceneRecord = {
  sceneId: number;
  startSeconds: number;
  endSeconds: number;
  frameCount: number;
};

/** Mejor encuadre visto de un track (para pagar matching UNA vez y bien). */
export type BestCropRecord = {
  timestampSeconds: number;
  box: BoundingBox | null;
  /** Calidad compuesta: área × confianza × (0.7 + 0.3 × nitidez). */
  quality: number;
  sharpness: number;
  /** Frame completo del mejor momento (para matching si no llega el crop). */
  frameDataUrl: string | null;
  /** Crop real subido por el cliente (POST /jobs/[id]/crops), si llegó. */
  cropDataUrl: string | null;
  /** aHash de la región del crop en el thumb: firma para dedup global. */
  signatureHash: string | null;
};

export type TrackRecord = {
  trackId: string;
  category: string;
  name: string;
  color: string | null;
  firstSeenSeconds: number;
  lastSeenSeconds: number;
  seenFrameCount: number;
  confidence: number;
  bestCrop: BestCropRecord;
  /** Item representativo (el de mayor confianza) como input de matching. */
  representativeItem: DetectedItem;
};

export type AppearanceRecord = {
  trackId: string;
  timestampSeconds: number;
  sceneId: number;
  box: BoundingBox | null;
  confidence: number;
};

/** Tramo continuo de apariciones de un producto (timeline de la UI). */
export type TimelineSegment = {
  startSeconds: number;
  endSeconds: number;
};

/** Producto ÚNICO tras la deduplicación global entre tracks. */
export type UniqueProductRecord = {
  productId: string;
  /** Tracks fundidos (reaparición del mismo objeto ⇒ >1 trackId). */
  trackIds: string[];
  item: DetectedItem;
  bestCrop: BestCropRecord;
  segments: TimelineSegment[];
  matching: ProductMatchingResult | null;
  /** Nº de llamadas de matching con búsqueda externa habilitada gastadas. */
  externalSearchesUsed: number;
  /** Motivo por el que no hay matching (cancelled, budget, error…), o null. */
  matchingSkippedReason: string | null;
};

export type JobCounters = {
  framesReceived: number;
  /** Frames que pasaron el filtro y fueron al detector. */
  framesAnalyzed: number;
  /** Frames descartados por hash perceptual (casi idénticos). */
  framesSkippedSimilar: number;
  /** Frames descartados por checkpoint (ya procesados; reenvío/reanudación). */
  framesSkippedCheckpoint: number;
  scenes: number;
  tracks: number;
  uniqueProducts: number;
  /** Tracks fundidos por dedup global = búsquedas caras evitadas por dedup. */
  dedupMergedTracks: number;
  externalSearchesUsed: number;
  /** Matching resuelto por caché del pipeline (no se pagó proveedor). */
  cacheHits: number;
  /** Matching resuelto por el catálogo propio (no se pagó proveedor externo). */
  catalogHits: number;
};

export type JobTimings = {
  hashMs: number;
  detectionMs: number;
  trackingMs: number;
  dedupMs: number;
  matchingMs: number;
  totalMs: number;
};

export type JobCheckpoint = {
  /** Hasta qué timestamp (segundos de vídeo) se ha procesado. Reanudable. */
  processedUpToSeconds: number;
  lastBatchAt: number | null;
};

export type AnalysisJobRecord = {
  id: string;
  status: AnalysisJobStatus;
  media: MediaContentRecord;
  matchingMode: MatchingMode;
  analysisConfig: VideoAnalysisConfig;
  checkpoint: JobCheckpoint;
  counters: JobCounters;
  timings: JobTimings;
  warnings: string[];
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

/**
 * Estado de runtime serializable del job (tracker, escenas, apariciones…).
 * Vive en el store — NUNCA en memoria del route — para que otro worker (u
 * otra instancia tras un deploy) pueda continuar el job desde el checkpoint.
 */
export type JobRuntimeState = {
  /** Thumb del último frame RECIBIDO (diff de escena del siguiente). */
  lastThumb: RawThumb | null;
  /** aHash del último frame ANALIZADO (dedup de casi idénticos). */
  lastAnalyzedHash: string | null;
  currentSceneId: number;
  scenes: SceneRecord[];
  /** Tracker serializado (lib/video/tracker usa Map en memoria). */
  trackerTracks: SerializedTrack[];
  trackerNextId: number;
  tracks: Record<string, TrackRecord>;
  appearances: AppearanceRecord[];
};

/** TrackedProduct de lib/video/tracker en forma serializable. */
export type SerializedTrack = {
  trackId: string;
  category: string;
  name: string;
  firstSeenAt: number;
  lastSeenAt: number;
  seenFrameCount: number;
  currentBoundingBox: BoundingBox | null;
  bestBoundingBox: BoundingBox | null;
  bestCropQuality: number;
  confidence: number;
  status: "tracking" | "lost";
};

/** Petición al cliente: "súbeme el crop de este momento" (mejor encuadre). */
export type CropRequest = {
  trackId: string;
  timestampSeconds: number;
  box: BoundingBox;
};

export type CropPayload = {
  trackId: string;
  timestampSeconds: number;
  dataUrl: string;
};

/** Resultado de procesar un lote de frames (respuesta del route). */
export type FrameBatchResult = {
  jobId: string;
  status: AnalysisJobStatus;
  accepted: number;
  skippedCheckpoint: number;
  skippedSimilar: number;
  analyzed: number;
  checkpoint: JobCheckpoint;
  cropRequests: CropRequest[];
  /** Detecciones por frame analizado (overlay en vivo de la demo). */
  frames: Array<{
    timestampSeconds: number;
    analyzed: boolean;
    sceneId: number | null;
    items: Array<DetectedItem & { trackId: string }>;
  }>;
};

/** Vista completa para GET /jobs/[id]. */
export type AnalysisJobStatusView = AnalysisJobRecord & {
  scenes: SceneRecord[];
  tracks: Array<
    Pick<
      TrackRecord,
      | "trackId"
      | "category"
      | "name"
      | "firstSeenSeconds"
      | "lastSeenSeconds"
      | "seenFrameCount"
      | "confidence"
    >
  >;
  products: UniqueProductRecord[];
};
