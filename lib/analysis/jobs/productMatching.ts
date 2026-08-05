import type { DetectionMatchResult } from "@/lib/matching/types";
import type { MatchingMode, ProductMatchingResult } from "@/lib/matching/types";
import type { DetectedItem } from "@/lib/types";
import type { VideoAnalysisJobConfig } from "./config";
import {
  RETRYABLE_MATCH_STATUSES,
  type MatchProgressState,
  type ProductMatchStatus,
  type UniqueProductRecord,
} from "./types";

/**
 * MATCHING POR PRODUCTO ÚNICO.
 *
 * Tres cosas que antes no se hacían y que causaban el fallo observado
 * (10 productos, 101 s de matching, 0 hits de catálogo, varios "matching
 * omitido: The operation was aborted due to timeout"):
 *
 *  1. Los productos se resolvían EN SERIE. Diez productos eran diez esperas
 *     encadenadas. Ahora van en tandas de `MATCHING_MAX_CONCURRENCY`.
 *  2. El presupuesto de tiempo se aplicaba con un `AbortSignal` a la petición
 *     ENTERA, así que al saltar se perdía también el resultado del catálogo
 *     que ya estaba calculado. Ahora el reloj está DENTRO del resolver, por
 *     fuente (`lib/matching/resolveDetection.ts`), y agotarlo produce un
 *     estado, no una excepción.
 *  3. Cualquier fallo se convertía en un string pegado a la tarjeta. Ahora hay
 *     una taxonomía (`ProductMatchStatus`) que distingue lo reintentable de lo
 *     definitivo, y los transitorios se reintentan con backoff.
 *
 * Un producto que falla NO afecta a los demás: cada uno se resuelve aislado y
 * se recogen todos los resultados con `Promise.allSettled`.
 */

/** Lo que necesita el orquestador para resolver un producto. */
export type MatchProductFn = (args: {
  jobId: string;
  mediaContentId: string;
  globalProductId: string;
  item: DetectedItem;
  cropDataUrl: string | null;
  frameDataUrl: string | null;
  mode: MatchingMode;
  attempt: number;
  /** Progreso EN VIVO del resolver (embedding/catálogo/externo), no el resultado final. */
  onStage?: (stage: MatchProgressState) => void;
}) => Promise<{
  result: ProductMatchingResult;
  detection: DetectionMatchResult | null;
}>;

export type ProductMatchOutcome = {
  productId: string;
  status: ProductMatchStatus;
  result: ProductMatchingResult | null;
  detection: DetectionMatchResult | null;
  attempts: number;
  error: string | null;
  durationMs: number;
  externalSearchUsed: boolean;
  cached: boolean;
};

/**
 * Estado a partir de los DOS bloques del resolver.
 *
 * El orden importa: primero lo que resolvió, luego lo que falló. Un producto
 * cuyo catálogo dio timeout pero cuya búsqueda externa encontró un candidato
 * es `external_candidate` con un aviso, no `catalog_timeout` — para quien mira
 * la pantalla, lo relevante es que HAY resultado.
 */
export function statusFromDetection(
  detection: DetectionMatchResult | null
): ProductMatchStatus {
  if (!detection) return "matching_error";
  const { catalog, external } = detection;

  if (catalog.status === "matched") return "catalog_matched";
  if (external.status === "matched") return "external_candidate";

  // Sin resolución: manda el motivo del fallo, y el del catálogo primero
  // porque es la fuente principal.
  if (catalog.status === "timeout") return "catalog_timeout";
  if (external.status === "timeout") return "external_timeout";
  if (catalog.status === "error") {
    // Si el externo llegó a responder algo, el resultado es parcial: se
    // consultó una fuente de dos. Decir "no hay coincidencia" sería mentir
    // sobre la cobertura de la búsqueda.
    return external.status === "unresolved" ? "partial_result" : "matching_error";
  }
  if (external.status === "error") return "partial_result";

  // Ambas fuentes contestaron y ninguna encontró nada. Esto sí es definitivo.
  return "no_match";
}

