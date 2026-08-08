import { randomUUID } from "node:crypto";
import { getMatchingConfig } from "@/lib/matching/config";
import { normalizeMatchingMode } from "@/lib/matching/types";
import type { MatchingMode } from "@/lib/matching/types";
import { parseConfig } from "@/lib/analysis/categories";
import {
  associateDetections,
  type TrackerState,
  type TrackedProduct,
} from "@/lib/video/tracker";
import type { ObjectDetector } from "@/lib/detection/types";
import type { DetectedItem } from "@/lib/types";
import { isSha256 } from "@/lib/videoProcessing/hash";
import {
  getVideoAnalysisJobConfig,
  type VideoAnalysisJobConfig,
} from "./config";
import {
  averageHash,
  decodeThumb,
  sharpnessScore,
  thumbDiff,
  type DecodedThumb,
  type RawThumb,
} from "./perceptualHash";
import { cropQuality } from "./cropQuality";
import {
  canonicalCategoryOf,
  canonicalLabel,
  identityScore,
  slotForItem,
} from "./identity";
import {
  matchUniqueProducts,
  type MatchProductFn,
  type ProductMatchOutcome,
} from "./productMatching";
import { decideFrameSampling, hasLocalChange } from "./sceneSampling";
import { computeTemporalCoverage } from "./coverage";
import { validateProcessedVideoResult } from "./validation";
import type { AnalysisJobStore } from "./store";
import type {
  AnalysisJobRecord,
  AnalysisJobStatusView,
  AppearanceRecord,
  BestCropRecord,
  CreateAnalysisJobInput,
  CropPayload,
  CropRequest,
  FrameBatchResult,
  FramePayload,
  FrameSamplingReason,
  JobRuntimeState,
  MatchProgressState,
  PendingFlushFrame,
  SceneRecord,
  SerializedTrack,
  TimelineSegment,
  TrackRecord,
  UniqueProductRecord,
} from "./types";

/**
 * MOTOR del job de análisis asíncrono. Puro respecto a I/O externo: el store,
 * el detector y el matcher entran como dependencias inyectables ⇒ los tests
 * corren el flujo completo sin red ni OpenAI.
 *
 * Flujo por lote de frames (POST /api/analysis/jobs/[id]/frames):
 *   checkpoint → diff de escena → hash perceptual (descartar casi idénticos)
 *   → detección SOLO en frames seleccionados → tracking server-side
 *   (lib/video/tracker reutilizado) → mejor crop por track.
 * Al finalizar: dedup GLOBAL entre tracks (firma perceptual + atributos) →
 * matching UNA vez por producto único (≤ MAX_EXTERNAL_SEARCHES_PER_PRODUCT
 * búsquedas caras) → timeline de apariciones.
 */

export type { MatchProductFn };

/**
 * Embedding del CROP (no del catálogo). Inyectable para que los tests corran
 * el pipeline entero sin cargar CLIP; en producción lo provee `serverDeps`.
 */
export type EmbedCropFn = (dataUrl: string) => Promise<number[] | null>;

export type PersistCatalogProductsFn = (
  job: AnalysisJobRecord,
  products: UniqueProductRecord[]
) => Promise<{ saved: number; failed: number }>;

export type JobEngineDeps = {
  store: AnalysisJobStore;
  detector: ObjectDetector;
  matchProduct: MatchProductFn;
  /** Ausente ⇒ el dedup cae al hash perceptual (peor, pero funciona). */
  embedCrop?: EmbedCropFn;
  /** Copia el resultado final al catálogo público (/catalog). */
  persistCatalogProducts?: PersistCatalogProductsFn;
  config?: VideoAnalysisJobConfig;
  env?: NodeJS.ProcessEnv;
  /** Log estructurado de etapas. Por defecto, `console`. */
  log?: (level: "info" | "warn" | "success", stage: string, message: string) => void;
};

/** Hueco máximo (s) entre apariciones para considerarlas el mismo tramo. */
const SEGMENT_MAX_GAP_SECONDS = 1.5;
/** Techo de frames por lote: protege la función de payloads absurdos. */
export const MAX_FRAMES_PER_BATCH = 25;

// ---------------------------------------------------------------------------
// Creación y validación del job
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export function validateCreateJobInput(
  input: CreateAnalysisJobInput,
  config: VideoAnalysisJobConfig
): ValidationResult {
  const duration = input.durationSeconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return { ok: false, status: 400, error: "Falta la duración del vídeo (segundos)." };
  }
  if (duration > config.maxVideoDurationSeconds) {
    return {
      ok: false,
      status: 413,
      error: `El vídeo dura ${Math.round(duration)}s y el máximo permitido es ${config.maxVideoDurationSeconds}s.`,
    };
  }
  if (typeof input.mimeType !== "string" || !input.mimeType.startsWith("video/")) {
    return { ok: false, status: 415, error: "El archivo debe ser un vídeo (MIME video/*)." };
  }
  if (
    typeof input.sizeBytes !== "number" ||
    !Number.isFinite(input.sizeBytes) ||
    input.sizeBytes <= 0
  ) {
    return { ok: false, status: 400, error: "Falta el tamaño del archivo (bytes)." };
  }
  if (input.sizeBytes > config.maxVideoSizeBytes) {
    return {
      ok: false,
      status: 413,
      error: `El archivo supera el tamaño máximo (${Math.round(config.maxVideoSizeBytes / 1024 / 1024)} MB).`,
    };
  }
  if (input.videoHash != null && !isSha256(input.videoHash)) {
    return { ok: false, status: 400, error: "videoHash debe ser un SHA-256 válido." };
  }
  return { ok: true };
}

function emptyRuntimeState(): JobRuntimeState {
  return {
    lastThumb: null,
    lastAnalyzedHash: null,
    lastAnalyzedThumb: null,
    lastAnalyzedAtSeconds: null,
    pendingFlushFrame: null,
    currentSceneId: 0,
    scenes: [],
    trackerTracks: [],
    trackerNextId: 1,
    tracks: {},
    appearances: [],
  };
}

