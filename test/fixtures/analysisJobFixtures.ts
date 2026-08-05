import type { Detection, DetectorHealth, FrameInput, ObjectDetector } from "../../lib/detection/types";
import type {
  DetectionMatchResult,
  ProductMatchingResult,
} from "../../lib/matching/types";
import type { DetectedItem } from "../../lib/types";
import type { VideoAnalysisJobConfig } from "../../lib/analysis/jobs/config";
import { encodeThumb, type RawThumb } from "../../lib/analysis/jobs/perceptualHash";
import { InMemoryAnalysisJobStore } from "../../lib/analysis/jobs/store";
import type { JobEngineDeps, MatchProductFn } from "../../lib/analysis/jobs/engine";
import type { FramePayload } from "../../lib/analysis/jobs/types";

/**
 * Fixtures del motor de jobs: detector con guion por timestamp, matcher falso
 * con contador de llamadas y thumbs sintéticos. Sin red, sin OpenAI.
 */

export const TEST_JOB_CONFIG: VideoAnalysisJobConfig = {
  maxVideoDurationSeconds: 120,
  detectionFps: 5,
  sceneDetectionEnabled: true,
  perceptualHashEnabled: true,
  trackingEnabled: true,
  globalDedupEnabled: true,
  bestCropImprovementThreshold: 0.15,
  maxExternalSearchesPerProduct: 1,
  objectDetector: "fake",
  maxVideoSizeBytes: 500 * 1024 * 1024,
  nearDuplicateDiffThreshold: 0.02,
  sceneDiffThreshold: 0.1,
  // Igual al `NEAR_DUP_HAMMING` que sustituyó este umbral: los tests
  // existentes se escribieron contra ese valor concreto. `minFramesPerScene`
  // se fija a 1 (el mínimo posible) para no interferir con esos tests — los
  // que SÍ prueban el mínimo por escena pasan su propia config con un valor
  // mayor.
  minFramesPerScene: 1,
  maxFramesPerScene: 8,
  sampleIntervalMs: 1000,
  phashDedupThreshold: 5,
  sceneCoverageRequired: true,
  identityThreshold: 0.84,
  strongIdentityThreshold: 0.9,
  possibleDuplicateThreshold: 0.76,
  matchingMaxConcurrency: 3,
  // Los tests que NO prueban reintentos no deben pagarlos: el backoff haría
  // que cada fallo esperado durase segundos. Los que sí los prueban pasan su
  // propia config.
  matchingMaxRetries: 0,
  matchingRetryBackoffMs: 1,
};

export function item(partial: Partial<DetectedItem> & { name: string }): DetectedItem {
  return {
    category: "general",
    description: "",
    search_query_es: partial.name,
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.8,
    bounding_box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    ...partial,
  };
}

/** Detector con guion: timestamp (3 decimales) → detecciones. */
export class ScriptedDetector implements ObjectDetector {
  readonly name = "fake";
  readonly calls: number[] = [];

  constructor(private readonly script: Record<string, Detection[]>) {}

  async detect(frame: FrameInput): Promise<Detection[]> {
    this.calls.push(frame.timestampSeconds);
    return this.script[frame.timestampSeconds.toFixed(3)] ?? [];
  }

  async healthCheck(): Promise<DetectorHealth> {
    return { detector: this.name, status: "ok", detail: "fake" };
  }
}

export type MatchCall = {
  itemName: string;
  cropDataUrl: string | null;
  frameDataUrl: string | null;
  mode: string;
};

/**
 * Bloques de detección coherentes con un resultado externo fiable. El motor
 * deriva el estado del producto de AQUÍ, no de `matchLabel`, así que los
 * fixtures tienen que producirlos.
 */
export function detectionFor(
  it: DetectedItem,
  opts: {
    catalog?: "matched" | "unresolved" | "empty" | "error" | "timeout" | "not_requested";
    external?: "matched" | "unresolved" | "not_requested" | "disabled" | "error" | "timeout";
  } = {}
): DetectionMatchResult {
  const catalog = opts.catalog ?? "unresolved";
  const external = opts.external ?? "matched";
  const candidate = {
    id: `c:${it.name}`,
    title: `match de ${it.name}`,
    brand: null,
    imageUrl: null,
    price: 19.99,
    currency: "EUR",
    productUrl: "https://example.com/p",
    category: null,
    color: null,
    score: 0.9,
    matchType: "probable" as const,
    isDemoProduct: false,
    merchant: "example",
    evidence: [],
  };
  return {
    detectionId: it.name,
    label: it.name,
    confidence: it.confidence,
    boundingBox: it.bounding_box ?? null,
    timestampSeconds: null,
    catalog: {
      status: catalog,
      candidates: [],
      threshold: 0.8,
      ...(catalog === "matched"
        ? { selected: { ...candidate, source: "catalog" as const } }
        : {}),
    },
    external: {
      status: external,
      candidates: [],
      threshold: 0.72,
      ...(external === "matched"
        ? { selected: { ...candidate, source: "external" as const } }
        : {}),
    },
    matchingMode: "catalog_first",
  };
}

