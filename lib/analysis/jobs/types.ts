import type {
  DetectionMatchResult,
  MatchingMode,
  ProductMatchingResult,
} from "@/lib/matching/types";
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
  /** SHA-256 del contenido real, calculado antes de crear el job. */
  videoHash?: string;
  /** Omite la reutilización aunque hash+versiones coincidan. */
  forceReprocess?: boolean;
};

export type MediaContentRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number;
  fileHash: string | null;
  catalogVersion: string;
  analysisVersion: string;
  processedAt: number | null;
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
  /**
   * Embedding CLIP del mejor crop. Se calcula UNA vez por track, en local y
   * justo antes del dedup global: es la señal que decide la identidad. No es
   * el embedding del catálogo (esos están precalculados en la ingesta y jamás
   * se generan durante una búsqueda); este es el del recorte, que por
   * definición no puede precalcularse.
   */
  embedding: number[] | null;
  /** Desglose de `cropQuality` — para poder auditar por qué ganó este crop. */
  qualityBreakdown?: CropQualityBreakdown;
};

/** Componentes de la calidad de un encuadre (todas 0-1). */
export type CropQualityBreakdown = {
  sharpness: number;
  resolution: number;
  visibility: number;
  lowOcclusion: number;
  frontalView: number;
  logoVisibility: number;
  detectorConfidence: number;
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

/**
 * Estado de matching de un producto único.
 *
 * Antes solo había `matching: ProductMatchingResult | null` +
 * `matchingSkippedReason: string`, así que TODO lo que no fuera un match salía
 * como "NO MATCH" o como un mensaje de error crudo pegado en la tarjeta
 * (`matching omitido: The operation was aborted due to timeout`). Eso mezcla
 * tres cosas muy distintas para quien mira la pantalla:
 *   - "se buscó y no existe"      → no_match, definitivo;
 *   - "no dio tiempo"             → *_timeout, REINTENTABLE;
 *   - "se rompió el embedding"    → embedding_error, hay que mirar el log.
 * Con un único cajón no se puede decidir qué reintentar ni qué revisar.
 */
export type ProductMatchStatus =
  /** Resuelto por el catálogo propio por encima del umbral. */
  | "catalog_matched"
  /** Internet encontró algo fiable: queda pendiente de revisión, no publicado. */
  | "external_candidate"
  /** Se consultó todo lo que procedía y no hay coincidencia. Definitivo. */
  | "no_match"
  /** El catálogo no respondió a tiempo. Reintentable. */
  | "catalog_timeout"
  /** La búsqueda externa no respondió a tiempo. Reintentable. */
  | "external_timeout"
  /** No se pudo calcular el embedding del crop. */
  | "embedding_error"
  /** Una fuente respondió y la otra falló: hay resultado, pero incompleto. */
  | "partial_result"
  /** Nunca se buscó: job cancelado, presupuesto agotado o sin crop. */
  | "not_searched"
  /** Error inesperado tras agotar los reintentos. */
  | "matching_error";

/** Estados que merece la pena reintentar (los transitorios). */
export const RETRYABLE_MATCH_STATUSES: ReadonlySet<ProductMatchStatus> = new Set([
  "catalog_timeout",
  "external_timeout",
  "matching_error",
]);

/** Producto ÚNICO tras la deduplicación global entre tracks. */
export type UniqueProductRecord = {
  productId: string;
  /** Tracks fundidos (reaparición del mismo objeto ⇒ >1 trackId). */
  trackIds: string[];
  item: DetectedItem;
  bestCrop: BestCropRecord;
  segments: TimelineSegment[];
  matching: ProductMatchingResult | null;
  /** Bloques separados catálogo/Internet, tal cual los devolvió el resolver. */
  detection: DetectionMatchResult | null;
  /** Estado exacto del matching — nunca un "NO MATCH" para todo. */
  matchStatus: ProductMatchStatus;
  /** Intentos consumidos (1 = fue a la primera). */
  matchAttempts: number;
  /** Mensaje técnico del último fallo, si lo hubo. Para el log, no para la UI. */
  matchError: string | null;
  /** Duración del matching de ESTE producto. */
  matchDurationMs: number;
  /** Nº de llamadas de matching con búsqueda externa habilitada gastadas. */
  externalSearchesUsed: number;
  /**
   * Marcado por el dedup global cuando dos productos se parecen lo bastante
   * para sospechar (entre el umbral posible y el fuerte) pero no lo bastante
   * para fundirlos solos. Requiere decisión humana.
   */
  possibleDuplicateOf: string | null;
  /** Identidad canónica y apariciones. Ver `VideoProductIdentity`. */
  identity: VideoProductIdentity;
};

/**
 * Identidad global de un producto dentro de un vídeo: es lo que convierte
 * "cinco tarjetas de la misma camiseta" en una sola con ocho apariciones.
 */
export type VideoProductIdentity = {
  /** Nombre elegido entre todas las variantes observadas. */
  canonicalLabel: string;
  /** Familia canónica (`prenda_superior`, `calzado`…), no el texto del modelo. */
  canonicalCategory: string;
  category: string;
  subcategory: string | null;
  color: string | null;
  pattern: string | null;
  material: string | null;
  /** Todas las variantes de nombre que el modelo produjo para este producto. */
  observedLabels: string[];
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  /** Todos los timestamps en los que se vio, en ms y ordenados. */
  timestampsMs: number[];
  seenCount: number;
  /** Escenas en las que aparece. */
  sceneIds: number[];
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
  /** Productos cuyo catálogo agotó su presupuesto de tiempo. Reintentables. */
  catalogTimeouts: number;
  /** Productos cuya búsqueda externa agotó su presupuesto de tiempo. */
  externalTimeouts: number;
  /** Candidatos externos guardados a la espera de revisión. */
  externalCandidates: number;
  /** Pares marcados como posible duplicado (entre umbral posible y fuerte). */
  possibleDuplicates: number;
  /** Reintentos de matching consumidos en total. */
  matchingRetries: number;
};

export type JobTimings = {
  hashMs: number;
  detectionMs: number;
  trackingMs: number;
  /** Embeddings de los mejores crops (previo al dedup global). */
  cropEmbeddingMs?: number;
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
