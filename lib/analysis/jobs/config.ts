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
  };
}
