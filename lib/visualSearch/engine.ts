import type { DetectedItem, FrameAnalysis } from "@/lib/types";
import {
  trackLensSearch,
  trackShoppingSearch,
  trackCacheHit,
} from "@/lib/server/costTracker";
import { cacheGet, cacheSet, lensCacheKey, shoppingCacheKey } from "./cache";
import { getVisualSearchConfig, type VisualSearchConfig } from "./config";
import {
  dataForSeoShopping,
  searchApiLens,
  serpApiLens,
  serpApiShopping,
} from "./providers";
import { buildSearchQueries } from "./queryBuilder";
import { rankCandidates } from "./rank";
import { decodeImageDataUrl, uploadFramePublic } from "./storage";
import type {
  EnrichedItem,
  FallbackResult,
  PurchaseLink,
  RankedCandidate,
  VisualCandidate,
  VisualCandidateSource,
  VisualMatch,
  VisualSearchOutcome,
} from "./types";

/**
 * Visual Matching Engine — pipeline de reverse image shopping:
 *
 *   PASO 0  Caché por hash de imagen / query (prioridad 0, coste cero).
 *   PASO 1  Reverse image search real del frame (SearchAPI Lens → SerpAPI Lens).
 *   PASO 2  Queries multi-idioma generadas de la evidencia visual del item.
 *   PASO 3  Shopping por texto (SerpAPI Google Shopping → DataForSEO).
 *   PASO 4  Dedupe + re-ranking por coincidencia visual + tiendas fiables.
 *
 * Todo es best-effort: si un motor falla o no hay presupuesto, el item
 * conserva los deep-links actuales como fallback.
 */

/** Score mínimo para considerar que hay un match real que enseñar. */
const MIN_MATCH_SCORE = 35;
/** Score bajo → adjuntamos fallback_results con las queries usadas. */
const WEAK_MATCH_SCORE = 70;
const MAX_PURCHASE_LINKS = 4;
const MAX_RANKED_CANDIDATES = 8;

export type EnrichmentResult = {
  items: EnrichedItem[];
  outcome: VisualSearchOutcome | null;
};

async function runLensSearch(
  imageDataUrl: string,
  config: VisualSearchConfig,
  outcome: VisualSearchOutcome
): Promise<VisualCandidate[]> {
  const cached = await cacheGet(lensCacheKey(outcome.imageHash));
  if (cached) {
    outcome.lensFromCache = true;
    trackCacheHit();
    return cached;
  }
  if (config.maxLensSearchesPerImage < 1) return [];

  const image = decodeImageDataUrl(imageDataUrl);
  if (!image) return [];
  const frameUrl = await uploadFramePublic(image, config);
  if (!frameUrl) {
    outcome.warnings.push(
      "No se pudo publicar el frame (Supabase Storage): reverse image search omitida."
    );
    return [];
  }
  outcome.frameImageUrl = frameUrl;

  let candidates: VisualCandidate[] = [];
  if (config.searchApiKey) {
    candidates = await searchApiLens(frameUrl, config);
    outcome.enginesUsed.push("searchapi_google_lens");
    trackLensSearch(config.costPerLensSearchUsd);
  }
  if (candidates.length === 0 && config.serpApiKey) {
    candidates = await serpApiLens(frameUrl, config);
    outcome.enginesUsed.push("serpapi_google_lens");
    trackLensSearch(config.costPerShoppingSearchUsd);
  }
  if (candidates.length > 0) {
    await cacheSet(
      lensCacheKey(outcome.imageHash),
      candidates[0].source,
      candidates,
      config.cacheTtlDays
    );
  }
  return candidates;
}

type ShoppingEngine = {
  source: VisualCandidateSource;
  run: (q: string, c: VisualSearchConfig) => Promise<VisualCandidate[]>;
  cost: (c: VisualSearchConfig) => number;
};

const SHOPPING_ENGINES: ShoppingEngine[] = [
  {
    source: "serpapi_google_shopping",
    run: serpApiShopping,
    cost: (c) => c.costPerShoppingSearchUsd,
  },
  {
    source: "dataforseo_google_shopping",
    run: dataForSeoShopping,
    cost: (c) => c.costPerDataForSeoSearchUsd,
  },
];

function availableShoppingEngines(config: VisualSearchConfig): ShoppingEngine[] {
  return SHOPPING_ENGINES.filter((e) =>
    e.source === "serpapi_google_shopping" ? Boolean(config.serpApiKey) : Boolean(config.dataForSeo)
  );
}

/**
 * Búsqueda shopping por texto con caché y presupuesto compartido por frame.
 * Alterna motores entre queries para diversificar cobertura sin duplicar coste.
 */
