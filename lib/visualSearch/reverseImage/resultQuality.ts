import type { NormalizedVisualResult } from "./types";

/**
 * Evaluación PRELIMINAR y barata de los resultados de un proveedor, para
 * decidir fallback/escalado. No es el ranking final: solo responde
 * "¿esto es suficientemente útil como para no probar otro modo/proveedor?".
 * Pura → test/resultQuality.test.ts.
 */

export type PreliminaryQuality = {
  usefulCount: number;
  commercialCount: number;
  exactCount: number;
  /** 0-1: densidad de señal comercial/exacta del set. */
  qualityScore: number;
  shouldFallback: boolean;
  fallbackReason: "no_results" | "no_useful_results" | "weak_results" | null;
};

/** Dominios que NO son fichas de producto aunque salgan en exact_matches. */
const NON_COMMERCIAL_DOMAINS = [
  "pinterest.", "instagram.", "facebook.", "twitter.", "x.com", "tiktok.",
  "reddit.", "tumblr.", "youtube.", "blogspot.", "wordpress.", "medium.",
  "wikipedia.", "fandom.",
];

export function isNonCommercialDomain(domain: string | null): boolean {
  if (!domain) return false;
  return NON_COMMERCIAL_DOMAINS.some((d) => domain.includes(d));
}

/** ¿El candidato parece una ficha/página de producto real? */
export function isCommercialCandidate(r: NormalizedVisualResult): boolean {
  if (isNonCommercialDomain(r.domain)) return false;
  return (
    r.price != null ||
    r.sourceType === "products" ||
    r.sourceType === "shopping" ||
    Boolean(r.brand)
  );
}

/** ¿El candidato aporta señal utilizable (imagen o comercio)? */
export function isUsefulCandidate(r: NormalizedVisualResult): boolean {
  if (isNonCommercialDomain(r.domain)) return false;
  return Boolean(r.imageUrl) || isCommercialCandidate(r);
}

const MIN_USEFUL = 1;
const WEAK_QUALITY = 0.25;

export function evaluatePreliminaryResultQuality(
  results: NormalizedVisualResult[]
): PreliminaryQuality {
  if (results.length === 0) {
    return {
      usefulCount: 0,
      commercialCount: 0,
      exactCount: 0,
      qualityScore: 0,
      shouldFallback: true,
      fallbackReason: "no_results",
    };
  }

  const useful = results.filter(isUsefulCandidate);
  const commercial = results.filter(isCommercialCandidate);
  // exact_matches solo cuentan como señal si además son comerciales: la misma
  // imagen en Pinterest/un blog no identifica un producto comprable.
  const exact = results.filter(
    (r) => r.exactImageMatch && isCommercialCandidate(r)
  );

  // Densidad de señal, con bonus fuerte por exactos comerciales.
  const qualityScore = Math.min(
    1,
    (commercial.length * 0.15 + exact.length * 0.4 + useful.length * 0.05)
  );

  if (useful.length < MIN_USEFUL) {
    return {
      usefulCount: useful.length,
      commercialCount: commercial.length,
      exactCount: exact.length,
      qualityScore,
      shouldFallback: true,
      fallbackReason: "no_useful_results",
    };
  }

  return {
    usefulCount: useful.length,
    commercialCount: commercial.length,
    exactCount: exact.length,
    qualityScore,
    shouldFallback: qualityScore < WEAK_QUALITY,
    fallbackReason: qualityScore < WEAK_QUALITY ? "weak_results" : null,
  };
}
