import { getObjectDetector } from "@/lib/detection";
import { noMatchResult, type ProductMatchingResult } from "@/lib/matching/types";
import { getVideoAnalysisJobConfig } from "./config";
import { getAnalysisJobStore } from "./store";
import type { JobEngineDeps, MatchProductFn } from "./engine";

/**
 * Wiring REAL del motor de jobs para los route handlers.
 *
 * El matching por producto único REUTILIZA el endpoint /api/vision/match-object
 * tal cual (self-fetch con el origin de la petición): así el job hereda sin
 * duplicar código todo el pipeline existente — presupuesto, caché por hash,
 * upload del crop, reverse image con fallback, verificación visual, catálogo
 * según matchingMode y persistencia best-effort. Cada llamada consume como
 * máximo UNA búsqueda externa; el motor la invoca una vez por producto único
 * (MAX_EXTERNAL_SEARCHES_PER_PRODUCT).
 */

/** Timeout del matching por producto: el pipeline completo puede tardar. */
const MATCH_TIMEOUT_MS = Number(process.env.VIDEO_MATCHING_TIMEOUT_MS) || 60_000;

function buildMatchProduct(origin: string): MatchProductFn {
  return async ({ jobId, mediaContentId, globalProductId, item, cropDataUrl, frameDataUrl, mode }) => {
    // Sin crop del cliente se degrada al mejor FRAME completo (el pipeline
    // externo sigue funcionando, con menos precisión). Sin ninguno: NO_MATCH.
    const crop = cropDataUrl ?? frameDataUrl;
    if (!crop) {
      return noMatchResult({
        warnings: ["Producto sin crop ni frame utilizable: matching omitido."],
      });
    }
    const res = await fetch(`${origin}/api/vision/match-object`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(MATCH_TIMEOUT_MS),
      body: JSON.stringify({
        crop,
        item,
        matchingMode: mode,
        videoKey: "analysis-job",
        analysisJobId: jobId,
        mediaContentId,
        globalProductId,
      }),
    });
    if (!res.ok) {
      throw new Error(`match-object respondió ${res.status}`);
    }
    const body = (await res.json()) as {
      ok: boolean;
      matching?: ProductMatchingResult;
      detail?: string;
      error?: string;
    };
    if (!body.ok) throw new Error(body.error ?? "matching_failed");
    return (
      body.matching ??
      noMatchResult({ warnings: body.detail ? [body.detail] : undefined })
    );
  };
}

/** Dependencias reales del motor para los route handlers. */
export function buildJobEngineDeps(origin: string): JobEngineDeps {
  return {
    store: getAnalysisJobStore(),
    detector: getObjectDetector(),
    matchProduct: buildMatchProduct(origin),
    config: getVideoAnalysisJobConfig(),
  };
}
