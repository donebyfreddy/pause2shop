import type {
  AnalyzedFrame,
  AnalyzedFrameInput,
  CatalogFilters,
  CatalogItem,
  CatalogItemWithRecommendations,
  DetectedItemInput,
  FeedbackInput,
  ItemFeedback,
  ItemPatch,
  ProductRecommendation,
  RecommendationInput,
  UpsertResult,
  VideoSource,
  VideoSourceInput,
} from "./types";

/**
 * Contrato del catálogo. Hay dos implementaciones:
 *  - PostgresCatalogRepository (producción: Postgres / Supabase)
 *  - MemoryCatalogRepository (fallback sin DATABASE_URL + tests)
 *
 * La elección la hace lib/catalog/index.ts según haya o no DATABASE_URL.
 */
export interface CatalogRepository {
  /** Crea o reutiliza la fuente de vídeo por su clave natural (externalKey). */
  upsertVideoSource(input: VideoSourceInput): Promise<VideoSource>;
  listVideos(): Promise<VideoSource[]>;

  createFrame(input: AnalyzedFrameInput): Promise<AnalyzedFrame>;
  listFramesByVideo(videoId: string): Promise<AnalyzedFrame[]>;

  /**
   * Inserta el item o, si ya existe su fingerprint, actualiza el existente
   * (deduplicación). Devuelve la fila y si fue creación o no.
   */
  upsertDetectedItem(input: DetectedItemInput): Promise<UpsertResult>;
  listItems(
    filters: CatalogFilters
  ): Promise<{ items: CatalogItem[]; total: number }>;
  getItem(id: string): Promise<CatalogItemWithRecommendations | null>;
  updateItem(id: string, patch: ItemPatch): Promise<CatalogItem | null>;

  /** Reemplaza las recomendaciones de un item por un nuevo conjunto. */
  replaceRecommendations(
    itemId: string,
    recs: RecommendationInput[]
  ): Promise<ProductRecommendation[]>;
  listRecommendations(itemId: string): Promise<ProductRecommendation[]>;

  addFeedback(input: FeedbackInput): Promise<ItemFeedback>;
}
