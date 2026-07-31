import type { DetectedItem } from "@/lib/types";
import { SCORE_NORMALIZER } from "@/lib/visualSearch/matchConfidence";
import type { RankedCandidate, VisualMatch } from "@/lib/visualSearch/types";
import { getMatchingConfig } from "./config";
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
  /**
   * Candidatos rankeados aunque NO haya match fiable.
   *
   * Sin esto, un pipeline que encuentra 8 productos parecidos pero ninguno
   * verificado devolvía `matches: []`, y el bloque de Internet salía vacío
   * cuando en realidad tenía resultados que enseñar (como "producto similar",
   * no como coincidencia).
   */
  rankedCandidates?: RankedCandidate[];
};

export type ExternalSearchFn = (
  input: ProductMatchingInput
) => Promise<ExternalPipelineOutcome>;

function toNormalizedExternal(
  c: RankedCandidate,
  item: DetectedItem,
  threshold: number
): NormalizedProductMatch {
  const breakdown = c.scoreBreakdown ?? {};
  // Marca: solo cuenta como evidencia si el ranking la corroboró Y la
  // detección tenía marca verificada — un título que "contiene" la marca no
  // es evidencia (regla de matchConfidence.ts).
  const brandVerified =
    Boolean(breakdown.same_brand) && item.brand_status === "verified";
  const finalScore = Math.max(0, Math.min(c.score / SCORE_NORMALIZER, 1));
  // Una búsqueda externa NO es una coincidencia exacta por defecto: solo se
  // afirma "exact" si el motor devolvió la MISMA imagen. Lo demás, según score.
  let matchType: NormalizedProductMatch["matchType"];
  if (c.exactImageMatch || breakdown.exact_image_match) {
    matchType = "exact";
  } else if (finalScore >= threshold) {
    matchType = "probable";
  } else {
    matchType = "similar";
  }
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
    // Los motores de reverse image no devuelven categoría normalizada.
    category: null,
    model: null,
    matchType,
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

/**
 * Normaliza el outcome del pipeline externo al contrato común.
 *
 * El umbral EXTERNO es propio (EXTERNAL_MATCH_THRESHOLD): un candidato que el
 * motor clasificó como match pero que no llega al umbral se degrada a SIMILAR
 * en vez de presentarse como coincidencia fiable.
 */
export function externalOutcomeToResult(
  outcome: ExternalPipelineOutcome,
  item: DetectedItem,
  threshold: number = getMatchingConfig().externalMatchMinScore
): ProductMatchingResult {
  const ranked =
    outcome.match?.ranked_candidates?.length
      ? outcome.match.ranked_candidates
      : outcome.rankedCandidates ?? [];
  const matches = ranked
    .map((c) => toNormalizedExternal(c, item, threshold))
    .sort((a, b) => b.scores.finalScore - a.scores.finalScore);
  if (matches[0] && outcome.match) {
    matches[0].evidence = outcome.match.evidence;
  }

  let matchLabel: MatchLabel = "NO_MATCH";
  if (outcome.match) {
    const engineSaysMatch = outcome.match.match_type !== "similar";
    const best = matches[0]?.scores.finalScore ?? 0;
    matchLabel =
      engineSaysMatch && best >= threshold ? "EXTERNAL_MATCH" : "SIMILAR";
  } else if (matches.length > 0) {
    // Hay candidatos pero el motor no verificó ninguno: son similares, no
    // coincidencias. Se devuelven etiquetados como tal, no se descartan.
    matchLabel = "SIMILAR";
  }

  return {
    matches,
    matchLabel,
    providerUsed: outcome.providerUsed,
    fallbackUsed: outcome.fallbackUsed,
    cached: outcome.cached,
    timings: outcome.timings,
    catalogAttempted: false,
    externalAttempted: true,
    externalFallbackUsed: false,
    unresolvedReason:
      matchLabel === "NO_MATCH"
        ? "La búsqueda externa no devolvió ningún producto."
        : undefined,
  };
}

export class ExternalVisualSearchProvider implements ProductMatchingProvider {
  constructor(
    private readonly runExternal: ExternalSearchFn,
    private readonly threshold?: number
  ) {}

  async search(input: ProductMatchingInput): Promise<ProductMatchingResult> {
    try {
      const outcome = await this.runExternal(input);
      return externalOutcomeToResult(outcome, input.item, this.threshold);
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
