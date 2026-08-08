import {
  getCatalogRepository,
  normalizeDetectedItem,
  type CatalogRepository,
  type ItemStatus,
  type RecommendationInput,
} from "@/lib/catalog";
import { MAX_INLINE_CROP_BYTES } from "@/lib/catalog/images";
import { publishPublicObject } from "@/lib/mediaStorage";
import { decodeImageDataUrl } from "@/lib/visualSearch/storage";
import type { AnalysisJobRecord, UniqueProductRecord } from "./types";

export type CatalogPersistenceResult = {
  saved: number;
  failed: number;
};

type Options = {
  repo?: CatalogRepository;
  requestOrigin?: string | null;
};

function statusFor(product: UniqueProductRecord): ItemStatus {
  if (product.matchStatus === "catalog_matched") return "catalog_matched";
  if (product.matchStatus === "external_candidate") return "review_required";
  return "detected";
}

function recommendationsFor(product: UniqueProductRecord): RecommendationInput[] {
  return (product.matching?.matches ?? [])
    .filter((match) => Boolean(match.productUrl))
    .slice(0, 8)
    .map((match) => ({
      provider: match.provider,
      title: match.title,
      productUrl: match.productUrl,
      imageUrl: match.imageUrl,
      price: match.price,
      currency: match.currency,
      brand: match.brand,
      similarityScore: match.scores.finalScore,
      matchType:
        match.matchType === "exact"
          ? "exact"
          : match.matchType === "probable"
            ? "near_exact"
            : "similar",
      reason: match.evidence.join(" · ").slice(0, 800) || null,
    }));
}

async function persistentCropUrl(
  dataUrl: string | null,
  requestOrigin: string | null
): Promise<string | null> {
  if (!dataUrl) return null;
  const decoded = decodeImageDataUrl(dataUrl);
  if (!decoded) return null;
  const published = await publishPublicObject({
    hash: decoded.hash,
    buffer: decoded.buffer,
    mime: decoded.mime,
    prefix: "crops",
    requestOrigin,
  });
  if (published.ok) return published.url;
  return decoded.buffer.byteLength <= MAX_INLINE_CROP_BYTES ? dataUrl : null;
}

/**
 * Copia los productos únicos de un job preprocesado al catálogo público.
 *
 * La escritura es idempotente por vídeo+productId. Un resultado externo se
 * guarda y se puede ver, pero conserva `review_required`: encontrar algo en
 * Internet no equivale a publicarlo como producto verificado.
 */
export async function persistPreprocessedProductsToCatalog(
  job: AnalysisJobRecord,
  products: UniqueProductRecord[],
  options: Options = {}
): Promise<CatalogPersistenceResult> {
  const repo = options.repo ?? getCatalogRepository();
  const sourceKey = `preprocessed:${job.media.fileHash ?? job.media.id}`;
  const video = await repo.upsertVideoSource({
    externalKey: sourceKey,
    sourceType: "uploaded",
    title: job.media.fileName,
    durationSeconds: job.media.durationSeconds,
    mediaType: "video",
    provider: "video_preprocess",
    canEmbed: false,
    canCaptureFrame: true,
  });

  let saved = 0;
  let failed = 0;
  for (const product of products) {
    try {
      const timestampSeconds = product.bestCrop.timestampSeconds;
      const cropUrl = await persistentCropUrl(
        product.bestCrop.cropDataUrl,
        options.requestOrigin ?? null
      );
      const frame = await repo.createFrame({
        videoId: video.id,
        timestampSeconds,
        sourceType: "uploaded",
        analysisStatus: "completed",
        rawVisionResponse: {
          analysisJobId: job.id,
          globalProductId: product.productId,
          identity: product.identity,
        },
      });
      const input = normalizeDetectedItem(product.item, {
        videoId: video.id,
        frameId: frame.id,
        sourceType: "uploaded",
        sourceUrl: null,
        timestampSeconds,
      });
      input.fingerprint = `${sourceKey}|${product.productId}`;
      input.imageCropUrl = cropUrl;
      const upserted = await repo.upsertDetectedItem(input);
      const recommendations = recommendationsFor(product);
      if (recommendations.length > 0) {
        await repo.replaceRecommendations(upserted.item.id, recommendations);
      }
      await repo.updateItem(upserted.item.id, { status: statusFor(product) });
      saved++;
    } catch (error) {
      failed++;
      console.warn("[analysis-job] catalog_product_persist_failed", {
        jobId: job.id,
        productId: product.productId,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
    }
  }
  return { saved, failed };
}
