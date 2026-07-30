import type { MatchingMode } from "./types";

/**
 * Configuración de los modos de matching (catálogo propio ⇄ pipeline externo).
 *
 * El default es "external-only" A PROPÓSITO: si la variable no está definida,
 * el comportamiento actual de la app no cambia por sorpresa. El .env.example
 * recomienda "catalog-first" para cuando el servicio de catálogo esté vivo.
 */

const MATCHING_MODES: readonly MatchingMode[] = [
  "catalog-only",
  "catalog-first",
  "external-only",
  "hybrid",
];

export function isMatchingMode(v: unknown): v is MatchingMode {
  return typeof v === "string" && (MATCHING_MODES as readonly string[]).includes(v);
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

export type MatchingConfig = {
  mode: MatchingMode;
  /** Identificador del motor integrado; se conserva por compatibilidad diagnóstica. */
  catalogServiceUrl: string;
  /** API key para el header x-api-key (null = sin auth configurada). */
  catalogServiceApiKey: string | null;
  /** Umbral de finalScore para considerar fiable un match del catálogo. */
  catalogMatchMinScore: number;
  catalogMatchTopK: number;
  catalogRequestTimeoutMs: number;
  /** catalog-first: si el catálogo no resuelve, ¿se cae al pipeline externo? */
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
  const rawMode = env.PRODUCT_MATCHING_MODE?.trim();
  return {
    // Valor desconocido → external-only (comportamiento actual, nunca romper).
    mode: isMatchingMode(rawMode) ? rawMode : "external-only",
    catalogServiceUrl: (env.CATALOG_SERVICE_URL?.trim() || "http://localhost:4100")
      .replace(/\/$/, ""),
    catalogServiceApiKey: env.CATALOG_SERVICE_API_KEY?.trim() || null,
    catalogMatchMinScore: score01(env.CATALOG_MATCH_MIN_SCORE, 0.82),
    catalogMatchTopK: Math.floor(num(env.CATALOG_MATCH_TOP_K, 10)),
    catalogRequestTimeoutMs: num(env.CATALOG_REQUEST_TIMEOUT_MS, 5000),
    catalogExternalFallback: bool(env.CATALOG_EXTERNAL_FALLBACK, true),
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
