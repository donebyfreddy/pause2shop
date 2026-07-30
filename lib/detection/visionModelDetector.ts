import {
  analyzeWithOpenAI,
  mockAnalysis,
  normalizeAnalysis,
} from "@/lib/vision";
import { filterItemsByConfig } from "@/lib/analysis/categories";
import type {
  Detection,
  DetectorHealth,
  FrameInput,
  ObjectDetector,
} from "./types";

/**
 * Detector principal: envuelve la llamada multimodal EXISTENTE (lib/vision.ts,
 * la misma que usa analyze-frame) detrás de la interfaz ObjectDetector.
 *
 * Sin OPENAI_API_KEY cae al mock determinista — mismo "modo demo" que el
 * resto de la app: el pipeline del job se puede probar de punta a punta sin
 * pagar visión. El healthCheck lo declara como "degraded", nunca miente.
 */
export class VisionModelDetector implements ObjectDetector {
  readonly name = "vision-model";

  constructor(
    private readonly opts: {
      apiKey?: string | null;
      model?: string | null;
    } = {}
  ) {}

  private apiKey(): string | null {
    return this.opts.apiKey ?? process.env.OPENAI_API_KEY ?? null;
  }

  private model(): string {
    return this.opts.model ?? process.env.VISION_MODEL ?? "gpt-5-mini";
  }

  async detect(frame: FrameInput): Promise<Detection[]> {
    const apiKey = this.apiKey();
    if (!apiKey) {
      // Mock filtrado por la config del run (idéntico a analyzeFrameHandler).
      const analysis = normalizeAnalysis(mockAnalysis());
      return frame.analysisConfig
        ? filterItemsByConfig(analysis.items, frame.analysisConfig)
        : analysis.items;
    }
    const analysis = normalizeAnalysis(
      await analyzeWithOpenAI(frame.dataUrl, {
        apiKey,
        model: this.model(),
        config: frame.analysisConfig,
      })
    );
    return analysis.items;
  }

  async healthCheck(): Promise<DetectorHealth> {
    return this.apiKey()
      ? {
          detector: this.name,
          status: "ok",
          detail: `Modelo multimodal configurado (${this.model()}).`,
        }
      : {
          detector: this.name,
          status: "degraded",
          detail:
            "Sin OPENAI_API_KEY: las detecciones usan el mock determinista (modo demo).",
        };
  }
}
