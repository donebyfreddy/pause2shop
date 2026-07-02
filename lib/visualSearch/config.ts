/**
 * Configuración del Visual Matching Engine leída de variables de entorno.
 * Todos los motores son opcionales: el engine usa los que estén configurados
 * y degrada con elegancia (Lens → Shopping → deep-links actuales).
 */

function bool(v: string | undefined, fallback = false): boolean {
  if (v == null || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type VisualSearchConfig = {
  enabled: boolean;
  /** SearchAPI.io Google Lens (prioridad 1 si hay key). */
  searchApiKey: string | null;
  /** SerpAPI (Google Lens y Google Shopping). */
  serpApiKey: string | null;
  /** DataForSEO (Google Shopping). */
  dataForSeo: { username: string; password: string } | null;
  /** País/idioma para los motores. */
  country: string;
  language: string;
  /** Presupuesto por análisis de frame. */
  maxLensSearchesPerImage: number;
  maxShoppingSearchesPerImage: number;
  maxQueriesPerItem: number;
  /** TTL de la caché de resultados. */
  cacheTtlDays: number;
  cacheEnabled: boolean;
  /** Costes estimados por llamada (para el cost tracker). */
  costPerLensSearchUsd: number;
  costPerShoppingSearchUsd: number;
  costPerDataForSeoSearchUsd: number;
  /** Supabase Storage para publicar el frame (requisito de Lens). */
  storage: {
    supabaseUrl: string;
    serviceRoleKey: string;
    bucket: string;
  } | null;
};

export function getVisualSearchConfig(
  env: NodeJS.ProcessEnv = process.env
): VisualSearchConfig {
  const searchApiKey = env.SEARCHAPI_API_KEY?.trim() || null;
  const serpApiKey = (env.SERPAPI_API_KEY || env.SERPAPI_KEY)?.trim() || null;
  const dfsUser = env.DATAFORSEO_USERNAME?.trim();
  const dfsPass = env.DATAFORSEO_PASSWORD?.trim();
  const dataForSeo =
    bool(env.ENABLE_DATAFORSEO, true) && dfsUser && dfsPass
      ? { username: dfsUser, password: dfsPass }
      : null;

  const supabaseUrl = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = env.STORAGE_BUCKET?.trim() || "frames";
  const storage =
    supabaseUrl && serviceRoleKey
      ? { supabaseUrl: supabaseUrl.replace(/\/$/, ""), serviceRoleKey, bucket }
      : null;

  return {
    enabled:
      bool(env.ENABLE_VISUAL_SEARCH, true) &&
      Boolean(searchApiKey || serpApiKey || dataForSeo),
    searchApiKey,
    serpApiKey,
    dataForSeo,
    country: env.SEARCHAPI_COUNTRY?.trim() || "es",
    language: env.SEARCHAPI_LANGUAGE?.trim() || "es",
    maxLensSearchesPerImage: num(env.MAX_VISUAL_SEARCHES_PER_IMAGE, 1),
    maxShoppingSearchesPerImage: num(env.MAX_SHOPPING_SEARCHES_PER_IMAGE, 3),
    maxQueriesPerItem: 2,
    cacheTtlDays: num(env.PRODUCT_SEARCH_CACHE_TTL_DAYS, 7),
    cacheEnabled: bool(env.ENABLE_PRODUCT_CACHE, true),
    costPerLensSearchUsd: num(env.SEARCHAPI_COST_PER_SEARCH_USD, 0.01),
    costPerShoppingSearchUsd: num(env.SERPAPI_COST_PER_SEARCH_USD, 0.01),
    costPerDataForSeoSearchUsd: num(
      env.DATAFORSEO_SERP_LIVE_COST_USD,
      0.002
    ),
    storage,
  };
}
