/**
 * Control de presupuesto/créditos para búsquedas externas (reverse image +
 * shopping). En memoria por instancia — suficiente para la demo local; en
 * producción esto viviría en DB/Redis.
 *
 * Regla clave: al agotar presupuesto se DETIENEN las búsquedas externas pero
 * la detección continúa; la UI muestra "Sin búsqueda externa".
 */

const MAX_TOTAL_REQUESTS = Number(process.env.DEMO_MAX_REVERSE_SEARCH_REQUESTS) || 100;
const MAX_PER_VIDEO = Number(process.env.MAX_REVERSE_SEARCHES_PER_VIDEO) || 40;
const BUDGET_EUR =
  Number(process.env.REVERSE_SEARCH_BUDGET_EUR) ||
  Number(process.env.DEMO_EXTERNAL_API_BUDGET_EUR) ||
  10;

type BudgetState = {
  totalRequests: number;
  spentEur: number;
  perVideo: Map<string, number>;
};

const globalBudget = globalThis as unknown as { __reverseBudget?: BudgetState };

function state(): BudgetState {
  if (!globalBudget.__reverseBudget) {
    globalBudget.__reverseBudget = { totalRequests: 0, spentEur: 0, perVideo: new Map() };
  }
  return globalBudget.__reverseBudget;
}

export type BudgetSnapshot = {
  totalRequests: number;
  maxTotalRequests: number;
  spentEur: number;
  budgetEur: number;
  exhausted: boolean;
};

export function budgetSnapshot(): BudgetSnapshot {
  const s = state();
  return {
    totalRequests: s.totalRequests,
    maxTotalRequests: MAX_TOTAL_REQUESTS,
    spentEur: Number(s.spentEur.toFixed(4)),
    budgetEur: BUDGET_EUR,
    exhausted:
      s.totalRequests >= MAX_TOTAL_REQUESTS || s.spentEur >= BUDGET_EUR,
  };
}

/** ¿Se puede lanzar una búsqueda externa más para este vídeo? */
export function canSearch(videoKey: string | null): {
  allowed: boolean;
  reason: string | null;
} {
  const s = state();
  if (s.totalRequests >= MAX_TOTAL_REQUESTS) {
    return { allowed: false, reason: `Límite de ${MAX_TOTAL_REQUESTS} búsquedas alcanzado` };
  }
  if (s.spentEur >= BUDGET_EUR) {
    return { allowed: false, reason: `Presupuesto de ${BUDGET_EUR}€ agotado` };
  }
  if (videoKey && (s.perVideo.get(videoKey) ?? 0) >= MAX_PER_VIDEO) {
    return { allowed: false, reason: `Límite de ${MAX_PER_VIDEO} búsquedas por vídeo alcanzado` };
  }
  return { allowed: true, reason: null };
}

/** Registra el consumo de una llamada externa efectuada. */
export function recordSearch(videoKey: string | null, costEur: number): void {
  const s = state();
  s.totalRequests++;
  s.spentEur += Math.max(0, costEur);
  if (videoKey) s.perVideo.set(videoKey, (s.perVideo.get(videoKey) ?? 0) + 1);
}
