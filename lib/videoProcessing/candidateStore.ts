import { createHash, randomUUID } from "node:crypto";
import { isDatabaseConfigured, query } from "@/lib/db";
import type {
  CatalogCandidateStatus,
  ExternalCandidateRecord,
  ExternalProductCandidate,
} from "./types";

export type SaveExternalCandidateInput = ExternalProductCandidate & {
  analysisJobId?: string;
  mediaContentId?: string;
  detectedItemId?: string;
  globalProductId?: string;
  sourcePage?: string;
  originalImageUrl?: string;
  originCropUrl?: string;
  evidence?: string[];
  attributes?: Record<string, unknown>;
  rawResult?: Record<string, unknown>;
};

export function externalCandidateKey(input: SaveExternalCandidateInput): string {
  return createHash("sha256")
    .update(
      [
        input.analysisJobId ?? input.mediaContentId ?? input.detectedItemId ?? "interactive",
        input.globalProductId ?? "object",
        input.provider,
        input.productUrl,
        input.imageUrl,
      ].join("|")
    )
    .digest("hex");
}

export interface ExternalCandidateStore {
  readonly kind: "memory" | "postgres";
  save(input: SaveExternalCandidateInput): Promise<ExternalCandidateRecord>;
  get(id: string): Promise<ExternalCandidateRecord | null>;
  list(opts?: {
    status?: CatalogCandidateStatus;
    limit?: number;
  }): Promise<ExternalCandidateRecord[]>;
  updateStatus(
    id: string,
    status: CatalogCandidateStatus,
    meta?: { reviewedBy?: string; catalogProductId?: string }
  ): Promise<ExternalCandidateRecord | null>;
}

