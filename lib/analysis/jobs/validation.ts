import type {
  AnalysisJobRecord,
  IntegrityError,
  SceneRecord,
  TemporalCoverage,
  UniqueProductRecord,
} from "./types";

/**
 * VALIDACIÓN DE INTEGRIDAD del resultado de un job de vídeo preprocesado.
 *
 * La señal de que este pipeline está roto nunca fue "35 frames analizados":
 * es la combinación "10 productos únicos, 0 apariciones, 0 fusiones, 0
 * catalog hits, 0 búsquedas externas, partially_completed" — un job puede
 * tener pocos frames y estar perfectamente sano, pero esa combinación NUNCA
 * es honesta. Esta función la detecta explícitamente en vez de dejar que se
 * cuele como un `completed` o un `partially_completed` sin explicación.
 *
 * Se llama al finalizar, justo antes de fijar el estado definitivo. Si
 * devuelve algo, el job es `partially_completed` con `integrityErrors`
 * poblado — nunca `completed` silenciosamente.
 */
export function validateProcessedVideoResult(params: {
  job: Pick<AnalysisJobRecord, "status" | "warnings" | "timings" | "counters" | "matchingMode">;
  scenes: SceneRecord[];
  products: UniqueProductRecord[];
  coverage: TemporalCoverage;
  externalSearchEnabled: boolean;
  /** Ya calculado por quien llama (mismo criterio que decide el estado final). */
  unresolvedProducts: number;
}): IntegrityError[] {
  const { job, scenes, products, coverage, externalSearchEnabled, unresolvedProducts } = params;
  const errors: IntegrityError[] = [];

  const nonTerminal = scenes.filter((s) => s.status !== "completed" && s.status !== "failed");
  if (nonTerminal.length > 0) {
    errors.push({
      code: "scene_missing_terminal_status",
      message: `${nonTerminal.length} escena(s) sin estado terminal (pending/extracting/detecting/tracking).`,
      context: { sceneIds: nonTerminal.map((s) => s.sceneId) },
    });
  }

  if (coverage.coveragePercent < 99) {
    errors.push({
      code: "coverage_below_threshold",
      message: `Cobertura temporal ${coverage.coveragePercent}% (< 99% requerido).`,
      context: {
        coveragePercent: coverage.coveragePercent,
        uncoveredRanges: coverage.uncoveredRanges,
      },
    });
  }

  const zeroSeenWithCrop = products.filter(
    (p) =>
      p.identity.seenCount === 0 &&
      Boolean(p.bestCrop.frameDataUrl || p.bestCrop.cropDataUrl)
  );
  if (zeroSeenWithCrop.length > 0) {
    errors.push({
      code: "product_seen_count_zero_with_crop",
      message: `${zeroSeenWithCrop.length} producto(s) con mejor crop pero 0 apariciones registradas.`,
      context: { productIds: zeroSeenWithCrop.map((p) => p.productId) },
    });
  }

  if (
    job.timings.matchingMs > 0 &&
    products.length > 0 &&
    products.every((p) => p.matchStatus === "not_searched")
  ) {
    errors.push({
      code: "matching_ran_but_no_outcomes",
      message: `El matching tardó ${job.timings.matchingMs} ms pero ningún producto tiene resultado (todos "not_searched").`,
    });
  }

  if (
    externalSearchEnabled &&
    job.matchingMode !== "catalog_only" &&
    unresolvedProducts > 0 &&
    job.counters.externalSearchesUsed === 0 &&
    job.counters.externalCandidates === 0
  ) {
    errors.push({
      code: "external_fallback_unused",
      message: `Fallback externo activo y ${unresolvedProducts} producto(s) sin resolver, pero 0 búsquedas externas se ejecutaron.`,
    });
  }

  // Invariante defensiva: si ALGO marcó el job como partially_completed sin
  // que haya warnings, productos sin resolver NI errores de integridad ya
  // detectados arriba, es que hay una vía nueva hacia ese estado que no
  // registra su motivo. Con la lógica actual de `finalizeAnalysisJob` esto no
  // debería dispararse nunca — si se dispara, es una regresión en otro sitio.
  if (
    job.status === "partially_completed" &&
    job.warnings.length === 0 &&
    unresolvedProducts === 0 &&
    errors.length === 0
  ) {
    errors.push({
      code: "partially_completed_without_reason",
      message:
        "El job es partially_completed sin warnings, sin productos sin resolver y sin otros errores de integridad.",
    });
  }

  return errors;
}
