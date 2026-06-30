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

export type DetectedItem = {
  name: string;
  category: string;
  subcategory?: string;
  color?: string;
  visible_brand?: string | null;
  style?: string;
  description: string;
  search_query_es: string;
  alternative_queries: string[];
  verified_provider_queries: string[];
  confidence: number;
  bounding_box?: BoundingBox | null;
  why_recommended?: string;
  productLinks?: ProductLink[];
  score?: number;

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
