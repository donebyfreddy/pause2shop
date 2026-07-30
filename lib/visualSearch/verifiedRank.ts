import type { DetectedItem } from "@/lib/types";
import { evidenceLines, getMatchThresholds } from "./matchConfidence";
import { isNonCommercialDomain } from "./reverseImage/resultQuality";
import type { MatchType, RankedCandidate, VisualMatch } from "./types";
import type { VisualVerification } from "./visualVerification";

/**
 * Ranking FINAL en dos etapas con scores normalizados 0-1.
 *
 * La verificación visual (crop ↔ imagen candidata) manda: el merchant solo
 * desempata entre candidatos visualmente parecidos — Amazon/Zalando no pueden
 * ganar por ser tiendas conocidas, y NADA se presenta como "exacto" sin
 * comparación visual real de las imágenes.
 *
 * Distingue además exact_image_source (misma imagen en un blog/Pinterest —
 * evidencia, no producto) de exact_product_match (ficha comercial verificada).
 * Puro salvo lectura de env → test/verifiedRank.test.ts.
 */

type Weights = {
  visual: number;
  lens: number;
  pattern: number;
  brandText: number;
  commercial: number;
  merchant: number;
};

function envWeight(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

export function getRankWeights(): Weights {
  return {
    visual: envWeight("MATCH_WEIGHT_VISUAL_VERIFICATION", 0.45),
    lens: envWeight("MATCH_WEIGHT_LENS_PROVIDER", 0.2),
    pattern: envWeight("MATCH_WEIGHT_PATTERN_ATTRIBUTES", 0.15),
    brandText: envWeight("MATCH_WEIGHT_BRAND_TEXT", 0.1),
    commercial: envWeight("MATCH_WEIGHT_COMMERCIAL", 0.05),
    merchant: envWeight("MATCH_WEIGHT_MERCHANT", 0.05),
  };
}

export type ComponentScores = {
  lensProviderScore: number;
  patternAttributeScore: number;
  brandTextScore: number;
  commercialQualityScore: number;
  merchantTrustScore: number;
};

/** Componentes 0-1 derivados del breakdown aditivo de la etapa 1. */
export function componentScores(c: RankedCandidate): ComponentScores {
  const b = c.scoreBreakdown;
  let lens = 0;
  if (b.exact_image_match) lens = 1;
  else if (b.lens_top_position) lens = 0.75;
  else if (b.lens_high_position) lens = 0.5;
  else if (b.lens_result) lens = 0.3;
  // Un candidato llegado SOLO por búsqueda textual no tiene señal visual del
  // proveedor: su identidad no puede apoyarse en el motor Lens.
  if (c.queryUsed !== null && !b.exact_image_match) lens = Math.min(lens, 0.2);

  const pattern = Math.min(
    1,
    (b.same_color ? 0.4 : 0) + (b.same_category ? 0.35 : 0) + (b.same_style_gender ? 0.25 : 0)
  );
  const brandText = Math.min(1, (b.same_brand ? 0.6 : 0) + (b.visible_text_match ? 0.4 : 0));
  const commercial = Math.min(
    1,
    (c.price != null ? 0.6 : 0) +
      (c.imageUrl ? 0.2 : 0) +
      (isNonCommercialDomain(c.domain) ? 0 : 0.2)
  );
  const merchant = b.trusted_store ? 1 : b.unknown_store ? 0.2 : 0.5;
  return {
    lensProviderScore: lens,
    patternAttributeScore: pattern,
    brandTextScore: brandText,
    commercialQualityScore: commercial,
    merchantTrustScore: merchant,
  };
}

/** Confianza final 0-1: la verificación visual pesa 0.45. */
export function finalMatchConfidence(
  c: RankedCandidate,
  verification: VisualVerification | null,
  weights: Weights = getRankWeights()
): number {
  const s = componentScores(c);
  // Sin verificación, la señal visual disponible es la del proveedor Lens
  // (a media escala): nunca puede simular una verificación positiva.
  const visual = verification ? verification.visualSimilarity : s.lensProviderScore * 0.5;
  let confidence =
    visual * weights.visual +
    s.lensProviderScore * weights.lens +
    s.patternAttributeScore * weights.pattern +
    s.brandTextScore * weights.brandText +
    s.commercialQualityScore * weights.commercial +
    s.merchantTrustScore * weights.merchant;
  // Las contradicciones observadas descartan identidad, pese al resto.
  if (verification && verification.contradictions.length > 0) {
    confidence = Math.min(confidence, 0.5 - 0.1 * verification.contradictions.length);
  }
  return Math.max(0, Math.min(1, confidence));
}

/** Sección de respuesta si el candidato la conserva (NormalizedVisualResult). */
function responseSectionOf(c: RankedCandidate): string | null {
  const section = (c as { responseSection?: string }).responseSection;
  return typeof section === "string" ? section : null;
}

/** ¿Candidato llegado por búsqueda de SHOPPING textual (no visual)? */
export function isShoppingSourced(c: RankedCandidate): boolean {
  return c.source.includes("shopping") || responseSectionOf(c) === "shopping";
}

/** ¿Ficha comercial real (no blog/Pinterest/red social)? */
export function isCommercialProductPage(c: RankedCandidate): boolean {
  if (isNonCommercialDomain(c.domain)) return false;
  const section = responseSectionOf(c);
  return c.price != null || section === "products" || section === "shopping" || Boolean(c.store);
}

/**
 * Clasificación conservadora:
 *  - "exact" EXIGE verificación visual fuerte (≥0.85, sin contradicciones)
 *    Y ficha comercial. exact_image_source en un blog NO basta.
 *  - Sin verificación disponible, el máximo es "near_exact".
 *  - Un candidato de búsqueda textual pura (shopping) nunca pasa de "similar".
 */
export function verifiedMatchType(
  confidence: number,
  verification: VisualVerification | null,
  c: RankedCandidate,
  thresholds = getMatchThresholds()
): MatchType | null {
  if (confidence < thresholds.similar) return null;
  const shoppingOnly =
    (isShoppingSourced(c) || c.queryUsed !== null) && !c.exactImageMatch;
  if (shoppingOnly) return "similar";
  if (
    verification &&
    verification.visualSimilarity >= 0.85 &&
    verification.contradictions.length === 0 &&
    confidence >= thresholds.exact &&
    isCommercialProductPage(c)
  ) {
    return "exact";
  }
  if (confidence >= thresholds.nearExact) return "near_exact";
  return "similar";
}

const MAX_RANKED = 8;
const MAX_LINKS = 4;

/**
 * Construye el VisualMatch final re-ordenando por confianza verificada.
 * `verifications` va indexado por link del candidato (solo top verificados).
 */
export function buildVerifiedMatch(
  item: DetectedItem,
  ranked: RankedCandidate[],
  verifications: Map<string, VisualVerification | null>
): VisualMatch | null {
  if (ranked.length === 0) return null;

  const scored = ranked
    .map((c) => {
      const verification = verifications.get(c.link) ?? null;
      const confidence = finalMatchConfidence(c, verification);
      return { c, verification, confidence };
    })
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  const matchType = verifiedMatchType(best.confidence, best.verification, best.c);
  if (!matchType) return null;

  // Evidencia: primero lo observado al COMPARAR LAS IMÁGENES, después las
  // señales de la etapa 1 (marca/color/tienda).
  const evidence = [
    ...(best.verification?.evidence.map((e) => `✓ ${e}`) ?? []),
    ...(best.verification?.contradictions.map((e) => `✗ ${e}`) ?? []),
    ...evidenceLines(best.c.scoreBreakdown),
  ].slice(0, 7);

  const seenStores = new Set<string>();
  const links: VisualMatch["purchase_links"] = [];
  for (const { c } of scored) {
    if (c.score < 0) continue;
    const store = c.store ?? c.domain ?? "Tienda";
    const key = store.toLowerCase();
    if (seenStores.has(key)) continue;
    seenStores.add(key);
    links.push({
      store,
      url: c.link,
      type: c.matchType === "similar" ? "search" : "exact",
      price: c.price,
      currency: c.currency,
    });
    if (links.length >= MAX_LINKS) break;
  }

  return {
    exact_match_found: matchType !== "similar",
    match_type: matchType,
    product_name: best.c.title,
    brand: best.c.brand ?? item.visible_brand ?? item.brand_guess ?? null,
    color: item.color ?? null,
    product_images: scored
      .slice(0, MAX_RANKED)
      .map(({ c }) => c.imageUrl)
      .filter((u): u is string => Boolean(u))
      .slice(0, 4),
    purchase_links: links,
    best_match_score: Math.round(best.c.score),
    match_confidence: best.confidence,
    evidence,
    best_match_source: best.c.source,
    ranked_candidates: scored.slice(0, MAX_RANKED).map(({ c }) => c),
  };
}
