import { randomUUID } from "node:crypto";
import { getMatchingConfig } from "@/lib/matching/config";
import { normalizeMatchingMode } from "@/lib/matching/types";
import type { MatchingMode, ProductMatchingResult } from "@/lib/matching/types";
import { parseConfig } from "@/lib/analysis/categories";
import {
  associateDetections,
  cropQualityScore,
  type TrackerState,
  type TrackedProduct,
} from "@/lib/video/tracker";
import type { ObjectDetector } from "@/lib/detection/types";
import type { DetectedItem } from "@/lib/types";
import {
  getVideoAnalysisJobConfig,
  type VideoAnalysisJobConfig,
} from "./config";
import {
  averageHash,
  decodeThumb,
  hammingDistance,
  sharpnessScore,
  thumbDiff,
  type DecodedThumb,
} from "./perceptualHash";
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
  JobRuntimeState,
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

/** Firma del matcher por producto único: el route inyecta la real. */
export type MatchProductFn = (args: {
  item: DetectedItem;
  cropDataUrl: string | null;
  frameDataUrl: string | null;
  mode: MatchingMode;
}) => Promise<ProductMatchingResult>;

export type JobEngineDeps = {
  store: AnalysisJobStore;
  detector: ObjectDetector;
  matchProduct: MatchProductFn;
  config?: VideoAnalysisJobConfig;
  env?: NodeJS.ProcessEnv;
};

/** Hamming máximo (sobre aHash de 64 bits) para "frame casi idéntico". */
const NEAR_DUP_HAMMING = 5;
/** Hamming máximo entre firmas de crop para fundir dos tracks (dedup global). */
const SIGNATURE_HAMMING = 12;
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
  return { ok: true };
}

function emptyRuntimeState(): JobRuntimeState {
  return {
    lastThumb: null,
    lastAnalyzedHash: null,
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
  | { ok: true; job: AnalysisJobRecord }
  | { ok: false; error: string; status: number }
> {
  const config = deps.config ?? getVideoAnalysisJobConfig(deps.env);
  const valid = validateCreateJobInput(input, config);
  if (!valid.ok) return valid;

  // Modo de matching: override del cliente (selector de la demo) → env.
  const mode: MatchingMode =
    normalizeMatchingMode(input.matchingMode) ??
    getMatchingConfig(deps.env ?? process.env).mode;

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
  };

  await deps.store.createJob(job, emptyRuntimeState());
  return { ok: true, job };
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
  const frameMeta: { timestampSeconds: number; analyzed: boolean; sceneId: number | null }[] = [];
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
      state.currentSceneId += 1;
      state.scenes.push({
        sceneId: state.currentSceneId,
        startSeconds: ts,
        endSeconds: ts,
        frameCount: 0,
      });
    }
    const scene = state.scenes[state.scenes.length - 1];

    // Hash perceptual: frame casi idéntico al último ANALIZADO ⇒ no se paga
    // detección. Un cambio de escena SIEMPRE se analiza.
    const hash = thumb ? averageHash(thumb) : null;
    job.timings.hashMs += Date.now() - tHash;
    const nearDuplicate =
      config.perceptualHashEnabled &&
      !sceneChanged &&
      hash !== null &&
      state.lastAnalyzedHash !== null &&
      hammingDistance(hash, state.lastAnalyzedHash) <= NEAR_DUP_HAMMING;

    state.lastThumb = frame.thumb ?? null;
    job.checkpoint.processedUpToSeconds = ts;
    scene.endSeconds = ts;
    scene.frameCount++;

    if (nearDuplicate) {
      skippedSimilar++;
      job.counters.framesSkippedSimilar++;
      frameMeta.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId });
      frameResults.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId, items: [] });
      continue;
    }

    // Detección SOLO en frames seleccionados.
    const tDetect = Date.now();
    let detections: DetectedItem[];
    try {
      detections = await deps.detector.detect({
        dataUrl: frame.dataUrl,
        timestampSeconds: ts,
        analysisConfig: job.analysisConfig,
      });
    } catch (err) {
      // Un frame fallido no tumba el job: warning y seguimos (el checkpoint
      // ya avanzó; el estado final podrá ser partially_completed).
      job.warnings.push(
        `Detección fallida en t=${ts.toFixed(2)}s: ${err instanceof Error ? err.message.slice(0, 160) : "error"}`
      );
      job.timings.detectionMs += Date.now() - tDetect;
      frameMeta.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId });
      frameResults.push({ timestampSeconds: ts, analyzed: false, sceneId: scene.sceneId, items: [] });
      continue;
    }
    job.timings.detectionMs += Date.now() - tDetect;
    analyzed++;
    job.counters.framesAnalyzed++;
    state.lastAnalyzedHash = hash;

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
      updateTrackRecord(state, det, ts, frame.dataUrl, thumb, config, cropRequests);
      state.appearances.push({
        trackId: det.trackId,
        timestampSeconds: ts,
        sceneId: scene.sceneId,
        box: det.bounding_box ?? null,
        confidence: det.confidence,
      });
    }
    job.timings.trackingMs += Date.now() - tTrack;

    frameMeta.push({ timestampSeconds: ts, analyzed: true, sceneId: scene.sceneId });
    frameResults.push({
      timestampSeconds: ts,
      analyzed: true,
      sceneId: scene.sceneId,
      items: withTracks,
    });
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
  // Calidad del encuadre: área × confianza (proxy existente del tracker) ×
  // nitidez aproximada de la región (un crop borroso no debe ganar).
  const sharpness = thumb ? sharpnessScore(thumb, det.bounding_box) : 0.5;
  const quality =
    cropQualityScore(det.bounding_box ?? null, det.confidence) *
    (0.7 + 0.3 * sharpness);

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
  // pedir un crop nuevo al cliente por mejoras marginales.
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

