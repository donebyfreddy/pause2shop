import type { MatchType } from "./types";

/**
 * Confianza de MATCHING (≠ confianza de detección) y clasificación por
 * umbrales configurables. Puro y sin IO → test/matchConfidence.test.ts.
 *
 * El scoring interno de rank.ts va en una escala aditiva (~0-180). Aquí se
 * normaliza a 0-1 con el mismo divisor que usa el catálogo para
 * `similarity_score` (score/150, cap 1), de modo que el % que ve el usuario
 * y el score persistido coinciden.
 */

/** Divisor de normalización del score aditivo → 0-1. */
export const SCORE_NORMALIZER = 150;

export type MatchThresholds = {
  /** ≥ exact (y evidencia de imagen idéntica) → "exact". */
  exact: number;
  /** ≥ nearExact (con corroboración de marca/OCR o señal visual fuerte) → "near_exact". */
  nearExact: number;
  /** ≥ similar → "similar". Por debajo → no fiable (no se presenta como producto). */
  similar: number;
};

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

/**
 * Umbrales por defecto. `similar` arranca laxo (0.30 ≈ 45 pts: candidato en
 * top de Lens) para no vaciar la demo; para el modo estricto de la spec,
 * configurar MATCH_SIMILAR_THRESHOLD=0.60 en el entorno.
 */
export function getMatchThresholds(): MatchThresholds {
  return {
    exact: envNumber("MATCH_EXACT_THRESHOLD", 0.9),
    nearExact: envNumber("MATCH_NEAR_EXACT_THRESHOLD", 0.7),
    similar: envNumber("MATCH_SIMILAR_THRESHOLD", 0.3),
  };
}

/** Normaliza el score aditivo del ranking a confianza de matching 0-1. */
export function matchConfidence(score: number): number {
  return Math.max(0, Math.min(score / SCORE_NORMALIZER, 1));
}

/**
 * Clasifica un candidato. Reglas duras además del umbral numérico:
 *  - "exact" EXIGE que el proveedor visual lo marcara como imagen idéntica
 *    (`exact_image_match`). Un parecido textual nunca es "exacto".
 *  - "near_exact" exige corroboración (marca o texto visible coinciden) o
 *    superar el umbral con posición visual alta del motor.
 *  - Bajo `similar` → null (no fiable: no presentar como producto).
 */
export function classifyMatch(
  score: number,
  breakdown: Record<string, number>,
  thresholds: MatchThresholds = getMatchThresholds()
): MatchType | null {
  const confidence = matchConfidence(score);
  if (confidence < thresholds.similar) return null;

  const exactImage = Boolean(breakdown.exact_image_match);
  const brandMatch = Boolean(breakdown.same_brand);
  const textMatch = Boolean(breakdown.visible_text_match);
  const visualStrong = Boolean(
    breakdown.lens_top_position || breakdown.exact_image_match
  );

  if (exactImage && confidence >= thresholds.exact) return "exact";
  if (exactImage) return "near_exact";
  if (brandMatch && textMatch) return "near_exact";
  if (confidence >= thresholds.nearExact && (brandMatch || (textMatch && visualStrong))) {
    return "near_exact";
  }
  return "similar";
}

/** Etiquetas legibles de la evidencia del scoring (para "Coincide en: …"). */
const EVIDENCE_LABELS: Record<string, string> = {
  exact_image_match: "✓ Imagen idéntica según el motor visual",
  lens_top_position: "✓ Entre los más parecidos visualmente (Google Lens)",
  lens_high_position: "✓ Alta similitud visual (Google Lens)",
  lens_result: "✓ Encontrado por búsqueda visual",
  same_brand: "✓ La marca coincide",
  visible_text_match: "✓ El texto visible coincide",
  same_color: "✓ El color coincide",
  same_category: "✓ La categoría coincide",
  same_style_gender: "✓ Estilo/género coinciden",
  trusted_store: "✓ Tienda fiable",
  has_price: "✓ Ficha de producto con precio",
  unknown_store: "✗ Tienda no verificada",
};

/**
 * Convierte el scoreBreakdown en líneas de evidencia legibles, positivas
 * primero. Solo señales presentes — nunca se inventa evidencia.
 */
export function evidenceLines(breakdown: Record<string, number>): string[] {
  return Object.entries(breakdown)
    .filter(([, points]) => points !== 0)
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => EVIDENCE_LABELS[key] ?? key)
    .filter((label, idx, arr) => arr.indexOf(label) === idx);
}
