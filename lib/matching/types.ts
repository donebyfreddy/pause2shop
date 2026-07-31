import type { BoundingBox, DetectedItem, VideoAnalysisConfig } from "@/lib/types";

/**
 * Contratos del sistema de matching intercambiable (catálogo propio vs.
 * pipeline externo). Los providers existentes (OpenAI/SearchAPI/SerpAPI/
 * DataForSEO) NO se tocan: aquí solo se define la interfaz común que permite
 * elegir estrategia por configuración sin cambiar el pipeline actual.
 */

/**
 * Fuente de coincidencias elegida por el usuario (o por PRODUCT_MATCHING_MODE).
 *
 * Los valores canónicos usan guion BAJO. Las versiones con guion medio
 * ("catalog-first"…) siguen aceptándose en cualquier frontera de entrada
 * (env, body de la request, columna `matching_mode` ya escrita en Postgres)
 * vía `normalizeMatchingMode`, porque hay despliegues y filas con ese formato.
 */
export type MatchingMode =
  | "catalog_only"
  | "catalog_first"
  | "external_only"
  | "hybrid";

/** Alias público del mismo tipo, con el nombre que usa la UI. */
export type ProductMatchingMode = MatchingMode;

export const MATCHING_MODES: readonly MatchingMode[] = [
  "catalog_only",
  "external_only",
  "catalog_first",
  "hybrid",
] as const;

/** Modo recomendado y por defecto: catálogo primero, externo solo si hace falta. */
export const DEFAULT_MATCHING_MODE: MatchingMode = "catalog_first";

/** Formato legado (guion medio) → canónico. */
const LEGACY_MODE_ALIASES: Record<string, MatchingMode> = {
  "catalog-only": "catalog_only",
  "catalog-first": "catalog_first",
  "external-only": "external_only",
  catalogonly: "catalog_only",
  catalogfirst: "catalog_first",
  externalonly: "external_only",
};

/**
 * Normaliza cualquier entrada a un modo canónico, o `null` si no lo es.
 * Nunca lanza: quien llama decide el fallback (env → DEFAULT_MATCHING_MODE).
 */
export function normalizeMatchingMode(value: unknown): MatchingMode | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if ((MATCHING_MODES as readonly string[]).includes(v)) return v as MatchingMode;
  return LEGACY_MODE_ALIASES[v] ?? null;
}

/** Procedencia de un match: catálogo propio o motores externos. */
export type MatchSource = "catalog" | "external";

/**
 * Etiqueta final del resultado. CATALOG_MATCH/EXTERNAL_MATCH = match fiable
 * (por encima del umbral); SIMILAR = candidatos parecidos pero no fiables;
 * NO_MATCH = nada presentable.
 */
export type MatchLabel =
  | "CATALOG_MATCH"
  | "EXTERNAL_MATCH"
  | "SIMILAR"
  | "NO_MATCH";

/**
 * Fuerza de la afirmación que hacemos sobre el match, para la UI.
 * Nunca se presenta un resultado externo como "exacto" sin evidencia: la
 * clasificación la decide `classifyMatchType` a partir del score y la fuente.
 */
export type MatchType = "exact" | "probable" | "similar";

/** `MatchLabel` → `MatchType` visible, dada la puntuación normalizada 0-1. */
export function classifyMatchType(
  label: MatchLabel,
  finalScore: number,
  source: MatchSource
): MatchType {
  if (label === "SIMILAR" || label === "NO_MATCH") return "similar";
  // El catálogo puede afirmar identidad (es nuestro producto indexado);
  // el externo, con el mismo score, se queda en "probable" salvo score muy alto.
  const exactFloor = source === "catalog" ? 0.9 : 0.95;
  if (finalScore >= exactFloor) return "exact";
  return "probable";
}

/**
 * Scores SEPARADOS por dimensión (0-1, null = la dimensión no aplica o el
 * proveedor no la reporta). Nunca se inventa un score que el motor no dio.
 */
export type MatchScores = {
  /** Confianza de la DETECCIÓN del objeto (≠ confianza de matching). */
  detectionScore: number | null;
  visualScore: number | null;
  textScore: number | null;
  attributeScore: number | null;
  /** Evidencia de marca (solo si brand_status === "verified"). */
  brandEvidenceScore: number | null;
  /** Reputación de la tienda/merchant (solo externo). */
  merchantScore: number | null;
  /** Score combinado 0-1 con el que se rankea y se aplica el umbral. */
  finalScore: number;
};

