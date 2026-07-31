import type { DetectedItem } from "@/lib/types";
import type { VisualMatch } from "@/lib/visualSearch/types";
import type { NormalizedProductMatch, ProductMatchingResult } from "./types";

/**
 * Adaptación de los resultados normalizados a lo que la UI YA consume
 * (`VisualMatch`). Vive aquí, y no dentro de un route, porque tanto
 * /api/vision/match-object como el análisis de imagen necesitan lo mismo:
 * si cada uno lo hiciera a su manera, "catálogo" se pintaría distinto según
 * por dónde entrara el usuario.
 */

/** Candidato similar tal y como lo espera la UI. */
export type SimilarCandidateView = {
  title: string;
  link: string;
  imageUrl: string | null;
  store: string | null;
  price: number | null;
  currency: string | null;
};

function storeLabel(productUrl: string, fallback: string): string {
  try {
    return new URL(productUrl).hostname.replace(/^www\./, "");
  } catch {
    return fallback;
  }
}

/**
 * Construye un VisualMatch presentable desde el mejor match del CATÁLOGO.
 * "exact" solo con identidad por hash — nunca por embedding.
 */
export function catalogResultToVisualMatch(
  matching: ProductMatchingResult,
  item: DetectedItem
): VisualMatch | null {
  const best = matching.matches.find((m) => m.source === "catalog");
  if (!best) return null;
  const identityByHash =
    best.matchStage === "exact_hash" || best.matchStage === "perceptual_hash";
  const reliable = matching.matchLabel === "CATALOG_MATCH";
  let matchType: VisualMatch["match_type"];
  if (!reliable) matchType = "similar";
  else if (identityByHash) matchType = "exact";
  else matchType = "near_exact";

  return {
    exact_match_found: reliable && identityByHash,
    match_type: matchType,
    product_name: best.title,
    brand: best.brand,
    color: item.color ?? null,
    product_images: best.imageUrl ? [best.imageUrl] : [],
    purchase_links: [
      {
        store: storeLabel(best.productUrl, "Catálogo"),
        url: best.productUrl,
        type: reliable ? "exact" : "search",
        price: best.price,
        currency: best.currency,
      },
    ],
    // El score del catálogo ya es 0-1: se presenta en escala 0-100 sin pasar
    // por el normalizador aditivo del pipeline externo.
    best_match_score: Math.round(best.scores.finalScore * 100),
    match_confidence: best.scores.finalScore,
    evidence: best.evidence,
    best_match_source: "catalog",
    ranked_candidates: [],
  };
}

/** Los matches del catálogo como candidatos similares para la UI. */
export function catalogSimilarCandidates(
  matching: ProductMatchingResult
): SimilarCandidateView[] {
  return matching.matches
    .filter((m) => m.source === "catalog" && Boolean(m.imageUrl))
    .slice(0, 6)
    .map(toSimilarCandidate);
}

function toSimilarCandidate(m: NormalizedProductMatch): SimilarCandidateView {
  return {
    title: m.title,
    link: m.productUrl,
    imageUrl: m.imageUrl,
    store: m.merchant,
    price: m.price,
    currency: m.currency,
  };
}
