/**
 * Configuración del análisis asíncrono de vídeo (jobs). Todas las variables
 * tienen default seguro: sin .env la demo funciona con los valores de la spec.
 * Se lee bajo demanda (función, no constantes de módulo) para que los tests
 * puedan inyectar env y para que un cambio de env no exija rebuild.
 */

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

/** Entero >= 0 (a diferencia de `num`, admite el 0 como valor válido). */
function intOrZero(v: string | undefined, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type VideoAnalysisJobConfig = {
  /** Duración máxima del vídeo aceptado (segundos). Default demo: 120. */
  maxVideoDurationSeconds: number;
  /** FPS a los que el cliente extrae frames candidatos. */
  detectionFps: number;
  /** Detección de cambio de escena (diff perceptual alto ⇒ escena nueva). */
  sceneDetectionEnabled: boolean;
  /** Descarte de frames casi idénticos por hash perceptual. */
  perceptualHashEnabled: boolean;
  /** Tracking server-side entre frames analizados. */
  trackingEnabled: boolean;
  /** Fusión GLOBAL de tracks que son el mismo objeto (reaparición). */
  globalDedupEnabled: boolean;
  /** Mejora mínima relativa para sustituir el mejor crop de un track. */
  bestCropImprovementThreshold: number;
  /** Búsquedas externas (caras) máximas por PRODUCTO ÚNICO. */
  maxExternalSearchesPerProduct: number;
  /** Detector activo (lib/detection): vision-model | yolo | grounding-dino. */
  objectDetector: string;
  /** Techo de tamaño del vídeo aceptado en la creación del job (bytes). */
  maxVideoSizeBytes: number;
  /** Umbral de diff perceptual (0-1) por debajo del cual un frame se descarta. */
  nearDuplicateDiffThreshold: number;
  /** Umbral de diff perceptual (0-1) a partir del cual se abre escena nueva. */
  sceneDiffThreshold: number;

  /* --- sampling adaptativo por escena --- */
  /** Frames analizados mínimos por escena, aunque sean casi idénticos. */
  minFramesPerScene: number;
  /** Techo de frames analizados por escena, protege el detector de vídeos estáticos largos. */
  maxFramesPerScene: number;
  /** Gap máximo (ms de vídeo) sin analizar antes de forzar un frame. */
  sampleIntervalMs: number;
  /** Hamming máximo (aHash 8×8) para considerar dos frames "casi idénticos". */
  phashDedupThreshold: number;
  /** Si una escena termina con 0 frames analizados, es un fallo de integridad. */
  sceneCoverageRequired: boolean;

  /* --- identidad global de producto (dedup entre tracks) --- */
  /** Por encima de este score, dos tracks son el mismo producto. */
  identityThreshold: number;
  /** Por encima de este, la fusión es automática y no se marca para revisión. */
  strongIdentityThreshold: number;
  /** Entre este y el fuerte, se marca `possible_duplicate` en vez de fundir. */
  possibleDuplicateThreshold: number;

  /* --- matching por producto único --- */
  /** Productos resueltos a la vez. */
  matchingMaxConcurrency: number;
  /** Reintentos ADICIONALES tras un fallo transitorio. */
  matchingMaxRetries: number;
  /** Espera base entre reintentos (crece exponencialmente). */
  matchingRetryBackoffMs: number;
};

export function getVideoAnalysisJobConfig(
  env: NodeJS.ProcessEnv = process.env
): VideoAnalysisJobConfig {
  return {
    maxVideoDurationSeconds: num(env.MAX_VIDEO_DURATION_SECONDS, 120),
    detectionFps: num(env.VIDEO_DETECTION_FPS, 5),
    sceneDetectionEnabled: bool(env.VIDEO_SCENE_DETECTION_ENABLED, true),
    perceptualHashEnabled: bool(env.VIDEO_PERCEPTUAL_HASH_ENABLED, true),
    trackingEnabled: bool(env.VIDEO_TRACKING_ENABLED, true),
    globalDedupEnabled: bool(env.VIDEO_GLOBAL_DEDUP_ENABLED, true),
    bestCropImprovementThreshold: num(
      env.VIDEO_BEST_CROP_IMPROVEMENT_THRESHOLD,
      0.15
    ),
    maxExternalSearchesPerProduct: Math.floor(
      num(env.MAX_EXTERNAL_SEARCHES_PER_PRODUCT, 1)
    ),
    objectDetector: env.OBJECT_DETECTOR?.trim() || "vision-model",
    // 2 min a 1280px JPEG deja los frames en el cliente; aquí solo viaja
    // metadata + frames por lotes, pero validamos el fichero declarado.
    maxVideoSizeBytes: num(env.MAX_VIDEO_SIZE_BYTES, 500 * 1024 * 1024),
    // Mismo umbral por defecto que el capture engine del cliente (0.10 para
    // escena); por debajo de 0.02 dos frames se consideran casi idénticos.
    nearDuplicateDiffThreshold: num(env.VIDEO_NEAR_DUPLICATE_DIFF, 0.02),
    sceneDiffThreshold: num(
      env.SCENE_DIFF_THRESHOLD ?? env.NEXT_PUBLIC_SCENE_DIFF_THRESHOLD,
      0.1
    ),
    minFramesPerScene: Math.max(1, Math.floor(num(env.VIDEO_MIN_FRAMES_PER_SCENE, 2))),
    maxFramesPerScene: Math.max(1, Math.floor(num(env.VIDEO_MAX_FRAMES_PER_SCENE, 8))),
    sampleIntervalMs: num(env.VIDEO_SAMPLE_INTERVAL_MS, 1000),
    phashDedupThreshold: intOrZero(env.VIDEO_PHASH_DEDUP_THRESHOLD, 6),
    sceneCoverageRequired: bool(env.VIDEO_SCENE_COVERAGE_REQUIRED, true),
    identityThreshold: num(env.VIDEO_PRODUCT_IDENTITY_THRESHOLD, 0.84),
    strongIdentityThreshold: num(env.VIDEO_PRODUCT_STRONG_IDENTITY_THRESHOLD, 0.9),
    possibleDuplicateThreshold: num(
      env.VIDEO_PRODUCT_POSSIBLE_DUPLICATE_THRESHOLD,
      0.76
    ),
    matchingMaxConcurrency: Math.floor(num(env.MATCHING_MAX_CONCURRENCY, 3)),
    // `num` descarta 0 y negativos, así que 0 reintentos hay que leerlo aparte:
    // "sin reintentos" es una configuración legítima, no un valor inválido.
    matchingMaxRetries: intOrZero(env.MATCHING_MAX_RETRIES, 2),
    matchingRetryBackoffMs: num(env.MATCHING_RETRY_BACKOFF_MS, 1000),
  };
}
