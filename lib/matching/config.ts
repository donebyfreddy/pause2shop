import type { MatchingMode } from "./types";
import { DEFAULT_MATCHING_MODE, normalizeMatchingMode } from "./types";

/**
 * Configuración de los modos de matching (catálogo propio ⇄ pipeline externo).
 *
 * El default es "catalog_first": intenta resolver dentro del catálogo propio y
 * solo gasta una llamada externa cuando no hay coincidencia fiable. Es también
 * la opción marcada de serie en la UI, para que backend y UI coincidan.
 */

export function isMatchingMode(v: unknown): v is MatchingMode {
  return normalizeMatchingMode(v) !== null;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Score 0-1: fuera de rango se ignora (vuelve al default). */
function score01(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

const CATEGORY_THRESHOLD_PREFIX = "CATALOG_MATCH_THRESHOLD_";

/**
 * Umbrales por categoría: `CATALOG_MATCH_THRESHOLD_FOOTWEAR=0.9` afina una
 * categoría concreta sin tocar el umbral global. La clave se normaliza a
 * minúsculas para compararla con `item.category`.
 */
function thresholdsByCategory(env: NodeJS.ProcessEnv): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(CATEGORY_THRESHOLD_PREFIX)) continue;
    const category = key.slice(CATEGORY_THRESHOLD_PREFIX.length).toLowerCase();
    if (!category) continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0 && n <= 1) out[category] = n;
  }
  return out;
}

/** Umbral de catálogo aplicable a una categoría concreta. */
export function catalogThresholdFor(
  config: MatchingConfig,
  category: string | null | undefined
): number {
  if (!category) return config.catalogMatchMinScore;
  return (
    config.catalogThresholdByCategory[category.trim().toLowerCase()] ??
    config.catalogMatchMinScore
  );
}

export type MatchingConfig = {
  mode: MatchingMode;
  /** Identificador del motor integrado; se conserva por compatibilidad diagnóstica. */
  catalogServiceUrl: string;
  /** API key para el header x-api-key (null = sin auth configurada). */
  catalogServiceApiKey: string | null;
  /**
   * Umbral de finalScore para considerar fiable un match del CATÁLOGO.
   * `CATALOG_MATCH_THRESHOLD` es el nombre nuevo; `CATALOG_MATCH_MIN_SCORE`
   * se sigue leyendo por compatibilidad con despliegues existentes.
   */
  catalogMatchMinScore: number;
  /** Umbral propio del proveedor EXTERNO (no comparte el del catálogo). */
  externalMatchMinScore: number;
  /** Umbral del ranking combinado en modo comparar (catalog_and_external). */
  hybridMatchMinScore: number;
  /** Umbrales por categoría, opcionales: `CATALOG_MATCH_THRESHOLD_<CATEGORIA>`. */
  catalogThresholdByCategory: Record<string, number>;
  catalogMatchTopK: number;
  /**
   * Cuántos candidatos del catálogo se pintan como alternativas. Es un límite
   * de PRESENTACIÓN: no recorta la búsqueda ni el ranking (eso es topK).
   */
  catalogMatchMaxVisible: number;
  catalogRequestTimeoutMs: number;
  /**
   * ¿Está disponible la búsqueda externa? `false` la desactiva por completo:
   * ni fallback automático ni botón manual. Es el interruptor de operador.
   */
  externalSearchEnabled: boolean;
  /**
   * catalog-first: si el catálogo no resuelve, ¿se cae al pipeline externo
   * AUTOMÁTICAMENTE? Con `false` el catálogo sin match deja el bloque externo
   * en `not_requested` y solo el usuario puede lanzarlo (coste bajo control).
   *
   * `EXTERNAL_SEARCH_AUTOMATIC_FALLBACK` es el nombre nuevo;
   * `CATALOG_EXTERNAL_FALLBACK` se sigue leyendo por compatibilidad.
   */
  catalogExternalFallback: boolean;
  /** ¿Ingerir resultados externos fiables en el catálogo (POST /products/external)? */
  catalogSaveExternalResults: boolean;
  catalogCacheEnabled: boolean;
  catalogCacheTtlSeconds: number;
  /** Enriquecimiento de visión del crop antes de buscar. */
  visionEnrichmentEnabled: boolean;
  /** Modelo del enrichment. Default: el VISION_MODEL existente (no se hardcodea). */
  visionEnrichmentModel: string | null;
  visionEnrichmentMinCropQuality: number;
};

export function getMatchingConfig(
  env: NodeJS.ProcessEnv = process.env
): MatchingConfig {
  return {
    // Valor desconocido o ausente → el modo recomendado (catalog_first).
    mode: normalizeMatchingMode(env.PRODUCT_MATCHING_MODE) ?? DEFAULT_MATCHING_MODE,
    catalogServiceUrl: (env.CATALOG_SERVICE_URL?.trim() || "http://localhost:4100")
      .replace(/\/$/, ""),
    catalogServiceApiKey: env.CATALOG_SERVICE_API_KEY?.trim() || null,
    catalogMatchMinScore: score01(
      env.CATALOG_MATCH_THRESHOLD ?? env.CATALOG_MATCH_MIN_SCORE,
      0.8
    ),
    externalMatchMinScore: score01(env.EXTERNAL_MATCH_THRESHOLD, 0.72),
    hybridMatchMinScore: score01(env.HYBRID_MATCH_THRESHOLD, 0.8),
    catalogThresholdByCategory: thresholdsByCategory(env),
    catalogMatchTopK: Math.floor(num(env.CATALOG_MATCH_TOP_K, 8)),
    catalogMatchMaxVisible: Math.floor(num(env.CATALOG_MATCH_MAX_VISIBLE, 4)),
    catalogRequestTimeoutMs: num(env.CATALOG_REQUEST_TIMEOUT_MS, 5000),
    externalSearchEnabled: bool(env.EXTERNAL_SEARCH_ENABLED, true),
    catalogExternalFallback: bool(
      env.EXTERNAL_SEARCH_AUTOMATIC_FALLBACK ?? env.CATALOG_EXTERNAL_FALLBACK,
      true
    ),
    catalogSaveExternalResults: bool(env.CATALOG_SAVE_EXTERNAL_RESULTS, true),
    catalogCacheEnabled: bool(env.CATALOG_CACHE_ENABLED, true),
    catalogCacheTtlSeconds: num(env.CATALOG_CACHE_TTL_SECONDS, 86_400),
    visionEnrichmentEnabled: bool(env.VISION_ENRICHMENT_ENABLED, true),
    // Reutiliza el modelo de visión ya configurado; jamás un nombre fijo aquí.
    visionEnrichmentModel:
      env.VISION_ENRICHMENT_MODEL?.trim() || env.VISION_MODEL?.trim() || null,
    visionEnrichmentMinCropQuality: score01(
      env.VISION_ENRICHMENT_MIN_CROP_QUALITY,
      0.6
    ),
  };
}