/** Matcher falso: registra llamadas y devuelve un EXTERNAL_MATCH fijo. */
export function fakeMatcher(
  calls: MatchCall[],
  result?: Partial<ProductMatchingResult>,
  detection?: (it: DetectedItem) => DetectionMatchResult
): MatchProductFn {
  return async ({ item: it, cropDataUrl, frameDataUrl, mode }) => {
    calls.push({ itemName: it.name, cropDataUrl, frameDataUrl, mode });
    const built: ProductMatchingResult = {
      matches: [
        {
          source: "external",
          productId: null,
          title: `match de ${it.name}`,
          brand: null,
          imageUrl: null,
          productUrl: "https://example.com/p",
          price: 19.99,
          currency: "EUR",
          merchant: "example",
          category: null,
          model: null,
          matchType: "probable" as const,
          availability: "unknown",
          matchStage: null,
          provider: "searchapi_google_lens",
          scores: {
            detectionScore: it.confidence,
            visualScore: 0.9,
            textScore: null,
            attributeScore: null,
            brandEvidenceScore: null,
            merchantScore: null,
            finalScore: 0.9,
          },
          evidence: [],
        },
      ],
      matchLabel: "EXTERNAL_MATCH",
      providerUsed: "searchapi_google_lens",
      fallbackUsed: false,
      cached: false,
      timings: {},
      ...result,
    };
    return {
      result: built,
      detection: (detection ?? ((x: DetectedItem) => detectionFor(x)))(it),
    };
  };
}

export function makeDeps(
  detector: ObjectDetector,
  matchProduct: MatchProductFn,
  config: VideoAnalysisJobConfig = TEST_JOB_CONFIG
): JobEngineDeps & { store: InMemoryAnalysisJobStore } {
  return {
    store: new InMemoryAnalysisJobStore(),
    detector,
    matchProduct,
    config,
    env: {} as NodeJS.ProcessEnv,
  };
}

// ---------------------------------------------------------------------------
// Thumbs sintéticos (64×36 RGB)
// ---------------------------------------------------------------------------

export const TW = 64;
export const TH = 36;

/**
 * Thumb pintado por función (x,y) → [r,g,b]. Con `background` se controla el
 * diff global (escenas) sin tocar la firma de la región del producto.
 */
export function paintThumb(
  painter: (x: number, y: number) => [number, number, number]
): RawThumb {
  const rgb = new Uint8Array(TW * TH * 3);
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const [r, g, b] = painter(x, y);
      const i = (y * TW + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return encodeThumb(TW, TH, rgb);
}

type Region = { x: number; y: number; width: number; height: number };

function inRegion(x: number, y: number, r: Region): boolean {
  return (
    x >= r.x * TW &&
    x < (r.x + r.width) * TW &&
    y >= r.y * TH &&
    y < (r.y + r.height) * TH
  );
}

/**
 * Thumb con fondo uniforme y un "producto" con gradiente en una región:
 *  - gradiente horizontal ⇒ firma A, vertical ⇒ firma B (hamming alto).
 *  - cambiar `background` cambia la ESCENA sin cambiar la firma de la región.
 */
export function productThumb(
  background: number,
  regions: Array<{ region: Region; gradient: "h" | "v" }>
): RawThumb {
  return paintThumb((x, y) => {
    for (const { region, gradient } of regions) {
      if (inRegion(x, y, region)) {
        const relX = (x - region.x * TW) / Math.max(1, region.width * TW);
        const relY = (y - region.y * TH) / Math.max(1, region.height * TH);
        const v = Math.round(255 * (gradient === "h" ? relX : relY));
        return [v, v, v];
      }
    }
    return [background, background, background];
  });
}

export function frame(
  timestampSeconds: number,
  thumb: RawThumb | undefined,
  label = "frame"
): FramePayload {
  return {
    timestampSeconds,
    // El motor no decodifica el JPEG: basta un data URL sintáctico válido.
    dataUrl: `data:image/jpeg;base64,${Buffer.from(`${label}@${timestampSeconds}`).toString("base64")}`,
    thumb,
  };
}