export async function createAnalysisJob(
  input: CreateAnalysisJobInput,
  deps: JobEngineDeps
): Promise<
  | { ok: true; job: AnalysisJobRecord; reused: boolean; staleJob: AnalysisJobRecord | null }
  | { ok: false; error: string; status: number }
> {
  const config = deps.config ?? getVideoAnalysisJobConfig(deps.env);
  const valid = validateCreateJobInput(input, config);
  if (!valid.ok) return valid;

  // Modo de matching: override del cliente (selector de la demo) → env.
  const mode: MatchingMode =
    normalizeMatchingMode(input.matchingMode) ??
    getMatchingConfig(deps.env ?? process.env).mode;

  const env = deps.env ?? process.env;
  const catalogVersion = env.CATALOG_VERSION?.trim() || "catalog:v1";
  // v4: sampling adaptativo por escena, cobertura temporal, ReID con score
  // ponderado y matching en proceso (sin self-fetch). Un job "completed" de
  // v3 no copiaba sus productos únicos al catálogo público, por lo que no se
  // reutiliza como si ya hubiera completado esa persistencia.
  const analysisVersion = env.VIDEO_ANALYSIS_VERSION?.trim() || "video-pipeline:v4";
  let staleJob: AnalysisJobRecord | null = null;
  if (input.videoHash) {
    if (!input.forceReprocess) {
      const reusable = await deps.store.findReusableJob(
        input.videoHash,
        catalogVersion,
        analysisVersion
      );
      if (reusable) return { ok: true, job: reusable, reused: true, staleJob: null };
    }
    // No hay job reutilizable: si el más reciente para este vídeo tampoco
    // terminó en `completed` (partially_completed/failed/cancelled, o de una
    // versión anterior), se informa — el job que se crea a continuación es
    // SIEMPRE nuevo, nunca reanuda el incompleto.
    const latest = await deps.store.findLatestJobByHash(input.videoHash);
    if (latest && latest.status !== "completed") staleJob = latest;
  }

  const now = Date.now();
  const job: AnalysisJobRecord = {
    id: randomUUID(),
    status: "queued",
    media: {
      id: randomUUID(),
      fileName: (input.fileName ?? "").slice(0, 300),
      mimeType: input.mimeType!,
      sizeBytes: input.sizeBytes!,
      durationSeconds: input.durationSeconds!,
      fileHash: input.videoHash ?? null,
      catalogVersion,
      analysisVersion,
      processedAt: null,
      createdAt: now,
    },
    matchingMode: mode,
    analysisConfig: parseConfig(input.analysisConfig),
    checkpoint: { processedUpToSeconds: -1, lastBatchAt: null },
    counters: {
      framesReceived: 0,
      framesAnalyzed: 0,
      framesSkippedSimilar: 0,
      framesSkippedCheckpoint: 0,
      scenes: 0,
      tracks: 0,
      uniqueProducts: 0,
      dedupMergedTracks: 0,
      externalSearchesUsed: 0,
      cacheHits: 0,
      catalogHits: 0,
      catalogTimeouts: 0,
      externalTimeouts: 0,
      externalCandidates: 0,
      possibleDuplicates: 0,
      matchingRetries: 0,
    },
    timings: {
      hashMs: 0,
      detectionMs: 0,
      trackingMs: 0,
      dedupMs: 0,
      matchingMs: 0,
      totalMs: 0,
    },
    warnings: [],
    error: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    coverage: null,
    integrityErrors: [],
  };

  await deps.store.createJob(job, emptyRuntimeState());
  return { ok: true, job, reused: false, staleJob };
}

// ---------------------------------------------------------------------------
// Tracker: (de)serialización — lib/video/tracker trabaja con Map en memoria
// ---------------------------------------------------------------------------

function trackerFromState(state: JobRuntimeState): TrackerState {
  const tracks = new Map<string, TrackedProduct>();
  for (const t of state.trackerTracks) tracks.set(t.trackId, { ...t });
  return { tracks, nextId: state.trackerNextId };
}

function trackerToState(tracker: TrackerState): {
  trackerTracks: SerializedTrack[];
  trackerNextId: number;
} {
  return {
    trackerTracks: [...tracker.tracks.values()].map((t) => ({ ...t })),
    trackerNextId: tracker.nextId,
  };
}

// ---------------------------------------------------------------------------
// Procesamiento de un lote de frames (con checkpoint reanudable)
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(["queued", "running"]);

type FrameMetaEntry = {
  timestampSeconds: number;
  analyzed: boolean;
  sceneId: number | null;
  reason: FrameSamplingReason;
};

/** Nueva escena vacía, lista para recibir su primer frame. */
function openScene(sceneId: number, ts: number): SceneRecord {
  return {
    sceneId,
    startSeconds: ts,
    endSeconds: ts,
    frameCount: 0,
    analyzedFrameCount: 0,
    status: "extracting",
    lastAnalyzedSeconds: null,
    failureReason: null,
  };
}

/**
 * Cierra una escena que ya no va a recibir más frames (llega la siguiente, o
 * el job finaliza). `failed` aquí NO significa "un frame falló" — eso ya se
 * tolera arriba con un warning y se sigue; significa que la escena, con
 * `sceneCoverageRequired` activo, terminó sin analizar ni un frame.
 */
function closeScene(scene: SceneRecord, config: VideoAnalysisJobConfig): void {
  if (config.sceneCoverageRequired && scene.analyzedFrameCount === 0) {
    scene.status = "failed";
    scene.failureReason = "La escena terminó sin analizar ningún frame.";
    return;
  }
  scene.status = "completed";
}

/**
 * Detección + tracking de UN frame ya decidido como "se analiza". Aislado de
 * `processFrameBatch` para poder reutilizarlo también en el rescate de
 * `pendingFlushFrame` al cerrar una escena.
 *
 * Un fallo en tracking (antes sin try/catch: una excepción aquí tiraba el
 * lote ENTERO, con todas sus demás escenas) se trata igual que un fallo de
 * detección: warning y frame no contado como analizado, sin abortar nada.
 */
