import {
  DetectorNotConfiguredError,
  type Detection,
  type DetectorHealth,
  type FrameInput,
  type ObjectDetector,
} from "./types";

/**
 * Detectores PREPARADOS pero pendientes de benchmark (IMPLEMENTATION_AUDIT,
 * decisión 4): la interfaz existe para poder enchufarlos por env sin tocar el
 * motor, pero hoy no hay pesos ni runtime desplegado. Lanzan `not_configured`
 * y su healthCheck es honesto — nunca simulan detecciones.
 *
 * Plan pendiente:
 *  - YOLO (p. ej. yolov8/11 vía ONNX Runtime): rápido, clases COCO limitadas.
 *  - Grounding DINO: open-vocabulary (detecta "reloj de pulsera plateado"),
 *    más lento; candidato a fallback selectivo del CompositeDetector para
 *    categorías que el principal cubre mal.
 * Antes de activarlos: benchmark de precisión/latencia/coste contra el
 * detector multimodal actual con los mismos vídeos de la demo.
 */

const YOLO_DETAIL =
  "Pendiente de benchmark: falta runtime ONNX + pesos (YOLO_MODEL_PATH). " +
  "Ver lib/detection/README de la feature.";

export class YoloDetector implements ObjectDetector {
  readonly name = "yolo";

  async detect(_frame: FrameInput): Promise<Detection[]> {
    throw new DetectorNotConfiguredError(this.name, YOLO_DETAIL);
  }

  async healthCheck(): Promise<DetectorHealth> {
    return { detector: this.name, status: "not_configured", detail: YOLO_DETAIL };
  }
}

const DINO_DETAIL =
  "Pendiente de benchmark: falta endpoint/pesos de Grounding DINO " +
  "(GROUNDING_DINO_URL). Ver lib/detection/README de la feature.";

export class GroundingDinoDetector implements ObjectDetector {
  readonly name = "grounding-dino";

  async detect(_frame: FrameInput): Promise<Detection[]> {
    throw new DetectorNotConfiguredError(this.name, DINO_DETAIL);
  }

  async healthCheck(): Promise<DetectorHealth> {
    return { detector: this.name, status: "not_configured", detail: DINO_DETAIL };
  }
}