function normText(s?: string | null): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function shortName(name: string): string {
  return normText(name).split(/\s+/).slice(0, 3).join(" ");
}

/**
 * ¿Son dos tracks el MISMO objeto físico? El tracker por IoU no puede saberlo
 * cuando el objeto desaparece y reaparece (trackId nuevo), así que aquí se
 * compara la FIRMA del crop (aHash de la región) + atributos:
 *   misma categoría Y (firmas perceptuales cercanas O mismo nombre corto con
 *   mismo color). Nunca solo el tracker.
 */
export function sameProductSignature(a: TrackRecord, b: TrackRecord): boolean {
  if (normText(a.category) !== normText(b.category)) return false;
  const aHash = a.bestCrop.signatureHash;
  const bHash = b.bestCrop.signatureHash;
  if (aHash && bHash && hammingDistance(aHash, bHash) <= SIGNATURE_HAMMING) {
    return true;
  }
  const sameName = shortName(a.name) === shortName(b.name);
  const sameColor = normText(a.color) === normText(b.color);
  return sameName && sameColor;
}

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

/** Agrupa tracks en productos únicos (sin matching todavía). */
export function dedupTracksIntoProducts(
  state: JobRuntimeState,
  globalDedupEnabled: boolean
): UniqueProductRecord[] {
  const tracks = Object.values(state.tracks).sort(
    (a, b) => a.firstSeenSeconds - b.firstSeenSeconds
  );
  const groups: TrackRecord[][] = [];
  for (const track of tracks) {
    const group = globalDedupEnabled
      ? groups.find((g) => g.some((t) => sameProductSignature(t, track)))
      : undefined;
    if (group) group.push(track);
    else groups.push([track]);
  }

  return groups.map((group, i) => {
    const best = group.reduce((acc, t) =>
      t.bestCrop.quality > acc.bestCrop.quality ? t : acc
    );
    const representative = group.reduce((acc, t) =>
      t.confidence > acc.confidence ? t : acc
    );
    const trackIds = group.map((t) => t.trackId);
    const timestamps = state.appearances
      .filter((a) => trackIds.includes(a.trackId))
      .map((a) => a.timestampSeconds);
    return {
      productId: `p${i + 1}`,
      trackIds,
      item: representative.representativeItem,
      bestCrop: best.bestCrop,
      segments: buildSegments(timestamps),
      matching: null,
      externalSearchesUsed: 0,
      matchingSkippedReason: null,
    };
  });
}

/** ¿El resultado de matching consumió una búsqueda externa de verdad? */
function usedExternalSearch(result: ProductMatchingResult): boolean {
  if (result.cached) return false;
  if (result.providerUsed === null || result.providerUsed === "catalog") return false;
  if (result.providerUsed === "cache") return false;
  return true;
}

export async function finalizeAnalysisJob(
  jobId: string,
  deps: JobEngineDeps
): Promise<
  | { ok: true; job: AnalysisJobRecord; products: UniqueProductRecord[] }
  | { ok: false; error: string; status: number }
> {
  const config = deps.config ?? getVideoAnalysisJobConfig(deps.env);
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

  // 1) Dedup global entre tracks → productos únicos.
  const tDedup = Date.now();
  const products = dedupTracksIntoProducts(state, config.globalDedupEnabled);
  job.timings.dedupMs += Date.now() - tDedup;
  job.counters.uniqueProducts = products.length;
  job.counters.dedupMergedTracks =
    Object.keys(state.tracks).length - products.length;

  // 2) Matching por PRODUCTO ÚNICO con su mejor crop. Operación cara: una
  // sola llamada por producto (cada llamada consume ≤1 búsqueda externa) y
  // nunca más de MAX_EXTERNAL_SEARCHES_PER_PRODUCT externas por producto.
  let matchingFailures = 0;
  const tMatch = Date.now();
  for (const product of products) {
    if (cancelled) {
      product.matchingSkippedReason = "job_cancelled";
      continue;
    }
    // Presupuesto agotado a nivel de producto: con el default (1) la primera
    // llamada es la única; con 0 el producto se resuelve solo contra catálogo.
    const mode: MatchingMode =
      config.maxExternalSearchesPerProduct <= 0 &&
      job.matchingMode !== "catalog_only"
        ? "catalog_only"
        : job.matchingMode;
    try {
      const result = await deps.matchProduct({
        item: product.item,
        cropDataUrl: product.bestCrop.cropDataUrl,
        frameDataUrl: product.bestCrop.frameDataUrl,
        mode,
      });
      product.matching = result;
      if (usedExternalSearch(result)) {
        product.externalSearchesUsed = 1;
        job.counters.externalSearchesUsed++;
      }
      if (result.cached) job.counters.cacheHits++;
      if (result.matchLabel === "CATALOG_MATCH") job.counters.catalogHits++;
    } catch (err) {
      matchingFailures++;
      product.matchingSkippedReason =
        err instanceof Error ? err.message.slice(0, 200) : "matching_error";
    }
  }
  job.timings.matchingMs += Date.now() - tMatch;

  // 3) Estado final honesto.
  if (!cancelled) {
    job.status =
      matchingFailures > 0 || job.warnings.length > 0
        ? "partially_completed"
        : "completed";
  }
  job.finishedAt = Date.now();
  job.timings.totalMs = job.finishedAt - (job.startedAt ?? job.createdAt);

  await deps.store.saveProducts(jobId, products);
  await deps.store.updateJob(job);
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
