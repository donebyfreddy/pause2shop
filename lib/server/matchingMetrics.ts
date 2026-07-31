import type {
  DetectionMatchResult,
  MatchingMode,
} from "@/lib/matching/types";

/**
 * Métricas de resolución de productos: cuánto resuelve el CATÁLOGO y cuánto
 * gasto externo se evita gracias a ello.
 *
 * Existe porque la pregunta que decide si el catálogo merece la pena ("¿de cada
 * 100 objetos detectados, cuántos resuelve mi catálogo?") no se podía responder:
 * el tracker de costes cuenta llamadas y euros, pero no distingue un objeto
 * resuelto en casa de uno resuelto pagando a un proveedor.
 *
 * In-memory y best-effort, igual que `costTracker`: en serverless cada instancia
 * lleva su propia cuenta. Sirve para observar una sesión de trabajo, no como
 * contabilidad histórica — de eso se encarga la persistencia de jobs.
 */

/** Coste que habría tenido una llamada externa que el catálogo hizo innecesaria. */
const EXTERNAL_CALL_COST_USD =
  Number(process.env.EXTERNAL_SEARCH_ESTIMATED_COST_USD) || 0.006;

export type UnresolvedCategory = { category: string; count: number };

export type MatchingMetrics = {
  /** Objetos detectados que han pasado por el resolver. */
  detections: number;
  /** Resueltos con una coincidencia fiable del catálogo propio. */
  resolvedByCatalog: number;
  /** Resueltos con un resultado externo fiable. */
  resolvedByExternal: number;
  /** Sin coincidencia fiable en ninguna fuente. */
  unresolved: number;
  /** Veces que el catálogo no resolvió y se recurrió al externo. */
  externalFallbacks: number;
  /** Llamadas externas realmente ejecutadas. */
  externalCalls: number;
  /** Llamadas externas lanzadas por petición explícita del usuario. */
  externalManualRequests: number;
  /** Aciertos de caché (catálogo o externo). */
  cacheHits: number;
  /** Coste externo estimado realmente incurrido, en USD. */
  externalCostUsd: number;
  /**
   * Coste externo EVITADO: una llamada por cada detección que el catálogo
   * resolvió sin salir fuera. Es el ahorro atribuible al catálogo.
   */
  externalCostAvoidedUsd: number;
  /** Tasa de resolución del catálogo, 0-1 (null si no hay detecciones). */
  catalogResolutionRate: number | null;
  /** Tiempo medio de resolución por detección, en ms (null si no hay datos). */
  averageDurationMs: number | null;
  /** Reparto por modo de matching efectivo. */
  byMode: Partial<Record<MatchingMode, number>>;
  /** Categorías que el catálogo no resuelve, de mayor a menor. */
  topUnresolvedCategories: UnresolvedCategory[];
  startedAt: number;
};

type MutableState = {
  detections: number;
  resolvedByCatalog: number;
  resolvedByExternal: number;
  unresolved: number;
  externalFallbacks: number;
  externalCalls: number;
  externalManualRequests: number;
  cacheHits: number;
  externalCostUsd: number;
  externalCostAvoidedUsd: number;
  totalDurationMs: number;
  timedDetections: number;
  byMode: Partial<Record<MatchingMode, number>>;
  unresolvedByCategory: Map<string, number>;
  startedAt: number;
};

function freshState(): MutableState {
  return {
    detections: 0,
    resolvedByCatalog: 0,
    resolvedByExternal: 0,
    unresolved: 0,
    externalFallbacks: 0,
    externalCalls: 0,
    externalManualRequests: 0,
    cacheHits: 0,
    externalCostUsd: 0,
    externalCostAvoidedUsd: 0,
    totalDurationMs: 0,
    timedDetections: 0,
    byMode: {},
    unresolvedByCategory: new Map(),
    startedAt: Date.now(),
  };
}

// Singleton por proceso. Compartido vía globalThis para que el hot-reload de
// dev no reinicie los contadores en cada recompilación.
const globalForMetrics = globalThis as unknown as {
  __matchingMetrics?: MutableState;
};
function state(): MutableState {
  globalForMetrics.__matchingMetrics ??= freshState();
  return globalForMetrics.__matchingMetrics;
}

export type RecordDetectionArgs = {
  detection: DetectionMatchResult;
  /** Categoría detectada, para el ranking de "sin resolver". */
  category?: string | null;
  /** Duración total de la resolución de esta detección, en ms. */
  durationMs?: number;
  /** ¿Se ejecutó realmente una llamada externa? */
  externalCalled: boolean;
  /** ¿Fue esa llamada un fallback del catálogo? */
  externalFallback: boolean;
  /** ¿La pidió el usuario a mano? */
  externalManual?: boolean;
  cacheHit?: boolean;
  externalCostUsd?: number;
};

export function recordDetectionResolution(args: RecordDetectionArgs): void {
  const s = state();
  const { detection } = args;
  s.detections += 1;
  s.byMode[detection.matchingMode] =
    (s.byMode[detection.matchingMode] ?? 0) + 1;

  if (args.durationMs != null && Number.isFinite(args.durationMs)) {
    s.totalDurationMs += args.durationMs;
    s.timedDetections += 1;
  }
  if (args.cacheHit) s.cacheHits += 1;

  if (args.externalCalled) {
    s.externalCalls += 1;
    s.externalCostUsd += args.externalCostUsd ?? EXTERNAL_CALL_COST_USD;
    if (args.externalFallback) s.externalFallbacks += 1;
    if (args.externalManual) s.externalManualRequests += 1;
  }

  if (detection.catalog.status === "matched") {
    s.resolvedByCatalog += 1;
    // El ahorro solo se cuenta cuando de verdad no se llamó fuera: si el
    // usuario pidió Internet además, el coste se incurrió igualmente.
    if (!args.externalCalled) s.externalCostAvoidedUsd += EXTERNAL_CALL_COST_USD;
    return;
  }

  if (detection.external.status === "matched") {
    s.resolvedByExternal += 1;
    return;
  }

  s.unresolved += 1;
  const category = (args.category ?? detection.label ?? "").trim().toLowerCase();
  if (category) {
    s.unresolvedByCategory.set(
      category,
      (s.unresolvedByCategory.get(category) ?? 0) + 1
    );
  }
}

export function getMatchingMetrics(): MatchingMetrics {
  const s = state();
  return {
    detections: s.detections,
    resolvedByCatalog: s.resolvedByCatalog,
    resolvedByExternal: s.resolvedByExternal,
    unresolved: s.unresolved,
    externalFallbacks: s.externalFallbacks,
    externalCalls: s.externalCalls,
    externalManualRequests: s.externalManualRequests,
    cacheHits: s.cacheHits,
    externalCostUsd: round(s.externalCostUsd),
    externalCostAvoidedUsd: round(s.externalCostAvoidedUsd),
    catalogResolutionRate:
      s.detections > 0 ? s.resolvedByCatalog / s.detections : null,
    averageDurationMs:
      s.timedDetections > 0
        ? Math.round(s.totalDurationMs / s.timedDetections)
        : null,
    byMode: { ...s.byMode },
    topUnresolvedCategories: [...s.unresolvedByCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    startedAt: s.startedAt,
  };
}

/** Solo para tests: vuelve a cero. */
export function resetMatchingMetrics(): void {
  globalForMetrics.__matchingMetrics = freshState();
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
