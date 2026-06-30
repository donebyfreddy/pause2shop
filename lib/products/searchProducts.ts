import type { CatalogItem, RecommendationInput } from "@/lib/catalog/types";
import { MockProductProvider } from "./mockProvider";
import { OpenAIProductProvider } from "./openaiProvider";
import type { ProductProvider } from "./types";

export type { ProductProvider } from "./types";

/**
 * Selección de proveedor de matching:
 *  - Si hay OPENAI_API_KEY → matching AUTOMÁTICO con OpenAI.
 *  - Si no → MockProductProvider (demo) salvo ENABLE_MOCK_PRODUCTS=false.
 *
 * Para añadir Amazon Creators API / tiendas verificadas / catálogo propio,
 * implementa ProductProvider y mételo en la cadena.
 */
const openai = new OpenAIProductProvider();
const mock = new MockProductProvider();

export function getActiveProviders(): ProductProvider[] {
  if (openai.isEnabled()) return [openai];
  if (mock.isEnabled()) return [mock];
  return [];
}

/** ¿Las recomendaciones vienen del proveedor mock (sin OpenAI)? */
export function isUsingMockProducts(): boolean {
  return !openai.isEnabled() && mock.isEnabled();
}

/**
 * Busca recomendaciones para un item. Devuelve RecommendationInput[] ordenadas
 * por similitud; el caller las persiste. Si OpenAI está activo pero falla o no
 * devuelve nada, cae al mock para que el usuario siempre vea algo.
 */
export async function searchProducts(
  item: CatalogItem,
  opts: { limit?: number } = {}
): Promise<RecommendationInput[]> {
  const query = (item.searchQuery || item.name || "").trim();
  if (!query) return [];

  const providers = getActiveProviders();
  const settled = await Promise.allSettled(
    providers.map((p) => p.search(query, item))
  );

  const all: RecommendationInput[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  // Fallback: OpenAI activo pero sin resultados (error/parseo) → usa el mock.
  if (all.length === 0 && openai.isEnabled() && mock.isEnabled()) {
    try {
      all.push(...(await mock.search(query, item)));
    } catch {
      /* sin recomendaciones */
    }
  }

  all.sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0));
  return all.slice(0, opts.limit ?? 8);
}
