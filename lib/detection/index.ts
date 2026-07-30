import { CompositeDetector } from "./compositeDetector";
import { GroundingDinoDetector, YoloDetector } from "./pendingDetectors";
import { VisionModelDetector } from "./visionModelDetector";
import type { ObjectDetector } from "./types";

export * from "./types";
export { VisionModelDetector } from "./visionModelDetector";
export { GroundingDinoDetector, YoloDetector } from "./pendingDetectors";
export { CompositeDetector } from "./compositeDetector";

/**
 * Fábrica por configuración (OBJECT_DETECTOR). Un valor desconocido cae al
 * detector multimodal actual: nunca se rompe el análisis por un typo en env.
 *
 *   vision-model    → detector multimodal existente (default).
 *   yolo            → stub not_configured (pendiente de benchmark).
 *   grounding-dino  → stub not_configured (pendiente de benchmark).
 *   composite       → multimodal + Grounding DINO como fallback selectivo
 *                     (hoy degrada al principal porque DINO no está listo).
 */
export function getObjectDetector(
  name: string = process.env.OBJECT_DETECTOR?.trim() || "vision-model"
): ObjectDetector {
  switch (name) {
    case "yolo":
      return new YoloDetector();
    case "grounding-dino":
      return new GroundingDinoDetector();
    case "composite":
      return new CompositeDetector(
        new VisionModelDetector(),
        new GroundingDinoDetector()
      );
    case "vision-model":
      return new VisionModelDetector();
    default:
      console.warn(
        `[detection] OBJECT_DETECTOR="${name}" desconocido; se usa vision-model.`
      );
      return new VisionModelDetector();
  }
}
