/**
 * Server-side in-memory cost tracker (best-effort for serverless).
 * Tracks estimated OpenAI API costs per session.
 *
 * Pricing estimates (gpt-4o-mini as of 2026):
 *   Vision call  ≈ $0.00085  (~850 input + 400 output tokens)
 *   Product call ≈ $0.00055  (~500 input + 600 output tokens)
 */

const VISION_CALL_COST_USD = 0.00085;
const PRODUCT_CALL_COST_USD = 0.00055;

type CostSummary = {
  openaiVisionCalls: number;
  openaiVisionCostUsd: number;
  openaiProductCalls: number;
  openaiProductCostUsd: number;
  mockCalls: number;
  cacheHits: number;
  totalCostUsd: number;
  startedAt: number;
};

const record: CostSummary = {
  openaiVisionCalls: 0,
  openaiVisionCostUsd: 0,
  openaiProductCalls: 0,
  openaiProductCostUsd: 0,
  mockCalls: 0,
  cacheHits: 0,
  totalCostUsd: 0,
  startedAt: Date.now(),
};

export function trackVisionCall(mock: boolean) {
  if (mock) {
    record.mockCalls++;
    return;
  }
  record.openaiVisionCalls++;
  record.openaiVisionCostUsd += VISION_CALL_COST_USD;
  record.totalCostUsd += VISION_CALL_COST_USD;
}

export function trackProductCalls(count: number) {
  if (count <= 0) return;
  record.openaiProductCalls += count;
  const cost = PRODUCT_CALL_COST_USD * count;
  record.openaiProductCostUsd += cost;
  record.totalCostUsd += cost;
}

export function trackCacheHit() {
  record.cacheHits++;
}

export function getCostSummary(): CostSummary {
  return { ...record };
}