/** Match normalizado, independiente de si vino del catálogo o de fuera. */
export type NormalizedProductMatch = {
  source: MatchSource;
  /** Id de producto del catálogo (solo source === "catalog"). */
  productId: string | null;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  productUrl: string;
  price: number | null;
  currency: string | null;
  merchant: string | null;
  availability: "in_stock" | "out_of_stock" | "unknown" | null;
  /** Etapa del catálogo que resolvió el match (solo catálogo). */
  matchStage: "exact_hash" | "perceptual_hash" | "embedding" | null;
  /** Proveedor concreto ("catalog", "searchapi_google_lens", …). */
  provider: string;
  /** Categoría del producto según la fuente (null si no la reporta). */
  category: string | null;
  /** Modelo/referencia concreta si la fuente la expone. */
  model: string | null;
  /** Fuerza de la afirmación para la UI (badge Exacto/Probable/Similar). */
  matchType: MatchType;
  scores: MatchScores;
  /** Evidencia legible del match ("✓ La marca coincide", …). */
  evidence: string[];
};

export type ProductMatchingInput = {
  item: DetectedItem;
  /** Crop del objeto como data URL (data:image/...;base64,...). */
  cropDataUrl?: string;
  /** Frame completo como data URL (opcional, para contexto). */
  frameDataUrl?: string;
  /** Configuración del run de análisis elegida por el usuario (opcional). */
  config?: Partial<VideoAnalysisConfig>;
  /** Debug: fuerza búsqueda fresca ignorando la caché del catálogo. */
  skipCache?: boolean;
};

export type ProductMatchingResult = {
  matches: NormalizedProductMatch[];
  matchLabel: MatchLabel;
  /** Proveedor que aportó el resultado final (o null si nadie respondió). */
  providerUsed: string | null;
  /** true si se degradó a otra estrategia (catálogo caído → externo, …). */
  fallbackUsed: boolean;
  cached: boolean;
  timings: Record<string, number>;
  /** Avisos no fatales (catálogo caído, guardado externo fallido, …). */
  warnings?: string[];
  /** Modo con el que se resolvió (lo rellena el orquestador). */
  matchingMode?: MatchingMode;
  /** ¿Se llegó a consultar el catálogo propio? */
  catalogAttempted?: boolean;
  /** ¿Se llegó a consultar el proveedor externo? */
  externalAttempted?: boolean;
  /** true solo cuando el externo se usó COMO fallback del catálogo. */
  externalFallbackUsed?: boolean;
  /** Por qué no hay match presentable (para la UI, no técnico). */
  unresolvedReason?: string;
};

/**
 * Resolución de UNA detección, tal y como la consume el frontend.
 * El frontend NO depende del formato de ningún proveedor: solo de esto.
 */
export type DetectionResolution = {
  detectionId: string;
  label: string;
  boundingBox: BoundingBox | null;
  selectedMatch: NormalizedProductMatch | null;
  candidates: NormalizedProductMatch[];
  matchingMode: MatchingMode;
  catalogAttempted: boolean;
  externalAttempted: boolean;
  externalFallbackUsed: boolean;
  unresolvedReason?: string;
};

/** Contadores de coste/uso de una resolución completa (un análisis). */
export type MatchingUsage = {
  detections: number;
  catalogQueries: number;
  externalCalls: number;
  cacheHits: number;
  fallbacks: number;
  resolvedInternally: number;
  resolvedExternally: number;
  unresolved: number;
  /** Coste externo estimado en USD (0 si no se llamó a ningún proveedor). */
  estimatedExternalCostUsd: number;
  /** Tiempo por resolvedor, en ms. */
  timings: Record<string, number>;
};

export function emptyUsage(): MatchingUsage {
  return {
    detections: 0,
    catalogQueries: 0,
    externalCalls: 0,
    cacheHits: 0,
    fallbacks: 0,
    resolvedInternally: 0,
    resolvedExternally: 0,
    unresolved: 0,
    estimatedExternalCostUsd: 0,
    timings: {},
  };
}

/** Interfaz común de todas las estrategias de matching. Nunca lanza. */
export interface ProductMatchingProvider {
  search(input: ProductMatchingInput): Promise<ProductMatchingResult>;
}

/** Resultado vacío reutilizable: ambos caminos fallaron pero el análisis sigue. */
export function noMatchResult(
  partial: Partial<ProductMatchingResult> = {}
): ProductMatchingResult {
  return {
    matches: [],
    matchLabel: "NO_MATCH",
    providerUsed: null,
    fallbackUsed: false,
    cached: false,
    timings: {},
    ...partial,
  };
}
