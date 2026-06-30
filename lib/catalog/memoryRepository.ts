import { normalizeText } from "./normalize";
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

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Repositorio en memoria. Se usa como modo demo (sin DATABASE_URL) y en tests.
 * Reproduce la deduplicación por fingerprint del repositorio Postgres.
 */
export class MemoryCatalogRepository implements CatalogRepository {
  private videos = new Map<string, VideoSource>();
  private videosByKey = new Map<string, string>(); // externalKey -> id
  private frames = new Map<string, AnalyzedFrame>();
  private items = new Map<string, CatalogItem>();
  private itemsByFingerprint = new Map<string, string>(); // fingerprint -> id
  private recs = new Map<string, ProductRecommendation>();
  private feedback = new Map<string, ItemFeedback>();

  async upsertVideoSource(input: VideoSourceInput): Promise<VideoSource> {
    const existingId = this.videosByKey.get(input.externalKey);
    if (existingId) {
      const existing = this.videos.get(existingId)!;
      const updated: VideoSource = {
        ...existing,
        title: input.title ?? existing.title,
        url: input.url ?? existing.url,
        durationSeconds: input.durationSeconds ?? existing.durationSeconds,
        mediaType: input.mediaType ?? existing.mediaType,
        provider: input.provider ?? existing.provider,
        embedUrl: input.embedUrl ?? existing.embedUrl,
        normalizedUrl: input.normalizedUrl ?? existing.normalizedUrl,
        canEmbed: input.canEmbed ?? existing.canEmbed,
        canCaptureFrame: input.canCaptureFrame ?? existing.canCaptureFrame,
        updatedAt: now(),
      };
      this.videos.set(existingId, updated);
      return updated;
    }
    const ts = now();
    const video: VideoSource = {
      id: uuid(),
      title: input.title ?? null,
      url: input.url ?? null,
      sourceType: input.sourceType,
      externalKey: input.externalKey,
      durationSeconds: input.durationSeconds ?? null,
      mediaType: input.mediaType ?? "video",
      provider: input.provider ?? input.sourceType,
      embedUrl: input.embedUrl ?? null,
      normalizedUrl: input.normalizedUrl ?? null,
      canEmbed: input.canEmbed ?? true,
      canCaptureFrame: input.canCaptureFrame ?? false,
      createdAt: ts,
      updatedAt: ts,
    };
    this.videos.set(video.id, video);
    this.videosByKey.set(video.externalKey, video.id);
    return video;
  }

