import type { CatalogRepository } from "./repository";
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

/** Tras un fallo de Postgres, cuánto tiempo se usa memoria antes de reintentar. */
const RETRY_AFTER_MS = 30_000;

export type PersistenceMode = "postgres" | "memory" | "memory_fallback";

/**
 * Envuelve el repositorio Postgres con un circuit breaker: si una operación
 * falla (DB caída, timeout, credenciales), la resuelve contra el repositorio
 * en memoria y deja de intentar Postgres durante RETRY_AFTER_MS. Así la demo
 * nunca se congela ni pierde el análisis por culpa de la base de datos — como
 * mucho paga UN timeout, no uno por operación.
 */
export class ResilientCatalogRepository implements CatalogRepository {
  private brokenUntil = 0;
  private lastErrorMessage: string | null = null;

  constructor(
    private readonly primary: CatalogRepository,
    private readonly fallback: CatalogRepository
  ) {}

  /** Estado actual: postgres sano o degradado a memoria. */
  get mode(): PersistenceMode {
    return Date.now() < this.brokenUntil ? "memory_fallback" : "postgres";
  }

  get lastError(): string | null {
    return this.lastErrorMessage;
  }

  private async run<T>(op: (repo: CatalogRepository) => Promise<T>): Promise<T> {
    if (Date.now() < this.brokenUntil) {
      return op(this.fallback);
    }
    try {
      const result = await op(this.primary);
      this.lastErrorMessage = null;
      return result;
    } catch (err) {
      this.brokenUntil = Date.now() + RETRY_AFTER_MS;
      this.lastErrorMessage = err instanceof Error ? err.message : String(err);
      console.warn(
        `[catalog] Postgres falló (${this.lastErrorMessage}). ` +
          `Usando memoria durante ${RETRY_AFTER_MS / 1000}s.`
      );
      return op(this.fallback);
    }
  }

  upsertVideoSource(input: VideoSourceInput): Promise<VideoSource> {
    return this.run((r) => r.upsertVideoSource(input));
  }
  listVideos(): Promise<VideoSource[]> {
    return this.run((r) => r.listVideos());
  }
  createFrame(input: AnalyzedFrameInput): Promise<AnalyzedFrame> {
    return this.run((r) => r.createFrame(input));
  }
  listFramesByVideo(videoId: string): Promise<AnalyzedFrame[]> {
    return this.run((r) => r.listFramesByVideo(videoId));
  }
  upsertDetectedItem(input: DetectedItemInput): Promise<UpsertResult> {
    return this.run((r) => r.upsertDetectedItem(input));
  }
  listItems(
    filters: CatalogFilters
  ): Promise<{ items: CatalogItem[]; total: number }> {
    return this.run((r) => r.listItems(filters));
  }
  getItem(id: string): Promise<CatalogItemWithRecommendations | null> {
    return this.run((r) => r.getItem(id));
  }
  updateItem(id: string, patch: ItemPatch): Promise<CatalogItem | null> {
    return this.run((r) => r.updateItem(id, patch));
  }
  replaceRecommendations(
    itemId: string,
    recs: RecommendationInput[]
  ): Promise<ProductRecommendation[]> {
    return this.run((r) => r.replaceRecommendations(itemId, recs));
  }
  listRecommendations(itemId: string): Promise<ProductRecommendation[]> {
    return this.run((r) => r.listRecommendations(itemId));
  }
  listTopRecommendations(
    itemIds: string[]
  ): Promise<Map<string, ProductRecommendation>> {
    return this.run((r) => r.listTopRecommendations(itemIds));
  }
  addFeedback(input: FeedbackInput): Promise<ItemFeedback> {
    return this.run((r) => r.addFeedback(input));
  }
}
