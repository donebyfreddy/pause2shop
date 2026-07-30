// Solo tipos: el ciclo con visualSearch/types se borra en compilación.
import type { FallbackResult, VisualMatch } from "./visualSearch/types";

export type TrustLevel = "high" | "medium";

export type ProductLinkType =
  | "marketplace"
  | "verified_store"
  | "shopping_search";

export type ProductLink = {
  provider: string;
  type: ProductLinkType;
  url: string;
  label: string;
  trustLevel: TrustLevel;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Relación del producto con la persona (modo person-centric). */
export type ProductRelationship =
  | "worn"
  | "held"
  | "used"
  | "near_person"
  | "background";

/** Categorías seleccionables antes de analizar un vídeo. */
export type AnalysisCategory =
  | "clothing"
  | "footwear"
  | "watches_jewelry"
  | "bags_accessories"
  | "electronics"
  | "vehicles"
  | "furniture_home"
  | "decoration"
  | "all";

export type AnalysisIntensity = "fast" | "standard" | "exhaustive";

/**
 * Configuración de un run de análisis elegida por el usuario ANTES de analizar.
 * Se propaga al backend (no se lee solo del estado visual) y gobierna el prompt,
 * el filtro de categorías, el tracking, el enrichment y la UI.
 */
export type VideoAnalysisConfig = {
  categories: AnalysisCategory[];
  analysisIntensity: AnalysisIntensity;
  /** true ⇒ prioriza lo que llevan/sostienen las personas y rechaza el fondo. */
  personCentric: boolean;
  /** true ⇒ permite lanzar reverse image search por producto único. */
  reverseImageSearch: boolean;
};

export type DetectedItem = {
  name: string;
  category: string;
  subcategory?: string;
  /** worn/held/used/near_person/background — prioridad person-centric. */
  relationship?: ProductRelationship;
  /** Índice de la persona a la que está asociado (0-based), o null. */
  person_index?: number | null;
  /** 0-1: fuerza de la asociación con la persona (worn≈1, background≈0.15). */
  person_association_score?: number;
  color?: string;
  visible_brand?: string | null;
  brand_guess?: string | null;
  logo_visible?: boolean;
  logo_description?: string | null;
  visible_text?: string | null;
  style?: string;
  description: string;
  search_query_es: string;
  alternative_queries: string[];
  verified_provider_queries: string[];
  confidence: number;
  /** 0-1: interés de compra estimado del objeto para un espectador. */
  purchase_relevance?: number;
  /** Evidencia concreta que respalda visible_brand/brand_guess, o null. */
  brand_evidence?: string | null;
  /** Estado de la evidencia de marca (verificada / probable / desconocida). */
  brand_status?: "verified" | "probable" | "unknown";
  /** Modelo/referencia probable del producto (solo con evidencia). */
  model_guess?: string | null;
  model_status?: "verified" | "probable" | "unknown";
  model_evidence?: string | null;
  /** Query refinada por la 2ª pasada del crop (inglés, discriminante). */
  refined_query?: string | null;
  /** Rasgos distintivos útiles para generar queries de búsqueda. */
  distinctive_features?: string[];
  bounding_box?: BoundingBox | null;
  why_recommended?: string;
  productLinks?: ProductLink[];
  score?: number;

  // Estado de matching progresivo (solo cliente).
  matchingStatus?:
    | "pending"
    | "searching"
    | "matched"
    | "similar_only"
    | "no_match"
    | "budget_exhausted"
    | "provider_error";

  // Visual Matching Engine (reverse image shopping). Se rellenan en el
  // servidor cuando hay motores configurados; ver lib/visualSearch/engine.ts.
  visual_match?: VisualMatch | null;
  fallback_results?: FallbackResult[];

  /** Los más similares visualmente (reverse image search), aunque no haya
   * match fiable — es lo que la UI muestra como resultado principal. */
  similar_candidates?: Array<{
    title: string;
    link: string;
    imageUrl: string | null;
    store: string | null;
    price: number | null;
    currency: string | null;
  }>;

  /** Metadatos técnicos del matching (solo cliente; panel de debug). */
  matching_debug?: {
    providerUsed: string | null;
    fallbackUsed: boolean;
    cached: boolean;
    totalMs?: number;
    detail?: string;
  };

  // Session tracking (populated client-side, not from the model).
  seenCount?: number;
  firstSeenAt?: number;
  lastSeenAt?: number;

  // Campos adicionales del esquema de catálogo (opcionales: el modelo puede
  // omitirlos y se derivan/normalizan en lib/catalog/normalize.ts).
  type?: string;
  secondary_colors?: string[];
  pattern?: string;
  material_guess?: string;
  gender_fit?: string;
  marketplace_keywords?: string[];
};

export type FrameAnalysis = {
  summary: string;
  style_vibe: string;
  items: DetectedItem[];
};

export type AnalyzeSuccess = {
  ok: true;
  analysis: FrameAnalysis;
  mock?: boolean;
};

export type AnalyzeError = {
  ok: false;
  error: string;
};

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeError;

/** Styles we know how to reason about for recommendations. */
export type StyleVibe =
  | "streetwear"
  | "luxury"
  | "minimal"
  | "sport"
  | "tech"
  | "gamer"
  | "outdoor"
  | "formal"
  | "casual"
  | "home decor";

/** Lightweight record persisted to localStorage for personalization + history. */
export type HistoryEntry = {
  id: string;
  videoKey: string;
  timestampSeconds: number;
  createdAt: number;
  frameDataUrl?: string;
  analysis: FrameAnalysis;
};

export type Preferences = {
  categoryClicks: Record<string, number>;
  styleClicks: Record<string, number>;
};