  async listVideos(): Promise<VideoSource[]> {
    return [...this.videos.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  async createFrame(input: AnalyzedFrameInput): Promise<AnalyzedFrame> {
    const frame: AnalyzedFrame = {
      id: uuid(),
      videoId: input.videoId,
      timestampSeconds: input.timestampSeconds,
      imageUrl: input.imageUrl ?? null,
      thumbDataUrl: input.thumbDataUrl ?? null,
      sceneSummary: input.sceneSummary ?? null,
      styleVibe: input.styleVibe ?? null,
      analysisStatus: input.analysisStatus ?? "completed",
      sourceType: input.sourceType ?? null,
      rawVisionResponse: input.rawVisionResponse ?? null,
      createdAt: now(),
    };
    this.frames.set(frame.id, frame);
    return frame;
  }

  async listFramesByVideo(videoId: string): Promise<AnalyzedFrame[]> {
    return [...this.frames.values()]
      .filter((f) => f.videoId === videoId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async upsertDetectedItem(input: DetectedItemInput): Promise<UpsertResult> {
    const existingId = this.itemsByFingerprint.get(input.fingerprint);
    if (existingId) {
      const existing = this.items.get(existingId)!;
      // Dedupe: refresca metadatos y sube el contador. Conserva el status si
      // el usuario ya lo cambió (reviewed/ignored/matched).
      const updated: CatalogItem = {
        ...existing,
        confidence: Math.max(existing.confidence, input.confidence),
        description: input.description ?? existing.description,
        secondaryColors: input.secondaryColors.length
          ? input.secondaryColors
          : existing.secondaryColors,
        marketplaceKeywords: input.marketplaceKeywords.length
          ? input.marketplaceKeywords
          : existing.marketplaceKeywords,
        boundingBox: input.boundingBox ?? existing.boundingBox,
        frameId: input.frameId ?? existing.frameId,
        detectionCount: existing.detectionCount + 1,
        updatedAt: now(),
      };
      this.items.set(existingId, updated);
      return { item: updated, created: false };
    }

    const ts = now();
    const item: CatalogItem = {
      id: uuid(),
      videoId: input.videoId,
      frameId: input.frameId,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      timestampSeconds: input.timestampSeconds,
      timestampBucket: input.timestampBucket,
      fingerprint: input.fingerprint,
      type: input.type,
      category: input.category,
      subcategory: input.subcategory,
      name: input.name,
      description: input.description,
      color: input.color,
      secondaryColors: input.secondaryColors,
      style: input.style,
      pattern: input.pattern,
      materialGuess: input.materialGuess,
      genderFit: input.genderFit,
      visibleBrand: input.visibleBrand,
      confidence: input.confidence,
      searchQuery: input.searchQuery,
      marketplaceKeywords: input.marketplaceKeywords,
      boundingBox: input.boundingBox,
      imageCropUrl: input.imageCropUrl,
      frameImageUrl: input.frameImageUrl,
      status: "detected",
      detectionCount: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    this.items.set(item.id, item);
    this.itemsByFingerprint.set(item.fingerprint, item.id);
    return { item, created: true };
  }

  async listItems(
    filters: CatalogFilters
  ): Promise<{ items: CatalogItem[]; total: number }> {
    let list = [...this.items.values()];

    if (filters.videoId) list = list.filter((i) => i.videoId === filters.videoId);
    if (filters.status) list = list.filter((i) => i.status === filters.status);
    if (filters.type) list = list.filter((i) => i.type === filters.type);
    if (filters.sourceType) list = list.filter((i) => i.sourceType === filters.sourceType);
    if (filters.category) {
      const c = normalizeText(filters.category);
      list = list.filter((i) => normalizeText(i.category).includes(c));
    }
    if (filters.color) {
      const c = normalizeText(filters.color);
      list = list.filter((i) => normalizeText(i.color).includes(c));
    }
    if (filters.q) {
      const q = normalizeText(filters.q);
      list = list.filter((i) =>
        [
          i.name,
          i.description,
          i.category,
          i.subcategory,
          i.color,
          i.style,
          i.searchQuery,
          ...i.marketplaceKeywords,
        ]
          .map((v) => normalizeText(v))
          .some((v) => v.includes(q))
      );
    }

    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = list.length;

    const offset = Math.max(0, filters.offset ?? 0);
    const limit = Math.max(1, Math.min(filters.limit ?? 60, 200));
    return { items: list.slice(offset, offset + limit), total };
  }

  async getItem(id: string): Promise<CatalogItemWithRecommendations | null> {
    const item = this.items.get(id);
    if (!item) return null;
    return { ...item, recommendations: await this.listRecommendations(id) };
  }

  async updateItem(id: string, patch: ItemPatch): Promise<CatalogItem | null> {
    const existing = this.items.get(id);
    if (!existing) return null;
    const updated: CatalogItem = { ...existing, ...patch, updatedAt: now() };
    this.items.set(id, updated);
    return updated;
  }

  async replaceRecommendations(
    itemId: string,
    recs: RecommendationInput[]
  ): Promise<ProductRecommendation[]> {
    for (const [id, rec] of this.recs) {
      if (rec.detectedItemId === itemId) this.recs.delete(id);
    }
    const created: ProductRecommendation[] = recs.map((r) => ({
      id: uuid(),
      detectedItemId: itemId,
      provider: r.provider,
      title: r.title,
      productUrl: r.productUrl,
      imageUrl: r.imageUrl ?? null,
      price: r.price ?? null,
      currency: r.currency ?? null,
      brand: r.brand ?? null,
      similarityScore: r.similarityScore ?? null,
      reason: r.reason ?? null,
      createdAt: now(),
    }));
    for (const rec of created) this.recs.set(rec.id, rec);
    // Marca el item como "matched" si seguía en "detected".
    const item = this.items.get(itemId);
    if (item && item.status === "detected") {
      this.items.set(itemId, { ...item, status: "matched", updatedAt: now() });
    }
    return created;
  }

  async listRecommendations(itemId: string): Promise<ProductRecommendation[]> {
    return [...this.recs.values()]
      .filter((r) => r.detectedItemId === itemId)
      .sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0));
  }

  async addFeedback(input: FeedbackInput): Promise<ItemFeedback> {
    const fb: ItemFeedback = {
      id: uuid(),
      detectedItemId: input.detectedItemId,
      recommendationId: input.recommendationId ?? null,
      action: input.action,
      createdAt: now(),
    };
    this.feedback.set(fb.id, fb);
    return fb;
  }
}
