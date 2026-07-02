import type { DetectedItem } from "@/lib/types";

/** De qué motor procede un candidato. */
export type VisualCandidateSource =
  | "searchapi_google_lens"
  | "serpapi_google_lens"
  | "serpapi_google_shopping"
  | "dataforseo_google_shopping";

/**
 * Candidato normalizado devuelto por cualquier motor (Lens o Shopping).
 * Todos los providers convergen a esta forma antes del re-ranking.
 */
export type VisualCandidate = {
  source: VisualCandidateSource;
  title: string;
  /** URL del producto o de la página del comercio. */
  link: string;
  /** Nombre del comercio tal y como lo reporta el motor ("Amazon.es", "Zalando"...). */
  store: string | null;
  /** Dominio extraído del link (para reputación de tienda). */
  domain: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  brand: string | null;
  /** Posición en los resultados del motor (1 = primero). */
  position: number | null;
  /** true si el motor lo marcó como coincidencia exacta de imagen. */
  exactImageMatch: boolean;
  /** Query de texto usada (null en reverse image search). */
  queryUsed: string | null;
};

export type MatchType = "exact" | "near_exact" | "similar";

export type PurchaseLink = {
  store: string;
  url: string;
  type: "exact" | "search";
  price: number | null;
  currency: string | null;
};

/**
 * Resultado final del Visual Matching Engine para un item detectado.
 * Es el contrato que consume la UI (y que pide la spec del producto).
 */
export type VisualMatch = {
  exact_match_found: boolean;
  match_type: MatchType;
  product_name: string;
  brand: string | null;
  color: string | null;
  product_images: string[];
  purchase_links: PurchaseLink[];
  best_match_score: number;
  /** Motor que aportó el mejor resultado. */
  best_match_source: VisualCandidateSource;
  /** Top candidatos rankeados (para depuración/UI extendida). */
  ranked_candidates: RankedCandidate[];
};

export type RankedCandidate = VisualCandidate & {
  score: number;
  matchType: MatchType;
  scoreBreakdown: Record<string, number>;
};

/** Resultados de queries alternativas cuando no hubo match fuerte. */
export type FallbackResult = {
  query_used: string;
  results: VisualCandidate[];
};

/** Resultado global del engine para un frame. */
export type VisualSearchOutcome = {
  /** Hash sha256 del frame (clave de caché). */
  imageHash: string;
  /** URL pública del frame subido (si hubo upload). */
  frameImageUrl: string | null;
  /** Candidatos de Lens sobre el frame completo. */
  lensCandidates: VisualCandidate[];
  /** true si Lens vino de caché (sin coste). */
  lensFromCache: boolean;
  /** Motores consultados en esta pasada. */
  enginesUsed: VisualCandidateSource[];
  warnings: string[];
};

/** Item enriquecido: alias de conveniencia. */
export type EnrichedItem = DetectedItem & {
  visual_match?: VisualMatch | null;
  fallback_results?: FallbackResult[];
};
