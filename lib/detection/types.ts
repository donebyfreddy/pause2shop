import type { DetectedItem, VideoAnalysisConfig } from "@/lib/types";

/**
 * Detector de objetos DESACOPLADO del modelo concreto.
 *
 * Hoy el único detector real es el modelo multimodal existente
 * (VisionModelDetector envuelve lib/vision.ts). YOLO y Grounding DINO quedan
 * como implementaciones preparadas que declaran honestamente `not_configured`
 * hasta que se haga el benchmark (ver IMPLEMENTATION_AUDIT.md, decisión 4):
 * la interfaz permite cambiarlos por env sin tocar el motor de análisis.
 */

export type FrameInput = {
  /** Frame como data URL (data:image/jpeg;base64,...). */
  dataUrl: string;
  /** Timestamp del frame dentro del vídeo (segundos). */
  timestampSeconds: number;
  /** Config del run (categorías/intensidad) elegida por el usuario. */
  analysisConfig?: VideoAnalysisConfig;
};

/** Una detección es un DetectedItem: mismo contrato que el resto de la app. */
export type Detection = DetectedItem;

export type DetectorHealth = {
  detector: string;
  status: "ok" | "degraded" | "not_configured";
  detail: string;
};

export interface ObjectDetector {
  /** Nombre estable del detector (para logs/health/timings). */
  readonly name: string;
  detect(frame: FrameInput): Promise<Detection[]>;
  healthCheck(): Promise<DetectorHealth>;
}

/** Error tipado para detectores aún no configurados (YOLO/DINO). */
export class DetectorNotConfiguredError extends Error {
  readonly code = "not_configured";
  constructor(detector: string, detail: string) {
    super(`Detector "${detector}" no configurado: ${detail}`);
    this.name = "DetectorNotConfiguredError";
  }
}
