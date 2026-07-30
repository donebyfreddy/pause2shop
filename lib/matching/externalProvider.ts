import type { DetectedItem } from "@/lib/types";
import { SCORE_NORMALIZER } from "@/lib/visualSearch/matchConfidence";
import type { RankedCandidate, VisualMatch } from "@/lib/visualSearch/types";
import type {
  MatchLabel,
  NormalizedProductMatch,
  ProductMatchingInput,
  ProductMatchingProvider,
  ProductMatchingResult,
} from "./types";
import { noMatchResult } from "./types";

/**
 * Estrategia EXTERNAL: envuelve el pipeline EXISTENTE de reverse image search
 * (SearchAPI/SerpAPI Lens + verificación visual + DataForSEO) sin duplicar su
 * lógica. El pipeline vive en el route handler de match-object (necesita
 * Storage, presupuesto y verificación); por eso este provider recibe un
 * DELEGADO: el route le pasa un closure sobre su flujo actual, y los tests le
 * inyectan un fake. El comportamiento external-only NO cambia.
 */

/** Lo que produce el pipeline externo actual para un crop. */
export type ExternalPipelineOutcome = {
  match: VisualMatch | null;
  providerUsed: string | null;
  fallbackUsed: boolean;
  cached: boolean;
  timings: Record<string, number>;
};

export type ExternalSearchFn = (
  input: ProductMatchingInput
) => Promise<ExternalPipelineOutcome>;

function toNormalizedExternal(
  c: RankedCandidate,
  item: DetectedItem
): NormalizedProductMatch {
  const breakdown = c.scoreBreakdown ?? {};
  // Marca: solo cuenta como evidencia si el ranking la corroboró Y la
  // detección tenía marca verificada — un título que "contiene" la marca no
  // es evidencia (regla de matchConfidence.ts).
  const brandVerified =
    Boolean(breakdown.same_brand) && item.brand_status === "verified";
  return {
    source: "external",
    productId: null,
    title: c.title,
    brand: c.brand ?? null,
    imageUrl: c.imageUrl,
    productUrl: c.link,
    price: c.price,
    currency: c.currency,
    merchant: c.store ?? c.domain,
    availability: null,
    matchStage: null,
    provider: c.source,
    scores: {
      detectionScore: Number.isFinite(item.confidence) ? item.confidence : null,
      // Señal visual: solo si el motor la reportó (imagen idéntica o posición
      // alta en Lens). No se inventa un score visual continuo que no existe.
      visualScore: breakdown.exact_image_match
        ? 1
        : breakdown.lens_top_position || breakdown.lens_high_position
          ? 0.8
          : null,
      textScore: breakdown.visible_text_match ? 1 : null,
      attributeScore:
        breakdown.same_color || breakdown.same_category ? 0.7 : null,
      brandEvidenceScore: brandVerified ? 1 : null,
      merchantScore: breakdown.trusted_store
        ? 1
        : breakdown.unknown_store
          ? 0
          : null,
      finalScore: Math.max(0, Math.min(c.score / SCORE_NORMALIZER, 1)),
    },
    evidence: [],
  };
}

/** Normaliza el outcome del pipeline externo al contrato común. */
export function externalOutcomeToResult(
  outcome: ExternalPipelineOutcome,
  item: DetectedItem
): ProductMatchingResult {
  const ranked = outcome.match?.ranked_candidates ?? [];
  const matches = ranked
    .map((c) => toNormalizedExternal(c, item))
    .sort((a, b) => b.scores.finalScore - a.scores.finalScore);
  if (matches[0] && outcome.match) {
    matches[0].evidence = outcome.match.evidence;
  }

  let matchLabel: MatchLabel = "NO_MATCH";
  if (outcome.match) {
    matchLabel =
      outcome.match.match_type === "similar" ? "SIMILAR" : "EXTERNAL_MATCH";
  }

  return {
    matches,
    matchLabel,
    providerUsed: outcome.providerUsed,
    fallbackUsed: outcome.fallbackUsed,
    cached: outcome.cached,
    timings: outcome.timings,
  };
}

export class ExternalVisualSearchProvider implements ProductMatchingProvider {
  constructor(private readonly runExternal: ExternalSearchFn) {}

  async search(input: ProductMatchingInput): Promise<ProductMatchingResult> {
    try {
      const outcome = await this.runExternal(input);
      return externalOutcomeToResult(outcome, input.item);
    } catch (err) {
      // El pipeline externo nunca debería lanzar, pero si lo hace el análisis
      // continúa con NO_MATCH en vez de romperse.
      return noMatchResult({
        warnings: [
          `Pipeline externo falló: ${err instanceof Error ? err.message : "error desconocido"}`,
        ],
      });
    }
  }
}
