import { query, withTransaction } from "@/lib/db/pool";
import type { BoundingBox } from "@/lib/types";
import type { CatalogRepository } from "./repository";
import type {
  AnalysisStatus,
  AnalyzedFrame,
  AnalyzedFrameInput,
  CatalogFilters,
  CatalogItem,
  CatalogItemWithRecommendations,
  DetectedItemInput,
  FeedbackInput,
  FrameSourceType,
  ItemFeedback,
  ItemPatch,
  ItemStatus,
  ItemType,
  MediaType,
  ProductRecommendation,
  RecommendationInput,
  UpsertResult,
  VideoSource,
  VideoSourceInput,
} from "./types";

type Row = Record<string, unknown>;

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return typeof v === "string" ? v : new Date().toISOString();
}
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : v == null ? null : String(v);
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}
function box(v: unknown): BoundingBox | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const x = num(b.x), y = num(b.y), w = num(b.width), h = num(b.height);
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, width: w, height: h };
}

function mapVideo(r: Row): VideoSource {
  return {
    id: String(r.id),
    title: str(r.title),
    url: str(r.url),
    sourceType: r.source_type as FrameSourceType,
    externalKey: String(r.external_key),
    durationSeconds: num(r.duration_seconds),
    mediaType: (r.media_type as MediaType) ?? "video",
    provider: str(r.provider) ?? "unknown",
    embedUrl: str(r.embed_url),
    normalizedUrl: str(r.normalized_url),
    canEmbed: r.can_embed !== false,
    canCaptureFrame: r.can_capture_frame === true,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapFrame(r: Row): AnalyzedFrame {
  return {
    id: String(r.id),
    videoId: String(r.video_id),
    timestampSeconds: num(r.timestamp_seconds) ?? 0,
    imageUrl: str(r.image_url),
    thumbDataUrl: str(r.thumb_data_url),
    sceneSummary: str(r.scene_summary),
    styleVibe: str(r.style_vibe),
    analysisStatus: (r.analysis_status as AnalysisStatus) ?? "completed",
    sourceType: (r.source_type as FrameSourceType) ?? null,
    rawVisionResponse: r.raw_vision_response ?? null,
    createdAt: iso(r.created_at),
  };
}

function mapItem(r: Row): CatalogItem {
  return {
    id: String(r.id),
    videoId: String(r.video_id),
    frameId: r.frame_id ? String(r.frame_id) : null,
    sourceType: (r.source_type as FrameSourceType) ?? null,
    sourceUrl: str(r.source_url),
    timestampSeconds: num(r.timestamp_seconds) ?? 0,
    timestampBucket: num(r.timestamp_bucket) ?? 0,
    fingerprint: String(r.fingerprint),
    type: (r.type as ItemType) ?? null,
    category: String(r.category),
    subcategory: str(r.subcategory),
    name: String(r.name),
    description: str(r.description),
    color: str(r.color),
    secondaryColors: strArray(r.secondary_colors),
    style: str(r.style),
    pattern: str(r.pattern),
    materialGuess: str(r.material_guess),
    genderFit: str(r.gender_fit),
    visibleBrand: str(r.visible_brand),
    confidence: num(r.confidence) ?? 0,
    searchQuery: str(r.search_query),
    marketplaceKeywords: strArray(r.marketplace_keywords),
    boundingBox: box(r.bounding_box),
    imageCropUrl: str(r.image_crop_url),
    frameImageUrl: str(r.frame_image_url),
    status: (r.status as ItemStatus) ?? "detected",
    detectionCount: num(r.detection_count) ?? 1,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function mapRec(r: Row): ProductRecommendation {
  return {
    id: String(r.id),
    detectedItemId: String(r.detected_item_id),
    provider: String(r.provider),
    title: String(r.title),
    productUrl: String(r.product_url),
    imageUrl: str(r.image_url),
    price: num(r.price),
    currency: str(r.currency),
    brand: str(r.brand),
    similarityScore: num(r.similarity_score),
    reason: str(r.reason),
    createdAt: iso(r.created_at),
  };
}

function mapFeedback(r: Row): ItemFeedback {
  return {
    id: String(r.id),
    detectedItemId: String(r.detected_item_id),
    recommendationId: r.recommendation_id ? String(r.recommendation_id) : null,
    action: r.action as ItemFeedback["action"],
    createdAt: iso(r.created_at),
  };
}

const PATCH_COLUMNS: Record<keyof ItemPatch, string> = {
  status: "status",
  name: "name",
  category: "category",
  subcategory: "subcategory",
  type: "type",
  color: "color",
  style: "style",
  pattern: "pattern",
  materialGuess: "material_guess",
  genderFit: "gender_fit",
  visibleBrand: "visible_brand",
  searchQuery: "search_query",
  imageCropUrl: "image_crop_url",
  frameImageUrl: "frame_image_url",
};

export class PostgresCatalogRepository implements CatalogRepository {
  async upsertVideoSource(input: VideoSourceInput): Promise<VideoSource> {
    const { rows } = await query(
      `insert into video_sources
         (external_key, source_type, title, url, duration_seconds,
          media_type, provider, embed_url, normalized_url, can_embed, can_capture_frame)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (external_key) do update set
         title = coalesce(excluded.title, video_sources.title),
         url = coalesce(excluded.url, video_sources.url),
         duration_seconds = coalesce(excluded.duration_seconds, video_sources.duration_seconds),
         media_type = coalesce(excluded.media_type, video_sources.media_type),
         provider = coalesce(excluded.provider, video_sources.provider),
         embed_url = coalesce(excluded.embed_url, video_sources.embed_url),
         normalized_url = coalesce(excluded.normalized_url, video_sources.normalized_url),
         can_embed = excluded.can_embed,
         can_capture_frame = excluded.can_capture_frame,
         updated_at = now()
       returning *`,
      [
        input.externalKey,
        input.sourceType,
        input.title ?? null,
        input.url ?? null,
        input.durationSeconds ?? null,
        input.mediaType ?? "video",
        input.provider ?? input.sourceType,
        input.embedUrl ?? null,
        input.normalizedUrl ?? null,
        input.canEmbed ?? true,
        input.canCaptureFrame ?? false,
      ]
    );
    return mapVideo(rows[0]);
  }

  async listVideos(): Promise<VideoSource[]> {
    const { rows } = await query(
      `select * from video_sources order by created_at desc`
    );
    return rows.map(mapVideo);
  }

  async createFrame(input: AnalyzedFrameInput): Promise<AnalyzedFrame> {
    const { rows } = await query(
      `insert into analyzed_frames
         (video_id, timestamp_seconds, source_type, image_url, thumb_data_url,
          scene_summary, style_vibe, analysis_status, raw_vision_response)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       returning *`,
      [
        input.videoId,
        input.timestampSeconds,
        input.sourceType ?? null,
        input.imageUrl ?? null,
        input.thumbDataUrl ?? null,
        input.sceneSummary ?? null,
        input.styleVibe ?? null,
        input.analysisStatus ?? "completed",
        input.rawVisionResponse != null
          ? JSON.stringify(input.rawVisionResponse)
          : null,
      ]
    );
    return mapFrame(rows[0]);
  }

  async listFramesByVideo(videoId: string): Promise<AnalyzedFrame[]> {
    const { rows } = await query(
      `select * from analyzed_frames where video_id = $1 order by created_at desc`,
      [videoId]
    );
    return rows.map(mapFrame);
  }

  async upsertDetectedItem(input: DetectedItemInput): Promise<UpsertResult> {
    const { rows } = await query(
      `insert into detected_items
         (video_id, frame_id, source_type, source_url, timestamp_seconds,
          timestamp_bucket, fingerprint, type, category, subcategory, name,
          description, color, secondary_colors, style, pattern, material_guess,
          gender_fit, visible_brand, confidence, search_query,
          marketplace_keywords, bounding_box, image_crop_url, frame_image_url)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23::jsonb,$24,$25)
       on conflict (fingerprint) do update set
         confidence = greatest(detected_items.confidence, excluded.confidence),
         description = coalesce(excluded.description, detected_items.description),
         secondary_colors = case when array_length(excluded.secondary_colors, 1) is not null
                                 then excluded.secondary_colors else detected_items.secondary_colors end,
         marketplace_keywords = case when array_length(excluded.marketplace_keywords, 1) is not null
                                 then excluded.marketplace_keywords else detected_items.marketplace_keywords end,
         bounding_box = coalesce(excluded.bounding_box, detected_items.bounding_box),
         frame_id = coalesce(excluded.frame_id, detected_items.frame_id),
         detection_count = detected_items.detection_count + 1,
         updated_at = now()
       returning *, (xmax = 0) as _created`,
      [
        input.videoId,
        input.frameId,
        input.sourceType,
        input.sourceUrl,
        input.timestampSeconds,
        input.timestampBucket,
        input.fingerprint,
        input.type,
        input.category,
        input.subcategory,
        input.name,
        input.description,
        input.color,
        input.secondaryColors,
        input.style,
        input.pattern,
        input.materialGuess,
        input.genderFit,
        input.visibleBrand,
        input.confidence,
        input.searchQuery,
        input.marketplaceKeywords,
        input.boundingBox != null ? JSON.stringify(input.boundingBox) : null,
        input.imageCropUrl,
        input.frameImageUrl,
      ]
    );
    const row = rows[0];
    return { item: mapItem(row), created: row._created === true };
  }

  async listItems(
    filters: CatalogFilters
  ): Promise<{ items: CatalogItem[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    // Añade un parámetro y devuelve su placeholder ($1, $2, …).
    const p = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters.videoId) where.push(`video_id = ${p(filters.videoId)}`);
    if (filters.status) where.push(`status = ${p(filters.status)}`);
    if (filters.type) where.push(`type = ${p(filters.type)}`);
    if (filters.sourceType) where.push(`source_type = ${p(filters.sourceType)}`);
    if (filters.category)
      where.push(`lower(category) like '%' || lower(${p(filters.category)}) || '%'`);
    if (filters.color)
      where.push(`lower(coalesce(color,'')) like '%' || lower(${p(filters.color)}) || '%'`);
    if (filters.q) {
      const q = p(filters.q); // mismo placeholder reutilizado en el OR
      where.push(
        `(lower(coalesce(name,'')) like '%' || lower(${q}) || '%'
          or lower(coalesce(description,'')) like '%' || lower(${q}) || '%'
          or lower(coalesce(category,'')) like '%' || lower(${q}) || '%'
          or lower(coalesce(style,'')) like '%' || lower(${q}) || '%'
          or lower(coalesce(search_query,'')) like '%' || lower(${q}) || '%')`
      );
    }

    const limit = Math.max(1, Math.min(filters.limit ?? 60, 200));
    const offset = Math.max(0, filters.offset ?? 0);
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const { rows } = await query(
      `select *, count(*) over() as _total
       from detected_items
       ${whereSql}
       order by created_at desc
       limit $${limitIdx} offset $${offsetIdx}`,
      params
    );

    const total = rows.length ? Number(rows[0]._total) : 0;
    return { items: rows.map(mapItem), total };
  }

  async getItem(id: string): Promise<CatalogItemWithRecommendations | null> {
    const { rows } = await query(`select * from detected_items where id = $1`, [id]);
    if (!rows.length) return null;
    const recommendations = await this.listRecommendations(id);
    return { ...mapItem(rows[0]), recommendations };
  }

  async updateItem(id: string, patch: ItemPatch): Promise<CatalogItem | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
      const value = patch[key as keyof ItemPatch];
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) {
      const { rows } = await query(`select * from detected_items where id = $1`, [id]);
      return rows.length ? mapItem(rows[0]) : null;
    }
    params.push(id);
    const { rows } = await query(
      `update detected_items set ${sets.join(", ")}, updated_at = now()
       where id = $${params.length} returning *`,
      params
    );
    return rows.length ? mapItem(rows[0]) : null;
  }

  async replaceRecommendations(
    itemId: string,
    recs: RecommendationInput[]
  ): Promise<ProductRecommendation[]> {
    return withTransaction(async (client) => {
      await client.query(
        `delete from product_recommendations where detected_item_id = $1`,
        [itemId]
      );
      const created: ProductRecommendation[] = [];
      for (const r of recs) {
        const { rows } = await client.query(
          `insert into product_recommendations
             (detected_item_id, provider, title, product_url, image_url, price,
              currency, brand, similarity_score, reason)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
          [
            itemId,
            r.provider,
            r.title,
            r.productUrl,
            r.imageUrl ?? null,
            r.price ?? null,
            r.currency ?? null,
            r.brand ?? null,
            r.similarityScore ?? null,
            r.reason ?? null,
          ]
        );
        created.push(mapRec(rows[0]));
      }
      await client.query(
        `update detected_items set status = 'matched', updated_at = now()
         where id = $1 and status = 'detected'`,
        [itemId]
      );
      return created;
    });
  }

  async listRecommendations(itemId: string): Promise<ProductRecommendation[]> {
    const { rows } = await query(
      `select * from product_recommendations
       where detected_item_id = $1
       order by similarity_score desc nulls last, created_at desc`,
      [itemId]
    );
    return rows.map(mapRec);
  }

  async addFeedback(input: FeedbackInput): Promise<ItemFeedback> {
    const { rows } = await query(
      `insert into item_feedback (detected_item_id, recommendation_id, action)
       values ($1,$2,$3) returning *`,
      [input.detectedItemId, input.recommendationId ?? null, input.action]
    );
    return mapFeedback(rows[0]);
  }
}