async function runShoppingSearches(
  queries: string[],
  config: VisualSearchConfig,
  budget: { remaining: number },
  outcome: VisualSearchOutcome
): Promise<Map<string, VisualCandidate[]>> {
  const engines = availableShoppingEngines(config);
  const results = new Map<string, VisualCandidate[]>();
  if (engines.length === 0) return results;

  let engineIdx = 0;
  for (const query of queries) {
    const engine = engines[engineIdx % engines.length];
    const key = shoppingCacheKey(engine.source, query);
    const cached = await cacheGet(key);
    if (cached) {
      trackCacheHit();
      results.set(query, cached);
      engineIdx++;
      continue;
    }
    if (budget.remaining <= 0) break;
    budget.remaining--;
    const found = await engine.run(query, config);
    if (!outcome.enginesUsed.includes(engine.source)) {
      outcome.enginesUsed.push(engine.source);
    }
    trackShoppingSearch(engine.cost(config));
    if (found.length > 0) {
      await cacheSet(key, engine.source, found, config.cacheTtlDays);
    }
    results.set(query, found);
    engineIdx++;
  }
  return results;
}

function buildPurchaseLinks(ranked: RankedCandidate[]): PurchaseLink[] {
  const links: PurchaseLink[] = [];
  const seenStores = new Set<string>();
  for (const c of ranked) {
    const store = c.store ?? c.domain ?? "Tienda";
    const storeKey = store.toLowerCase();
    if (seenStores.has(storeKey)) continue;
    // No enseñamos tiendas desconocidas con score negativo neto.
    if (c.score < 0) continue;
    seenStores.add(storeKey);
    links.push({
      store,
      url: c.link,
      type: c.matchType === "similar" ? "search" : "exact",
      price: c.price,
      currency: c.currency,
    });
    if (links.length >= MAX_PURCHASE_LINKS) break;
  }
  return links;
}

function buildVisualMatch(
  item: DetectedItem,
  ranked: RankedCandidate[]
): VisualMatch | null {
  const best = ranked[0];
  if (!best || best.score < MIN_MATCH_SCORE) return null;
  return {
    exact_match_found: best.matchType !== "similar",
    match_type: best.matchType,
    product_name: best.title,
    brand: best.brand ?? item.visible_brand ?? item.brand_guess ?? null,
    color: item.color ?? null,
    product_images: ranked
      .slice(0, MAX_RANKED_CANDIDATES)
      .map((c) => c.imageUrl)
      .filter((u): u is string => Boolean(u))
      .slice(0, 4),
    purchase_links: buildPurchaseLinks(ranked),
    best_match_score: Math.round(best.score),
    best_match_source: best.source,
    ranked_candidates: ranked.slice(0, MAX_RANKED_CANDIDATES),
  };
}

/**
 * Enriquecer un análisis de visión con matches visuales reales.
 * Nunca lanza: ante cualquier fallo devuelve los items originales.
 */
export async function enrichAnalysisWithVisualMatches(
  imageDataUrl: string,
  analysis: FrameAnalysis
): Promise<EnrichmentResult> {
  const config = getVisualSearchConfig();
  if (!config.enabled || analysis.items.length === 0) {
    return { items: analysis.items, outcome: null };
  }

  const image = decodeImageDataUrl(imageDataUrl);
  if (!image) return { items: analysis.items, outcome: null };

  const outcome: VisualSearchOutcome = {
    imageHash: image.hash,
    frameImageUrl: null,
    lensCandidates: [],
    lensFromCache: false,
    enginesUsed: [],
    warnings: [],
  };

  try {
    // PASO 1/0 — reverse image search del frame (con caché por hash).
    outcome.lensCandidates = await runLensSearch(imageDataUrl, config, outcome);

    // PASO 2/3 — queries + shopping para los items más fiables, con
    // presupuesto de llamadas compartido por frame.
    const budget = { remaining: config.maxShoppingSearchesPerImage };
    const enriched: EnrichedItem[] = [];

    for (const item of analysis.items) {
      const queries = buildSearchQueries(item, config.maxQueriesPerItem);
      // Se llama incluso sin presupuesto: los hits de caché no cuestan.
      const shoppingResults =
        queries.length > 0
          ? await runShoppingSearches(queries, config, budget, outcome)
          : new Map<string, VisualCandidate[]>();

      const shoppingCandidates = [...shoppingResults.values()].flat();

      // PASO 4 — dedupe + re-ranking (Lens del frame + shopping del item).
      const ranked = rankCandidates(
        [...outcome.lensCandidates, ...shoppingCandidates],
        item
      );
      const visualMatch = buildVisualMatch(item, ranked);

      // Fallback: sin match fuerte, exponemos qué devolvió cada query.
      let fallbackResults: FallbackResult[] | undefined;
      if (!visualMatch || visualMatch.best_match_score < WEAK_MATCH_SCORE) {
        fallbackResults = [...shoppingResults.entries()]
          .filter(([, results]) => results.length > 0)
          .map(([query_used, results]) => ({
            query_used,
            results: results.slice(0, 5),
          }));
      }

      enriched.push({
        ...item,
        visual_match: visualMatch,
        fallback_results: fallbackResults,
      });
    }

    return { items: enriched, outcome };
  } catch (err) {
    console.warn("[visualSearch] Engine falló; se mantienen deep-links:", err);
    outcome.warnings.push(err instanceof Error ? err.message : "Error desconocido");
    return { items: analysis.items, outcome };
  }
}
