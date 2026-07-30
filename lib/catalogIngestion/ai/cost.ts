/**
 * Coste estimado de las llamadas a OpenAI.
 *
 * Es una ESTIMACIÓN local, no la factura: se calcula con los tokens que
 * devuelve la API y una tabla de precios por millón de tokens. Se muestra
 * siempre etiquetado como estimado, y un modelo desconocido devuelve coste 0
 * con un aviso, en vez de inventar un precio.
 */

export interface ModelPricing {
  /** USD por millón de tokens de entrada. */
  inputPerMillion: number;
  /** USD por millón de tokens de salida. */
  outputPerMillion: number;
}

/**
 * Tabla de precios. Se puede sobrescribir con `OPENAI_PRICE_INPUT_PER_MTOK` /
 * `OPENAI_PRICE_OUTPUT_PER_MTOK` sin tocar código cuando cambien las tarifas.
 */
const PRICING: Record<string, ModelPricing> = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8 },
};

export function pricingFor(model: string): ModelPricing | null {
  const override = {
    inputPerMillion: Number(process.env.OPENAI_PRICE_INPUT_PER_MTOK),
    outputPerMillion: Number(process.env.OPENAI_PRICE_OUTPUT_PER_MTOK),
  };
  if (Number.isFinite(override.inputPerMillion) && Number.isFinite(override.outputPerMillion)) {
    return override;
  }
  // Los ids incluyen fecha ("gpt-4o-mini-2024-07-18"): buscamos por prefijo.
  const exact = PRICING[model];
  if (exact) return exact;
  const prefix = Object.keys(PRICING)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? PRICING[prefix] : null;
}

/** Coste estimado en USD. Devuelve 0 si el modelo no está tarifado. */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = pricingFor(model);
  if (!pricing) return 0;
  const usd =
    (promptTokens / 1_000_000) * pricing.inputPerMillion +
    (completionTokens / 1_000_000) * pricing.outputPerMillion;
  // 6 decimales: una extracción cuesta del orden de 0,0002 USD.
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function isModelPriced(model: string): boolean {
  return pricingFor(model) != null;
}