async function analyzeFrame(args: {
  job: AnalysisJobRecord;
  state: JobRuntimeState;
  tracker: TrackerState;
  scene: SceneRecord;
  ts: number;
  dataUrl: string;
  thumb: DecodedThumb | null;
  hash: string | null;
  rawThumb: RawThumb | null | undefined;
  config: VideoAnalysisJobConfig;
  deps: JobEngineDeps;
  cropRequests: CropRequest[];
  frameMeta: FrameMetaEntry[];
  frameResults: FrameBatchResult["frames"];
  reason: FrameSamplingReason;
}): Promise<boolean> {
  const {
    job, state, tracker, scene, ts, dataUrl, thumb, hash, rawThumb, config, deps,
    cropRequests, frameMeta, frameResults, reason,
  } = args;

  scene.status = "detecting";
  const tDetect = Date.now();
  let detections: DetectedItem[];
  try {
    detections = await deps.detector.detect({
      dataUrl,
      timestampSeconds: ts,
      analysisConfig: job.analysisConfig,
    });
  } catch (err) {
    // Un frame fallido no tumba el job: warning y seguimos (el checkpoint ya
    // avanzó; el estado final podrá ser partially_completed).
    job.warnings.push(
      `Detección fallida en t=${ts.toFixed(2)}s: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`
    );
    job.timings.detectionMs += Date.now() - tDetect;
    frameMeta.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId, reason });
    frameResults.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId, items: [] });
    return false;
  }
  job.timings.detectionMs += Date.now() - tDetect;

  try {
    scene.status = "tracking";
    // Tracking server-side reutilizando lib/video/tracker: el tiempo del
    // tracker es TIEMPO DE VÍDEO en ms (un track se pierde tras ~6s de vídeo
    // sin verse — la reaparición posterior la funde el dedup global).
    const tTrack = Date.now();
    const withTracks = config.trackingEnabled
      ? associateDetections(tracker, detections, Math.round(ts * 1000))
      : // Tracking desactivado: cada detección abre track nuevo (el dedup
        // global sigue fundiendo el mismo objeto). Se conserva el contador
        // de ids para que no colisionen entre lotes.
        detections.map((d) => ({ ...d, trackId: `t${tracker.nextId++}` }));

    for (const det of withTracks) {
      updateTrackRecord(state, det, ts, dataUrl, thumb, config, cropRequests);
      state.appearances.push({
        trackId: det.trackId,
        timestampSeconds: ts,
        sceneId: scene.sceneId,
        box: det.bounding_box ?? null,
        confidence: det.confidence,
      });
    }
    job.timings.trackingMs += Date.now() - tTrack;

    job.counters.framesAnalyzed++;
    scene.analyzedFrameCount++;
    scene.lastAnalyzedSeconds = ts;
    state.lastAnalyzedHash = hash;
    state.lastAnalyzedThumb = rawThumb ?? null;
    state.lastAnalyzedAtSeconds = ts;

    frameMeta.push({ timestampSeconds: ts, analyzed: true, sceneId: scene.sceneId, reason });
    frameResults.push({ timestampSeconds: ts, analyzed: true, sceneId: scene.sceneId, items: withTracks });
    return true;
  } catch (err) {
    job.warnings.push(
      `Tracking fallido en t=${ts.toFixed(2)}s: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`
    );
    frameMeta.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId, reason });
    frameResults.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId, items: [] });
    return false;
  }
}

/**
 * Rescata, si hace falta, el último frame descartado de una escena que se va
 * a cerrar. Sin esto, una escena corta con todo casi-idéntico podía cerrar
 * con menos frames analizados que el mínimo configurado — o con cero.
 */
async function attemptSceneFlush(args: {
  scene: SceneRecord;
  pending: PendingFlushFrame | null;
  job: AnalysisJobRecord;
  state: JobRuntimeState;
  tracker: TrackerState;
  config: VideoAnalysisJobConfig;
  deps: JobEngineDeps;
  cropRequests: CropRequest[];
  frameMeta: FrameMetaEntry[];
  frameResults: FrameBatchResult["frames"];
}): Promise<boolean> {
  const { scene, pending, job, state, tracker, config, deps, cropRequests, frameMeta, frameResults } = args;
  if (!pending) return false;
  if (scene.analyzedFrameCount >= config.minFramesPerScene) return false;
  if (pending.timestampSeconds < scene.startSeconds || pending.timestampSeconds > scene.endSeconds) {
    return false;
  }
  const thumb = pending.thumb ? decodeThumb(pending.thumb) : null;
  const hash = thumb ? averageHash(thumb) : null;
  return analyzeFrame({
    job, state, tracker, scene,
    ts: pending.timestampSeconds,
    dataUrl: pending.dataUrl,
    thumb,
    hash,
    rawThumb: pending.thumb,
    config,
    deps,
    cropRequests,
    frameMeta,
    frameResults,
    reason: "kept:scene_last",
  });
}

export async function processFrameBatch(
  jobId: string,
  frames: FramePayload[],
  deps: JobEngineDeps
): Promise<
  | { ok: true; result: FrameBatchResult }
  | { ok: false; error: string; status: number }
