import type { BoundingBox } from "@/lib/types";

/** De dónde procede el frame analizado. */
export type FrameSourceType =
  | "uploaded"
  | "youtube"
  | "screen_capture"
  | "external_url"
  | "dailymotion"
  | "vimeo"
  | "direct_mp4"
  | "hls"
  | "image_upload";

/** Tipo de media (vídeo, imagen estática, captura de pantalla). */
export type MediaType = "video" | "image" | "screen_capture";

/**
 * Ciclo de vida de un elemento detectado.
 *
 * La distinción importa: una DETECCIÓN guardada no es un producto del catálogo,
 * y un resultado de Internet guardado como candidato no es un producto
 * validado. Con un único `matched` para todo, la UI contaba detecciones
 * visuales como productos del catálogo confirmados.
 *
 *   detected            → detección guardada, sin producto asociado
 *   catalog_matched     → producto del catálogo propio por encima del umbral
 *   external_candidate  → resultado externo guardado como candidato, SIN validar
 *   review_required     → necesita revisión humana
 *   approved            → revisado y aceptado por una persona
 *   published           → publicado como producto del catálogo
 *   ignored             → descartado
 *
 * `matched` y `reviewed` son LEGADO (filas anteriores a la distinción). No se
 * escriben nuevos; ver db/migrations/20260731000009_item_lifecycle_states.sql.
 */
export type ItemStatus =
  | "detected"
  | "catalog_matched"
  | "external_candidate"
  | "review_required"
  | "approved"
  | "published"
  | "ignored"
  | "reviewed"
  | "matched";

/** Estados vigentes, en orden de avance del ciclo de vida. */
export const ITEM_LIFECYCLE: readonly ItemStatus[] = [
  "detected",
  "catalog_matched",
  "external_candidate",
  "review_required",
  "approved",
  "published",
] as const;

/** Estados que NO representan un producto validado del catálogo. */
const UNVALIDATED_STATUSES = new Set<ItemStatus>([
  "detected",
  "external_candidate",
  "review_required",
]);

/**
 * ¿Este elemento representa un producto REAL del catálogo, confirmado?
 *
 * Es la pregunta que la UI tiene que hacerse antes de decir "guardado en el
 * catálogo": una detección sin producto asociado, o un candidato externo sin
 * revisar, no cuentan.
 */
export function isValidatedCatalogProduct(status: ItemStatus): boolean {
  return !UNVALIDATED_STATUSES.has(status) && status !== "ignored";
}

/** Estado del análisis de un frame. */
export type AnalysisStatus = "pending" | "completed" | "failed";

/** Tipo grueso del objeto (bucket de alto nivel sobre la categoría). */
export type ItemType =
  | "clothing"
  | "footwear"
  | "accessory"
  | "electronics"
  | "home"
  | "beauty"
  | "other";

/** Acción de feedback del usuario. */
export type FeedbackAction =
  | "clicked"
  | "saved"
  | "rejected"
  | "purchased"
  | "ignored";

// --- Filas persistidas (camelCase) -----------------------------------------