/** ¿El resultado consumió una búsqueda externa de verdad (no caché)? */
export function usedExternalSearch(result: ProductMatchingResult): boolean {
  if (result.cached) return false;
  const provider = result.providerUsed;
  if (provider === null || provider === "catalog" || provider === "cache") {
    return false;
  }
  return true;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resuelve UN producto, con reintentos para los fallos transitorios.
 *
 * No reintenta un `no_match`: el catálogo no va a cambiar de opinión en un
 * segundo, y pagar tres búsquedas externas por un producto que no existe es
 * exactamente el gasto que este pipeline debe evitar.
 */
export async function matchOneProduct(args: {
  product: UniqueProductRecord;
  jobId: string;
  mediaContentId: string;
  mode: MatchingMode;
  matchProduct: MatchProductFn;
  config: VideoAnalysisJobConfig;
  signal?: { aborted: boolean };
  onRetry?: (productId: string, attempt: number, status: ProductMatchStatus) => void;
  onStage?: (stage: MatchProgressState) => void;
}): Promise<ProductMatchOutcome> {
  const { product, jobId, mediaContentId, mode, matchProduct, config } = args;
  const started = Date.now();

  const crop = product.bestCrop.cropDataUrl ?? product.bestCrop.frameDataUrl;
  if (!crop) {
    return {
      productId: product.productId,
      status: "not_searched",
      result: null,
      detection: null,
      attempts: 0,
      error: "Sin crop ni frame utilizable.",
      durationMs: 0,
      externalSearchUsed: false,
      cached: false,
    };
  }

  let attempts = 0;
  let lastError: string | null = null;
  let last: ProductMatchOutcome | null = null;

  const maxAttempts = config.matchingMaxRetries + 1;
  while (attempts < maxAttempts) {
    if (args.signal?.aborted) {
      return {
        productId: product.productId,
        status: "not_searched",
        result: null,
        detection: null,
        attempts,
        error: "Job cancelado.",
        durationMs: Date.now() - started,
        externalSearchUsed: false,
        cached: false,
      };
    }
    attempts++;
    args.onStage?.("embedding");
    try {
      const { result, detection } = await matchProduct({
        jobId,
        mediaContentId,
        globalProductId: product.productId,
        item: product.item,
        cropDataUrl: product.bestCrop.cropDataUrl,
        frameDataUrl: product.bestCrop.frameDataUrl,
        mode,
        attempt: attempts,
        onStage: args.onStage,
      });
      const status = statusFromDetection(detection);
      last = {
        productId: product.productId,
        status,
        result,
        detection,
        attempts,
        error: null,
        durationMs: Date.now() - started,
        externalSearchUsed: usedExternalSearch(result),
        cached: result.cached,
      };
      if (!RETRYABLE_MATCH_STATUSES.has(status)) return last;
      lastError = detection?.catalog.unresolvedReason ?? null;
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 200) : "matching_error";
      last = {
        productId: product.productId,
        status: "matching_error",
        result: null,
        detection: null,
        attempts,
        error: lastError,
        durationMs: Date.now() - started,
        externalSearchUsed: false,
        cached: false,
      };
    }

    if (attempts < maxAttempts) {
      args.onRetry?.(product.productId, attempts, last.status);
      // Backoff exponencial: 1000, 2000, 4000… Un catálogo saturado necesita
      // que la segunda oleada no llegue a la vez que la primera.
      await sleep(config.matchingRetryBackoffMs * 2 ** (attempts - 1));
    }
  }

  return (
    last ?? {
      productId: product.productId,
      status: "matching_error",
      result: null,
      detection: null,
      attempts,
      error: lastError,
      durationMs: Date.now() - started,
      externalSearchUsed: false,
      cached: false,
    }
  );
}

/**
 * Resuelve TODOS los productos únicos con concurrencia acotada.
 *
 * `Promise.allSettled` y no `Promise.all`: con `all`, el primer rechazo
 * descartaría los resultados de los demás productos de la tanda aunque ya
 * estuvieran listos. Aquí `matchOneProduct` además no lanza nunca, así que un
 * producto roto es un `ProductMatchOutcome` con estado de error, no un agujero.
 */
export async function matchUniqueProducts(args: {
  products: UniqueProductRecord[];
  jobId: string;
  mediaContentId: string;
  mode: MatchingMode;
  matchProduct: MatchProductFn;
  config: VideoAnalysisJobConfig;
  signal?: { aborted: boolean };
  onProgress?: (done: number, total: number, outcome: ProductMatchOutcome) => void;
  onRetry?: (productId: string, attempt: number, status: ProductMatchStatus) => void;
  /** Progreso EN VIVO por producto — ver `MatchProgressState`. */
  onStage?: (productId: string, stage: MatchProgressState) => void;
}): Promise<Map<string, ProductMatchOutcome>> {
  const { products, config } = args;
  const outcomes = new Map<string, ProductMatchOutcome>();
  if (!products.length) return outcomes;

  const concurrency = Math.max(1, config.matchingMaxConcurrency);
  let cursor = 0;
  let done = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= products.length) return;
      const product = products[index];
      const outcome = await matchOneProduct({
        product,
        jobId: args.jobId,
        mediaContentId: args.mediaContentId,
        mode: args.mode,
        matchProduct: args.matchProduct,
        config,
        signal: args.signal,
        onRetry: args.onRetry,
        onStage: args.onStage
          ? (stage) => args.onStage?.(product.productId, stage)
          : undefined,
      });
      outcomes.set(product.productId, outcome);
      done++;
      args.onProgress?.(done, products.length, outcome);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, products.length) },
    () => worker()
  );
  const settled = await Promise.allSettled(workers);

  // Un worker no debería rechazar (matchOneProduct no lanza), pero si alguna
  // vez lo hace, los productos que ese worker no llegó a tocar quedarían sin
  // entrada en el mapa. Se rellenan explícitamente para que nadie los lea como
  // "resueltos sin coincidencia".
  const workerFailed = settled.find((s) => s.status === "rejected");
  if (workerFailed) {
    for (const product of products) {
      if (outcomes.has(product.productId)) continue;
      outcomes.set(product.productId, {
        productId: product.productId,
        status: "matching_error",
        result: null,
        detection: null,
        attempts: 0,
        error:
          workerFailed.status === "rejected"
            ? String(workerFailed.reason).slice(0, 200)
            : "worker_failed",
        durationMs: 0,
        externalSearchUsed: false,
        cached: false,
      });
    }
  }

  return outcomes;
}