> {
  const config = deps.config ?? getVideoAnalysisJobConfig(deps.env);
  const job = await deps.store.getJob(jobId);
  if (!job) return { ok: false, status: 404, error: "Job no encontrado." };
  if (!ACTIVE_STATUSES.has(job.status)) {
    return {
      ok: false,
      status: 409,
      error: `El job está en estado "${job.status}" y no acepta más frames.`,
    };
  }
  const state = await deps.store.getRuntimeState(jobId);
  if (!state) return { ok: false, status: 500, error: "Estado del job no disponible." };

  const batch = [...frames]
    .filter(
      (f) =>
        typeof f.timestampSeconds === "number" &&
        Number.isFinite(f.timestampSeconds) &&
        typeof f.dataUrl === "string" &&
        f.dataUrl.startsWith("data:image/")
    )
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
    .slice(0, MAX_FRAMES_PER_BATCH);

  const tracker = trackerFromState(state);
  const cropRequests: CropRequest[] = [];
  const frameResults: FrameBatchResult["frames"] = [];
  const frameMeta: FrameMetaEntry[] = [];
  let skippedCheckpoint = 0;
  let skippedSimilar = 0;
  let analyzed = 0;

  for (const frame of batch) {
    const ts = frame.timestampSeconds;
    // CHECKPOINT: un timestamp ya procesado se ignora — el cliente puede
    // reenviar un segmento entero tras un corte y el job no repite trabajo.
    job.counters.framesReceived++;
    if (ts <= job.checkpoint.processedUpToSeconds) {
      skippedCheckpoint++;
      job.counters.framesSkippedCheckpoint++;
      continue;
    }

    const tHash = Date.now();
    const thumb = frame.thumb ? decodeThumb(frame.thumb) : null;

    // Escenas: diff perceptual contra el frame anterior RECIBIDO.
    let sceneChanged = false;
    if (config.sceneDetectionEnabled && thumb) {
      const prev = state.lastThumb ? decodeThumb(state.lastThumb) : null;
      const diff = prev ? thumbDiff(thumb, prev) : 1;
      sceneChanged = diff >= config.sceneDiffThreshold;
    }
    if (state.scenes.length === 0 || sceneChanged) {
      const previousScene = state.scenes.at(-1) ?? null;
      if (previousScene) {
        if (
          await attemptSceneFlush({
            scene: previousScene,
            pending: state.pendingFlushFrame,
            job, state, tracker, config, deps, cropRequests, frameMeta, frameResults,
          })
        ) {
          analyzed++;
        }
        state.pendingFlushFrame = null;
        closeScene(previousScene, config);
      }
      state.currentSceneId += 1;
      state.scenes.push(openScene(state.currentSceneId, ts));
    }
    const scene = state.scenes.at(-1)!;

    // Hash perceptual global + local (región de cada track activo).
    const hash = thumb ? averageHash(thumb) : null;
    job.timings.hashMs += Date.now() - tHash;

    let localChange = false;
    if (!sceneChanged && thumb && state.lastAnalyzedThumb) {
      const prevDecoded = decodeThumb(state.lastAnalyzedThumb);
      if (prevDecoded) {
        const activeBoxes = [...tracker.tracks.values()].map((t) => t.currentBoundingBox);
        localChange = hasLocalChange(thumb, prevDecoded, activeBoxes, config.phashDedupThreshold);
      }
    }

    const secondsSinceLastAnalyzed =
      state.lastAnalyzedAtSeconds === null ? null : ts - state.lastAnalyzedAtSeconds;

    const decision = decideFrameSampling({
      sceneChanged,
      hash,
      lastAnalyzedHash: state.lastAnalyzedHash,
      sceneAnalyzedCount: scene.analyzedFrameCount,
      secondsSinceLastAnalyzed,
      localChange,
      config,
    });

    state.lastThumb = frame.thumb ?? null;
    job.checkpoint.processedUpToSeconds = ts;
    scene.endSeconds = ts;
    scene.frameCount++;

    if (!decision.keep) {
      skippedSimilar++;
      job.counters.framesSkippedSimilar++;
      state.pendingFlushFrame = { timestampSeconds: ts, dataUrl: frame.dataUrl, thumb: frame.thumb ?? null };
      frameMeta.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId, reason: decision.reason });
      frameResults.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId, items: [] });
      continue;
    }
    state.pendingFlushFrame = null;

    const ok = await analyzeFrame({
      job, state, tracker, scene, ts,
      dataUrl: frame.dataUrl, thumb, hash, rawThumb: frame.thumb,
      config, deps, cropRequests, frameMeta, frameResults,
      reason: decision.reason,
    });
    if (ok) analyzed++;
  }

  // Persistencia del estado: TODO vive en el store (multi-worker ready).
  Object.assign(state, trackerToState(tracker));
  job.status = "running";
  job.startedAt ??= Date.now();
  job.checkpoint.lastBatchAt = Date.now();
  job.counters.scenes = state.scenes.length;
  job.counters.tracks = Object.keys(state.tracks).length;

  await deps.store.saveRuntimeState(jobId, state);
  await deps.store.updateJob(job);
  // Metadata de frames: best-effort (índices analíticos, no verdad operativa).
  try {
    await deps.store.recordFrames(jobId, frameMeta);
  } catch {
    // No romper el lote por un fallo del nivel analítico.
  }

  return {
    ok: true,
    result: {
      jobId,
      status: job.status,
      accepted: batch.length - skippedCheckpoint,
      skippedCheckpoint,
      skippedSimilar,
      analyzed,
      checkpoint: job.checkpoint,
      cropRequests,
      frames: frameResults,
    },
  };
}