export type VideoSource = {
  id: string;
  title: string | null;
  url: string | null;
  sourceType: FrameSourceType;
  externalKey: string;
  durationSeconds: number | null;
  mediaType: MediaType;
  provider: string;
  embedUrl: string | null;
  normalizedUrl: string | null;
  canEmbed: boolean;
  canCaptureFrame: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AnalyzedFrame = {
  id: string;
  videoId: string;
  timestampSeconds: number;
  imageUrl: string | null;
  thumbDataUrl: string | null;
  sceneSummary: string | null;
  styleVibe: string | null;
  analysisStatus: AnalysisStatus;
  sourceType: FrameSourceType | null;
  rawVisionResponse: unknown;
  createdAt: string;
};

export type CatalogItem = {
  id: string;
  videoId: string;
  frameId: string | null;
  sourceType: FrameSourceType | null;
  sourceUrl: string | null;
  timestampSeconds: number;
  timestampBucket: number;
  fingerprint: string;
  type: ItemType | null;
  category: string;
  subcategory: string | null;
  name: string;
  description: string | null;
  color: string | null;
  secondaryColors: string[];
  style: string | null;
  pattern: string | null;
  materialGuess: string | null;
  genderFit: string | null;
  visibleBrand: string | null;
  confidence: number;
  searchQuery: string | null;
  marketplaceKeywords: string[];
  boundingBox: BoundingBox | null;
  imageCropUrl: string | null;
  frameImageUrl: string | null;
  status: ItemStatus;
  detectionCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Tipo de coincidencia visual del motor de matching. */
export type RecommendationMatchType = "exact" | "near_exact" | "similar";

export type ProductRecommendation = {
  id: string;
  detectedItemId: string;
  provider: string;
  title: string;
  productUrl: string;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  brand: string | null;
  similarityScore: number | null;
  matchType: RecommendationMatchType | null;
  reason: string | null;
  createdAt: string;
};

export type ItemFeedback = {
  id: string;
  detectedItemId: string;
  recommendationId: string | null;
  action: FeedbackAction;
  createdAt: string;
};

// --- Entradas (lo que se inserta, sin ids ni timestamps) -------------------

export type VideoSourceInput = {
  externalKey: string;
  sourceType: FrameSourceType;
  title?: string | null;
  url?: string | null;
  durationSeconds?: number | null;
  mediaType?: MediaType;
  provider?: string;
  embedUrl?: string | null;
  normalizedUrl?: string | null;
  canEmbed?: boolean;
  canCaptureFrame?: boolean;
};

export type AnalyzedFrameInput = {
  videoId: string;
  timestampSeconds: number;
  sourceType?: FrameSourceType | null;
  imageUrl?: string | null;
  thumbDataUrl?: string | null;
  sceneSummary?: string | null;
  styleVibe?: string | null;
  analysisStatus?: AnalysisStatus;
  rawVisionResponse?: unknown;
};

/** Elemento normalizado listo para persistir (ver normalizeDetectedItem). */
export type DetectedItemInput = {
  videoId: string;
  frameId: string | null;
  sourceType: FrameSourceType | null;
  sourceUrl: string | null;
  timestampSeconds: number;
  timestampBucket: number;
  fingerprint: string;
  type: ItemType | null;
  category: string;
  subcategory: string | null;
  name: string;
  description: string | null;
  color: string | null;
  secondaryColors: string[];
  style: string | null;
  pattern: string | null;
  materialGuess: string | null;
  genderFit: string | null;
  visibleBrand: string | null;
  confidence: number;
  searchQuery: string | null;
  marketplaceKeywords: string[];
  boundingBox: BoundingBox | null;
  imageCropUrl: string | null;
  frameImageUrl: string | null;
};

export type RecommendationInput = {
  provider: string;
  title: string;
  productUrl: string;
  imageUrl?: string | null;
  price?: number | null;
  currency?: string | null;
  brand?: string | null;
  similarityScore?: number | null;
  matchType?: RecommendationMatchType | null;
  reason?: string | null;
};

export type FeedbackInput = {
  detectedItemId: string;
  recommendationId?: string | null;
  action: FeedbackAction;
};

// --- Filtros de listado ----------------------------------------------------

export type CatalogFilters = {
  category?: string;
  color?: string;
  type?: string;
  videoId?: string;
  status?: ItemStatus;
  q?: string;
  /** Filtra por source_type del item (youtube, dailymotion, image_upload, etc.) */
  sourceType?: string;
  limit?: number;
  offset?: number;
};

export type CatalogItemWithRecommendations = CatalogItem & {
  recommendations: ProductRecommendation[];
};

/**
 * Estado derivado de la persistencia de la imagen detectada (no es columna):
 *  - none                  → sin crop todavía
 *  - local_only            → crop en data URL (Storage no disponible)
 *  - pending_database_sync → crop subido a Storage, fila solo en memoria
 *  - synced                → crop en Storage y fila en Postgres
 */
export type ImagePersistenceStatus =
  | "none"
  | "local_only"
  | "pending_database_sync"
  | "synced";

/** Item del listado del catálogo, enriquecido para la UI de tarjetas. */
export type CatalogListItem = CatalogItem & {
  /** Mejor recomendación (mayor similarityScore) — imagen del producto encontrado. */
  bestMatch: ProductRecommendation | null;
  imagePersistenceStatus: ImagePersistenceStatus;
};

/** Campos editables vía PATCH /api/catalog/items/:id. */
export type ItemPatch = Partial<
  Pick<
    CatalogItem,
    | "status"
    | "name"
    | "category"
    | "subcategory"
    | "type"
    | "color"
    | "style"
    | "pattern"
    | "materialGuess"
    | "genderFit"
    | "visibleBrand"
    | "searchQuery"
    | "imageCropUrl"
    | "frameImageUrl"
  >
>;

/** Resultado de persistir un item: la fila y si fue nuevo o un duplicado. */
export type UpsertResult = {
  item: CatalogItem;
  created: boolean;
};
