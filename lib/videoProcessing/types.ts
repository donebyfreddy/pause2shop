import type { DetectedItem } from "@/lib/types";

export type CatalogCandidateStatus =
  | "external_candidate"
  | "review_required"
  | "approved"
  | "rejected"
  | "published";

export interface ExternalProductCandidate {
  id: string;
  title: string;
  brand?: string;
  imageUrl: string;
  merchant?: string;
  price?: number;
  currency?: string;
  productUrl: string;
  category?: string;
  visualScore: number;
  commercialScore: number;
  finalScore: number;
  provider: string;
}

export type ProductAttributes = Pick<
  DetectedItem,
  | "color"
  | "style"
  | "subcategory"
  | "visible_brand"
  | "visible_text"
  | "distinctive_features"
>;

export interface ProcessedVideo {
  id: string;
  hash: string;
  filename: string;
  duration: number;
  status: string;
  catalogVersion: string;
  analysisVersion: string;
  processedAt: Date | null;
}

export type VideoPreprocessStatus =
  | "uploaded"
  | "extracting_scenes"
  | "detecting"
  | "tracking"
  | "deduplicating"
  | "matching_catalog"
  | "searching_external"
  | "reviewing"
  | "completed"
  | "failed";

export interface VideoProductOccurrence {
  videoId: string;
  globalProductId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  timestamps: number[];
  sceneIds: string[];
  bestFrameId: string;
  bestCropId: string;
  catalogProductId?: string;
  externalCandidateId?: string;
  confidence: number;
}

export interface UnresolvedVideoProduct {
  id: string;
  videoId: string;
  canonicalLabel: string;
  category: string;
  attributes: ProductAttributes;
  bestCropUrl: string;
  embedding: number[];
  externalCandidates: ExternalProductCandidate[];
  status: "unresolved" | "candidate_found" | "review_required";
}

export type VideoProcessingJobType =
  | "video_preprocess"
  | "catalog_match"
  | "external_product_search"
  | "catalog_candidate_review"
  | "catalog_product_enrichment";

export type VideoProcessingJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExternalCandidateRecord extends ExternalProductCandidate {
  candidateKey: string;
  status: CatalogCandidateStatus;
  analysisJobId?: string;
  mediaContentId?: string;
  detectedItemId?: string;
  globalProductId?: string;
  sourcePage?: string;
  originalImageUrl?: string;
  originCropUrl?: string;
  evidence: string[];
  attributes: Record<string, unknown>;
  queriedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  catalogProductId?: string;
  createdAt: Date;
  updatedAt: Date;
}