/** Actualiza (o crea) el TrackRecord de una detección con trackId. */
function updateTrackRecord(
  state: JobRuntimeState,
  det: DetectedItem & { trackId: string },
  ts: number,
  frameDataUrl: string,
  thumb: DecodedThumb | null,
  config: VideoAnalysisJobConfig,
  cropRequests: CropRequest[]
): void {
  const sharpness = thumb ? sharpnessScore(thumb, det.bounding_box) : 0.5;
  const { score: quality, breakdown } = cropQuality({
    box: det.bounding_box ?? null,
    item: det,
    sharpness,
    slot: slotForItem(det),
  });

  const existing = state.tracks[det.trackId];
  if (!existing) {
    const best: BestCropRecord = {
      timestampSeconds: ts,
      box: det.bounding_box ?? null,
      quality,
      sharpness,
      frameDataUrl,
      cropDataUrl: null,
      signatureHash: thumb ? averageHash(thumb, det.bounding_box) : null,
      embedding: null,
      qualityBreakdown: breakdown,
    };
    state.tracks[det.trackId] = {
      trackId: det.trackId,
      category: det.category,
      name: det.name,
      color: det.color ?? null,
      firstSeenSeconds: ts,
      lastSeenSeconds: ts,
      seenFrameCount: 1,
      confidence: det.confidence,
      bestCrop: best,
      representativeItem: det,
    };
    if (det.bounding_box) {
      cropRequests.push({ trackId: det.trackId, timestampSeconds: ts, box: det.bounding_box });
    }
    return;
  }

  existing.lastSeenSeconds = ts;
  existing.seenFrameCount++;
  if (det.confidence > existing.confidence) {
    existing.confidence = det.confidence;
    existing.representativeItem = det;
  }
  if (det.name.length > existing.name.length) existing.name = det.name;
  existing.color ??= det.color ?? null;

  // Mejor crop SOLO si mejora lo suficiente (histéresis configurable): evita
  // pedir un crop nuevo al cliente por mejoras marginales. Y si se sustituye,
  // el embedding cacheado deja de valer — es de OTRO recorte.
  const required =
    existing.bestCrop.quality * (1 + config.bestCropImprovementThreshold);
  if (quality > required || existing.bestCrop.box === null) {
    existing.bestCrop = {
      timestampSeconds: ts,
      box: det.bounding_box ?? null,
      quality,
      sharpness,
      frameDataUrl,
      cropDataUrl: null,
      signatureHash: thumb ? averageHash(thumb, det.bounding_box) : existing.bestCrop.signatureHash,
      embedding: null,
      qualityBreakdown: breakdown,
    };
    if (det.bounding_box) {
      cropRequests.push({ trackId: det.trackId, timestampSeconds: ts, box: det.bounding_box });
    }
  }
}

// ---------------------------------------------------------------------------
// Crops reales subidos por el cliente (mejor encuadre por track)
// ---------------------------------------------------------------------------

const MAX_CROP_BYTES = 4 * 1024 * 1024;

export async function attachCrops(
  jobId: string,
  crops: CropPayload[],
  deps: JobEngineDeps
): Promise<{ ok: true; attached: number } | { ok: false; error: string; status: number }> {
  const job = await deps.store.getJob(jobId);
  if (!job) return { ok: false, status: 404, error: "Job no encontrado." };
  const state = await deps.store.getRuntimeState(jobId);
  if (!state) return { ok: false, status: 500, error: "Estado del job no disponible." };

  let attached = 0;
  for (const crop of crops) {
    if (!crop?.dataUrl?.startsWith("data:image/")) continue;
    if (crop.dataUrl.length * 0.75 > MAX_CROP_BYTES) continue;
    const track = state.tracks[crop.trackId];
    // Solo se acepta el crop del MEJOR momento actual del track (tolerancia
    // de medio frame): un crop viejo de un encuadre peor no pisa al bueno.
    if (!track || Math.abs(track.bestCrop.timestampSeconds - crop.timestampSeconds) > 0.06) {
      continue;
    }
    track.bestCrop.cropDataUrl = crop.dataUrl;
    attached++;
  }
  if (attached > 0) await deps.store.saveRuntimeState(jobId, state);
  return { ok: true, attached };
}

// ---------------------------------------------------------------------------
// Dedup GLOBAL entre tracks + matching por producto único + timeline
// ---------------------------------------------------------------------------

/**
 * ¿Son dos tracks el MISMO objeto físico?
 *
 * Se conserva por compatibilidad con los tests existentes y con el modo de
 * dedup simple. La decisión REAL la toma `identityScore`
 * (`lib/analysis/jobs/identity.ts`): esta función es su versión booleana con
 * los umbrales por defecto y sin señal de embedding.
 */
export function sameProductSignature(a: TrackRecord, b: TrackRecord): boolean {
  const breakdown = identityScore(a, b, { videoDurationSeconds: 1 });
  if (breakdown.blockedBySlot || breakdown.blockedByPerson) return false;
  return breakdown.score >= DEFAULT_IDENTITY_WEIGHTS_THRESHOLD;
}

/** Umbral por defecto de `sameProductSignature` (= VIDEO_PRODUCT_IDENTITY_THRESHOLD). */
const DEFAULT_IDENTITY_WEIGHTS_THRESHOLD = 0.84;

/** Fusiona timestamps de apariciones en tramos continuos para la timeline. */
export function buildSegments(
  timestamps: number[],
  maxGapSeconds = SEGMENT_MAX_GAP_SECONDS
): TimelineSegment[] {
  const sorted = [...timestamps].sort((a, b) => a - b);
  const segments: TimelineSegment[] = [];
  for (const ts of sorted) {
    const last = segments[segments.length - 1];
    if (last && ts - last.endSeconds <= maxGapSeconds) last.endSeconds = ts;
    else segments.push({ startSeconds: ts, endSeconds: ts });
  }
  return segments;
}

/** Grupo de tracks que el dedup considera un mismo producto. */
type TrackGroup = {
  tracks: TrackRecord[];
  /** Índice del grupo del que se sospecha que es duplicado, o null. */
  possibleDuplicateOfIndex: number | null;
};

/**
 * Agrupa tracks en productos únicos.
 *
 * Reglas de la especificación, aplicadas sobre `identityScore`:
 *   score ≥ strong            → fusión automática;
 *   possible ≤ score < strong → grupo aparte, MARCADO como posible duplicado;
 *   score < possible          → producto nuevo, sin relación.
 *
 * El umbral de fusión efectivo es `identityThreshold`; `strongIdentityThreshold`
 * distingue la fusión que además se considera segura. Entre `possible` y
 * `identity` se marca la sospecha sin fundir: fundir de más es peor que fundir
 * de menos, porque une dos productos reales en una ficha que ya no se puede
 * separar sin reprocesar.
 */
