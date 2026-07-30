import { isCategoryAllowed } from "@/lib/analysis/categories";
import { DetectorNotConfiguredError } from "./types";
import type {
  Detection,
  DetectorHealth,
  FrameInput,
  ObjectDetector,
} from "./types";

/**
 * Detector compuesto: principal + fallback SELECTIVO.
 *
 * El fallback NO corre siempre (sería pagar dos detectores por frame): solo
 * cuando el principal deja el frame "dudoso" —
 *   a) ninguna detección, o
 *   b) todas por debajo de `lowConfidence`, o
 *   c) el usuario pidió categorías que el principal no devolvió en absoluto.
 * Las detecciones del fallback se añaden solo si no duplican una del
 * principal (misma categoría normalizada). Si el fallback está
 * `not_configured` (YOLO/DINO hoy) se degrada en silencio al principal.
 */
export class CompositeDetector implements ObjectDetector {
  readonly name: string;

  constructor(
    private readonly primary: ObjectDetector,
    private readonly fallback: ObjectDetector,
    private readonly opts: { lowConfidence?: number } = {}
  ) {
    this.name = `composite(${primary.name}+${fallback.name})`;
  }

  private needsFallback(frame: FrameInput, primary: Detection[]): boolean {
    if (primary.length === 0) return true;
    const low = this.opts.lowConfidence ?? 0.45;
    if (primary.every((d) => d.confidence < low)) return true;
    // Categorías pedidas y no cubiertas: si el usuario seleccionó categorías
    // concretas y el principal no devolvió NINGUNA de alguna de ellas.
    const cats = frame.analysisConfig?.categories;
    if (cats && !cats.includes("all")) {
      return cats.some(
        (cat) => !primary.some((d) => isCategoryAllowed(d, [cat]))
      );
    }
    return false;
  }

  async detect(frame: FrameInput): Promise<Detection[]> {
    const primary = await this.primary.detect(frame);
    if (!this.needsFallback(frame, primary)) return primary;

    let extra: Detection[] = [];
    try {
      extra = await this.fallback.detect(frame);
    } catch (err) {
      // Fallback sin configurar o caído: el principal manda, sin romper.
      if (!(err instanceof DetectorNotConfiguredError)) {
        console.warn("[detection] fallback_failed", {
          fallback: this.fallback.name,
          error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        });
      }
      return primary;
    }

    const norm = (s: string) => s.trim().toLowerCase();
    const seen = new Set(primary.map((d) => norm(d.category)));
    return [...primary, ...extra.filter((d) => !seen.has(norm(d.category)))];
  }

  async healthCheck(): Promise<DetectorHealth> {
    const [p, f] = await Promise.all([
      this.primary.healthCheck(),
      this.fallback.healthCheck(),
    ]);
    return {
      detector: this.name,
      status: p.status,
      detail: `principal: ${p.detail} | fallback: ${f.detail}`,
    };
  }
}
