import type { DetectedItem, VideoAnalysisConfig } from "@/lib/types";

/**
 * Contratos del sistema de matching intercambiable (catálogo propio vs.
 * pipeline externo). Los providers existentes (OpenAI/SearchAPI/SerpAPI/
 * DataForSEO) NO se tocan: aquí solo se define la interfaz común que permite
 * elegir estrategia por configuración sin cambiar el pipeline actual.
 */

export type MatchingMode =
  | "catalog-only"
  | "catalog-first"
  | "external-only"
  | "hybrid";

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
};

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