export function dedupTracksIntoProducts(
  state: JobRuntimeState,
  globalDedupEnabled: boolean,
  opts: {
    videoDurationSeconds: number;
    identityThreshold: number;
    strongIdentityThreshold: number;
    possibleDuplicateThreshold: number;
  } = {
    videoDurationSeconds: 60,
    identityThreshold: 0.84,
    strongIdentityThreshold: 0.9,
    possibleDuplicateThreshold: 0.76,
  }
): UniqueProductRecord[] {
  const tracks = Object.values(state.tracks).sort(
    (a, b) => a.firstSeenSeconds - b.firstSeenSeconds
  );
  const groups: TrackGroup[] = [];

  for (const track of tracks) {
    if (!globalDedupEnabled) {
      groups.push({ tracks: [track], possibleDuplicateOfIndex: null });
      continue;
    }

    // Mejor grupo candidato: el de mayor score entre los compatibles.
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < groups.length; i++) {
      for (const member of groups[i].tracks) {
        const breakdown = identityScore(member, track, {
          videoDurationSeconds: opts.videoDurationSeconds,
        });
        // Las puertas duras no se negocian: distinto slot o dos personas a la
        // vez ⇒ productos distintos, por mucho que se parezcan.
        if (breakdown.blockedBySlot || breakdown.blockedByPerson) continue;
        if (breakdown.score > bestScore) {
          bestScore = breakdown.score;
          bestIndex = i;
        }
      }
    }

    if (bestIndex >= 0 && bestScore >= opts.identityThreshold) {
      groups[bestIndex].tracks.push(track);
      continue;
    }
    groups.push({
      tracks: [track],
      possibleDuplicateOfIndex:
        bestIndex >= 0 && bestScore >= opts.possibleDuplicateThreshold
          ? bestIndex
          : null,
    });
  }

  return groups.map((group, i) => buildProduct(group, i, state));
}

/** Construye el registro de producto único a partir de su grupo de tracks. */
function buildProduct(
  group: TrackGroup,
  index: number,
  state: JobRuntimeState
): UniqueProductRecord {
  const best = group.tracks.reduce((acc, t) =>
    t.bestCrop.quality > acc.bestCrop.quality ? t : acc
  );
  const representative = group.tracks.reduce((acc, t) =>
    t.confidence > acc.confidence ? t : acc
  );
  const trackIds = group.tracks.map((t) => t.trackId);
  const appearances = state.appearances.filter((a) =>
    trackIds.includes(a.trackId)
  );
  const timestamps = appearances.map((a) => a.timestampSeconds);
  const sorted = [...timestamps].sort((a, b) => a - b);
  const sceneIds = [...new Set(appearances.map((a) => a.sceneId))].sort(
    (a, b) => a - b
  );
  const item = representative.representativeItem;

  return {
    productId: `p${index + 1}`,
    trackIds,
    item,
    bestCrop: best.bestCrop,
    segments: buildSegments(timestamps),
    matching: null,
    detection: null,
    matchStatus: "not_searched",
    matchAttempts: 0,
    matchError: null,
    matchDurationMs: 0,
    externalSearchesUsed: 0,
    possibleDuplicateOf:
      group.possibleDuplicateOfIndex != null
        ? `p${group.possibleDuplicateOfIndex + 1}`
        : null,
    matchProgress: "not_started",
    identity: {
      canonicalLabel: canonicalLabel(group.tracks.map((t) => t.name)),
      canonicalCategory: canonicalCategoryOf(item) ?? item.category,
      category: item.category,
      subcategory: item.subcategory ?? null,
      color: item.color ?? null,
      pattern: item.pattern ?? null,
      material: null,
      observedLabels: [...new Set(group.tracks.map((t) => t.name))],
      firstSeenAtMs: Math.round((sorted[0] ?? best.bestCrop.timestampSeconds) * 1000),
      lastSeenAtMs: Math.round(
        (sorted[sorted.length - 1] ?? best.bestCrop.timestampSeconds) * 1000
      ),
      timestampsMs: sorted.map((t) => Math.round(t * 1000)),
      seenCount: appearances.length,
      sceneIds,
    },
  };
}

/** Log por defecto: estructurado y con etapa, como pide la especificación. */
const defaultLog: NonNullable<JobEngineDeps["log"]> = (level, stage, message) => {
  const line = `[analysis-job] ${level.toUpperCase()} ${stage} ${message}`;
  if (level === "warn") console.warn(line);
  else console.info(line);
};

/**
 * Embeddings de los mejores crops, ANTES del dedup global.
 *
 * Es la señal principal de identidad, así que sin ella el dedup vuelve a
 * depender del hash perceptual y a partir productos. Se calculan en local
 * (CLIP), uno por track, en paralelo: ~35 ms cada uno con el modelo caliente.
 *
 * Ojo con la confusión fácil: estos NO son los embeddings del catálogo. Los
 * del catálogo están precalculados en la ingesta y nunca se generan durante
 * una búsqueda. Este es el del RECORTE, que por definición no existe hasta que
 * hay un recorte.
 */
async function embedBestCrops(
  state: JobRuntimeState,
  embedCrop: EmbedCropFn | undefined,
  log: NonNullable<JobEngineDeps["log"]>
): Promise<number> {
  if (!embedCrop) return 0;
  const pending = Object.values(state.tracks).filter(
    (t) => !t.bestCrop.embedding && (t.bestCrop.cropDataUrl ?? t.bestCrop.frameDataUrl)
  );
  if (!pending.length) return 0;

  const settled = await Promise.allSettled(
    pending.map(async (track) => {
      const image = track.bestCrop.cropDataUrl ?? track.bestCrop.frameDataUrl;
      if (!image) return;
      track.bestCrop.embedding = await embedCrop(image);
    })
  );
  const failed = settled.filter((r) => r.status === "rejected").length;
  const ok = pending.length - failed;
  if (failed > 0) {
    log("warn", "EMBED", `${failed}/${pending.length} embeddings de crop fallaron; esos tracks caen al hash perceptual`);
  }
  return ok;
}