function memoryRecord(input: SaveExternalCandidateInput): ExternalCandidateRecord {
  const now = new Date();
  return {
    ...input,
    id: randomUUID(),
    candidateKey: externalCandidateKey(input),
    status: "review_required",
    evidence: input.evidence ?? [],
    attributes: input.attributes ?? {},
    queriedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export class InMemoryExternalCandidateStore implements ExternalCandidateStore {
  readonly kind = "memory" as const;
  private readonly records = new Map<string, ExternalCandidateRecord>();

  async save(input: SaveExternalCandidateInput): Promise<ExternalCandidateRecord> {
    const key = externalCandidateKey(input);
    const existing = [...this.records.values()].find((record) => record.candidateKey === key);
    if (existing) return structuredClone(existing);
    const record = memoryRecord(input);
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  async get(id: string): Promise<ExternalCandidateRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async list(opts: { status?: CatalogCandidateStatus; limit?: number } = {}) {
    return [...this.records.values()]
      .filter((record) => !opts.status || record.status === opts.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, opts.limit ?? 100)
      .map((record) => structuredClone(record));
  }

  async updateStatus(
    id: string,
    status: CatalogCandidateStatus,
    meta: { reviewedBy?: string; catalogProductId?: string } = {}
  ) {
    const record = this.records.get(id);
    if (!record) return null;
    record.status = status;
    record.reviewedAt = new Date();
    record.reviewedBy = meta.reviewedBy;
    record.catalogProductId = meta.catalogProductId;
    record.updatedAt = new Date();
    return structuredClone(record);
  }
}

type CandidateRow = {
  id: string;
  candidate_key: string;
  analysis_job_id: string | null;
  media_content_id: string | null;
  detected_item_id: string | null;
  global_product_id: string | null;
  title: string;
  brand: string | null;
  image_url: string;
  merchant: string | null;
  price: number | null;
  currency: string | null;
  product_url: string;
  category: string | null;
  visual_score: number;
  commercial_score: number;
  final_score: number;
  provider: string;
  status: CatalogCandidateStatus;
  source_page: string | null;
  original_image_url: string | null;
  origin_crop_url: string | null;
  evidence: string[];
  attributes: Record<string, unknown>;
  queried_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  catalog_product_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function fromRow(row: CandidateRow): ExternalCandidateRecord {
  return {
    id: row.id,
    candidateKey: row.candidate_key,
    title: row.title,
    ...(row.brand ? { brand: row.brand } : {}),
    imageUrl: row.image_url,
    ...(row.merchant ? { merchant: row.merchant } : {}),
    ...(row.price != null ? { price: Number(row.price) } : {}),
    ...(row.currency ? { currency: row.currency } : {}),
    productUrl: row.product_url,
    ...(row.category ? { category: row.category } : {}),
    visualScore: Number(row.visual_score),
    commercialScore: Number(row.commercial_score),
    finalScore: Number(row.final_score),
    provider: row.provider,
    status: row.status,
    ...(row.analysis_job_id ? { analysisJobId: row.analysis_job_id } : {}),
    ...(row.media_content_id ? { mediaContentId: row.media_content_id } : {}),
    ...(row.detected_item_id ? { detectedItemId: row.detected_item_id } : {}),
    ...(row.global_product_id ? { globalProductId: row.global_product_id } : {}),
    ...(row.source_page ? { sourcePage: row.source_page } : {}),
    ...(row.original_image_url ? { originalImageUrl: row.original_image_url } : {}),
    ...(row.origin_crop_url ? { originCropUrl: row.origin_crop_url } : {}),
    evidence: row.evidence ?? [],
    attributes: row.attributes ?? {},
    queriedAt: row.queried_at,
    ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
    ...(row.reviewed_by ? { reviewedBy: row.reviewed_by } : {}),
    ...(row.catalog_product_id ? { catalogProductId: row.catalog_product_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresExternalCandidateStore implements ExternalCandidateStore {
  readonly kind = "postgres" as const;

  async save(input: SaveExternalCandidateInput): Promise<ExternalCandidateRecord> {
    const result = await query<CandidateRow>(
      `insert into external_product_candidates
        (candidate_key, analysis_job_id, media_content_id, detected_item_id,
         global_product_id, title, brand, image_url, merchant, price, currency,
         product_url, category, visual_score, commercial_score, final_score,
         provider, status, source_page, original_image_url, origin_crop_url,
         evidence, attributes, raw_result)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
               $17,'review_required',$18,$19,$20,$21,$22,$23)
       on conflict (candidate_key) do update set
         final_score = greatest(external_product_candidates.final_score, excluded.final_score),
         updated_at = now()
       returning *`,
      [
        externalCandidateKey(input),
        input.analysisJobId ?? null,
        input.mediaContentId ?? null,
        input.detectedItemId ?? null,
        input.globalProductId ?? null,
        input.title,
        input.brand ?? null,
        input.imageUrl,
        input.merchant ?? null,
        input.price ?? null,
        input.currency ?? null,
        input.productUrl,
        input.category ?? null,
        input.visualScore,
        input.commercialScore,
        input.finalScore,
        input.provider,
        input.sourcePage ?? input.productUrl,
        input.originalImageUrl ?? input.imageUrl,
        input.originCropUrl ?? null,
        JSON.stringify(input.evidence ?? []),
        JSON.stringify(input.attributes ?? {}),
        JSON.stringify(input.rawResult ?? {}),
      ]
    );
    return fromRow(result.rows[0]);
  }

  async get(id: string) {
    const result = await query<CandidateRow>(
      "select * from external_product_candidates where id = $1",
      [id]
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async list(opts: { status?: CatalogCandidateStatus; limit?: number } = {}) {
    const result = await query<CandidateRow>(
      `select * from external_product_candidates
        where ($1::text is null or status = $1)
        order by created_at desc limit $2`,
      [opts.status ?? null, Math.min(opts.limit ?? 100, 500)]
    );
    return result.rows.map(fromRow);
  }

  async updateStatus(
    id: string,
    status: CatalogCandidateStatus,
    meta: { reviewedBy?: string; catalogProductId?: string } = {}
  ) {
    const result = await query<CandidateRow>(
      `update external_product_candidates
          set status = $2, reviewed_at = now(), reviewed_by = $3,
              catalog_product_id = coalesce($4, catalog_product_id), updated_at = now()
        where id = $1 returning *`,
      [id, status, meta.reviewedBy ?? "admin", meta.catalogProductId ?? null]
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }
}

const globalStore = globalThis as unknown as {
  __pauseExternalCandidateStore?: ExternalCandidateStore;
};

export function getExternalCandidateStore(): ExternalCandidateStore {
  if (!globalStore.__pauseExternalCandidateStore) {
    globalStore.__pauseExternalCandidateStore = isDatabaseConfigured()
      ? new PostgresExternalCandidateStore()
      : new InMemoryExternalCandidateStore();
  }
  return globalStore.__pauseExternalCandidateStore;
}