/** `matchStatus` final → progreso EN VIVO terminal (ver `MatchProgressState`). */
function terminalMatchProgress(status: ProductMatchOutcome["status"]): MatchProgressState {
  switch (status) {
    case "catalog_matched":
      return "catalog_matched";
    case "external_candidate":
      return "review_required";
    case "not_searched":
      return "not_started";
    default:
      return "completed";
  }
}

export async function finalizeAnalysisJob(
  jobId: string,
  deps: JobEngineDeps
): Promise<
  | { ok: true; job: AnalysisJobRecord; products: UniqueProductRecord[] }
  | { ok: false; error: string; status: number }
> {
  const config = deps.config ?? getVideoAnalysisJobConfig(deps.env);
  const log = deps.log ?? defaultLog;
  const job = await deps.store.getJob(jobId);
  if (!job) return { ok: false, status: 404, error: "Job no encontrado." };
  if (job.finishedAt) {
    // Idempotente: un finalize repetido devuelve el resultado ya calculado.
    const products = await deps.store.getProducts(jobId);
    return { ok: true, job, products };
  }
  const state = await deps.store.getRuntimeState(jobId);
  if (!state) return { ok: false, status: 500, error: "Estado del job no disponible." };

  const cancelled = job.status === "cancelled";

  // 0) Cerrar la ÚLTIMA escena: nunca llega un "cambio de escena" que la
  // cierre porque no hay frame siguiente. Se rescata su pendiente si hace
  // falta para llegar al mínimo, igual que entre dos escenas cualquiera.
  const lastScene = state.scenes.at(-1) ?? null;
  if (lastScene) {
    const tracker = trackerFromState(state);
    const flushFrameMeta: FrameMetaEntry[] = [];
    await attemptSceneFlush({
      scene: lastScene,
      pending: state.pendingFlushFrame,
      job,
      state,
      tracker,
      config,
      deps,
      // Sin cliente al que pedir el crop real: se queda con el frame completo.
      cropRequests: [],
      frameMeta: flushFrameMeta,
      frameResults: [],
    });
    state.pendingFlushFrame = null;
    closeScene(lastScene, config);
    Object.assign(state, trackerToState(tracker));
    await deps.store.saveRuntimeState(jobId, state);
    if (flushFrameMeta.length) {
      await deps.store.recordFrames(jobId, flushFrameMeta).catch(() => undefined);
    }
  }

  // 1) Embeddings de los mejores crops (señal de identidad del dedup).
  const tEmbed = Date.now();
  const embedded = await embedBestCrops(state, deps.embedCrop, log);
  job.timings.cropEmbeddingMs = Date.now() - tEmbed;

  // 2) Dedup GLOBAL entre tracks → productos únicos.
  const tDedup = Date.now();
  const trackCount = Object.keys(state.tracks).length;
  const products = dedupTracksIntoProducts(state, config.globalDedupEnabled, {
    videoDurationSeconds: job.media.durationSeconds,
    identityThreshold: config.identityThreshold,
    strongIdentityThreshold: config.strongIdentityThreshold,
    possibleDuplicateThreshold: config.possibleDuplicateThreshold,
  });
  job.timings.dedupMs += Date.now() - tDedup;
  job.counters.uniqueProducts = products.length;
  job.counters.dedupMergedTracks = trackCount - products.length;
  job.counters.possibleDuplicates = products.filter(
    (p) => p.possibleDuplicateOf !== null
  ).length;
  log(
    "info",
    "GLOBAL_DEDUP",
    `${trackCount} tracks → ${products.length} productos únicos` +
      ` (${embedded} con embedding, ${job.counters.possibleDuplicates} posibles duplicados)`
  );

  // 2.5) Persistencia TEMPRANA: antes de pedir nada a los proveedores, para
  // que quien haga polling durante el matching vea productos reales (con
  // `matchProgress: "not_started"`) en vez de nada. `updateProductProgress`
  // solo puede actualizar una fila que ya existe.
  if (!cancelled && products.length > 0) {
    await deps.store.saveProducts(jobId, products);
  }

  // 3) Matching por PRODUCTO ÚNICO, con concurrencia y reintentos aislados.
  // Presupuesto agotado a nivel de producto: con el default (1) la primera
  // llamada es la única; con 0 el producto se resuelve solo contra catálogo.
  const mode: MatchingMode =
    config.maxExternalSearchesPerProduct <= 0 && job.matchingMode !== "catalog_only"
      ? "catalog_only"
      : job.matchingMode;

  const tMatch = Date.now();
  const outcomes = cancelled
    ? new Map<string, ProductMatchOutcome>()
    : await matchUniqueProducts({
        products,
        jobId,
        mediaContentId: job.media.id,
        mode,
        matchProduct: deps.matchProduct,
        config,
        onProgress: (done, total, outcome) => {
          log(
            outcome.status === "catalog_matched" ? "success" : "info",
            "MATCHING",
            `Producto ${done}/${total} · ${outcome.productId} · ${outcome.status}` +
              ` (${outcome.attempts} intento${outcome.attempts === 1 ? "" : "s"}, ${outcome.durationMs} ms)`
          );
        },
        onRetry: (productId, attempt, status) => {
          job.counters.matchingRetries++;
          log(
            "warn",
            "MATCHING",
            `${productId} · ${status} · reintento ${attempt}/${config.matchingMaxRetries}`
          );
        },
        onStage: (productId, stage) => {
          void deps.store.updateProductProgress(jobId, productId, stage).catch(() => undefined);
        },
      });
  job.timings.matchingMs += Date.now() - tMatch;

  // 4) Volcado de resultados a los productos + contadores.
  let unresolvedProducts = 0;
  for (const product of products) {
    const outcome = outcomes.get(product.productId);
    if (!outcome) {
      product.matchStatus = cancelled ? "not_searched" : "matching_error";
      product.matchError = cancelled ? "Job cancelado." : "Sin resultado de matching.";
      unresolvedProducts++;
      continue;
    }
    product.matching = outcome.result;
    product.detection = outcome.detection;
    product.matchStatus = outcome.status;
    product.matchAttempts = outcome.attempts;
    product.matchError = outcome.error;
    product.matchDurationMs = outcome.durationMs;
    if (outcome.externalSearchUsed) {
      product.externalSearchesUsed = 1;
      job.counters.externalSearchesUsed++;
    }
    if (outcome.cached) job.counters.cacheHits++;
    switch (outcome.status) {
      case "catalog_matched":
        job.counters.catalogHits++;
        break;
      case "external_candidate":
        job.counters.externalCandidates++;
        break;
      case "catalog_timeout":
        job.counters.catalogTimeouts++;
        unresolvedProducts++;
        break;
      case "external_timeout":
        job.counters.externalTimeouts++;
        unresolvedProducts++;
        break;
      case "no_match":
        break;
      default:
        unresolvedProducts++;
    }
    product.matchProgress = terminalMatchProgress(product.matchStatus);
  }

  // 4.5) Catálogo operativo/público. `product_matches` conserva el resultado
  // analítico del job; esta segunda escritura hace que cada producto único
  // aparezca también en /catalog con crop, estado y recomendaciones.
  if (!cancelled && products.length > 0 && deps.persistCatalogProducts) {
    try {
      const catalogPersistence = await deps.persistCatalogProducts(job, products);
      log(
        catalogPersistence.failed > 0 ? "warn" : "success",
        "CATALOG",
        `${catalogPersistence.saved}/${products.length} productos guardados en el catálogo público`
      );
      if (catalogPersistence.failed > 0) {
        job.warnings.push(
          `${catalogPersistence.failed} producto(s) no pudieron guardarse en el catálogo público.`
        );
      }
    } catch (error) {
      job.warnings.push(
        `No se pudo guardar el preprocesado en el catálogo público: ${
          error instanceof Error ? error.message : "error desconocido"
        }`
      );
    }
  }

  // 5) Cobertura temporal real (no "frames analizados") + validación de
  // integridad. Un job no puede llegar a `completed` en silencio si algo de
  // esto falla — se degrada a `partially_completed` con el motivo exacto.
  const coverage = computeTemporalCoverage({
    videoDurationMs: Math.round(job.media.durationSeconds * 1000),
    scenes: state.scenes,
    requireSceneCoverage: config.sceneCoverageRequired,
  });
  job.coverage = coverage;

  // Estado final honesto. Un producto sin resolver NO invalida el job: los
  // demás productos son resultados perfectamente utilizables.
  if (!cancelled) {
    job.status =
      unresolvedProducts > 0 || job.warnings.length > 0
        ? "partially_completed"
        : "completed";
  }

  const integrityErrors = cancelled
    ? []
    : validateProcessedVideoResult({
        job: {
          status: job.status,
          warnings: job.warnings,
          timings: job.timings,
          counters: job.counters,
          matchingMode: job.matchingMode,
        },
        scenes: state.scenes,
        products,
        coverage,
        externalSearchEnabled: getMatchingConfig(deps.env).externalSearchEnabled,
        unresolvedProducts,
      });
  job.integrityErrors = integrityErrors;
  if (!cancelled && integrityErrors.length > 0) job.status = "partially_completed";

  job.finishedAt = Date.now();
  job.media.processedAt = job.finishedAt;
  job.timings.totalMs = job.finishedAt - (job.startedAt ?? job.createdAt);

  await deps.store.saveProducts(jobId, products);
  await deps.store.updateJob(job);
  log(
    "info",
    "PERSIST",
    `${products.length} productos analíticos guardados · ${job.counters.catalogHits} coincidencias previas de catálogo` +
      ` · ${job.counters.externalCandidates} candidatos externos · cobertura ${coverage.coveragePercent}%` +
      ` · ${integrityErrors.length} error(es) de integridad · ${job.timings.totalMs} ms`
  );
  return { ok: true, job, products };
}

export async function cancelAnalysisJob(
  jobId: string,
  deps: JobEngineDeps
): Promise<{ ok: true; job: AnalysisJobRecord } | { ok: false; error: string; status: number }> {
  const job = await deps.store.getJob(jobId);
  if (!job) return { ok: false, status: 404, error: "Job no encontrado." };
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
    return { ok: true, job };
  }
  job.status = "cancelled";
  job.finishedAt = Date.now();
  job.timings.totalMs = job.finishedAt - (job.startedAt ?? job.createdAt);
  await deps.store.updateJob(job);
  return { ok: true, job };
}

// ---------------------------------------------------------------------------
// Vista de estado (GET /api/analysis/jobs/[id])
// ---------------------------------------------------------------------------

export async function getJobStatusView(
  jobId: string,
  deps: Pick<JobEngineDeps, "store">
): Promise<AnalysisJobStatusView | null> {
  const job = await deps.store.getJob(jobId);
  if (!job) return null;
  const state = await deps.store.getRuntimeState(jobId);
  const products = await deps.store.getProducts(jobId);
  const scenes: SceneRecord[] = state?.scenes ?? [];
  const tracks = Object.values(state?.tracks ?? {}).map((t) => ({
    trackId: t.trackId,
    category: t.category,
    name: t.name,
    firstSeenSeconds: t.firstSeenSeconds,
    lastSeenSeconds: t.lastSeenSeconds,
    seenFrameCount: t.seenFrameCount,
    confidence: t.confidence,
  }));
  // Los data URLs pesados NO viajan en el status (la UI ya tiene el vídeo).
  const lightProducts = products.map((p) => ({
    ...p,
    bestCrop: { ...p.bestCrop, frameDataUrl: null },
  }));
  return { ...job, scenes, tracks, products: lightProducts };
}

/** Apariciones crudas (debug/telemetría). */
export async function getJobAppearances(
  jobId: string,
  deps: Pick<JobEngineDeps, "store">
): Promise<AppearanceRecord[]> {
  const state = await deps.store.getRuntimeState(jobId);
  return state?.appearances ?? [];
}
