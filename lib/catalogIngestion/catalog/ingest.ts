import { randomUUID } from "node:crypto";
import type { CatalogProduct, NormalizedProduct, Origin } from "./types";
import type { CatalogStore } from "./store";
import { findDuplicate, type DedupLevel } from "./dedup";
import { recordIngest } from "../observability/metrics";

/**
 * Ingesta de un producto normalizado en el store, con dedup multinivel,
 * histórico de precios y detección de cambios por contentHash. Es la única
 * puerta de entrada de productos al catálogo: la usan los syncs de conectores,
 * el seed de fixtures y POST /products/external.
 */

export interface IngestResult {
  product: CatalogProduct;
  isNew: boolean;
  deduplicated: boolean;
  dedupLevel: DedupLevel | null;
  changed: boolean;
}

export interface IngestOptions {
  origin?: Origin;
  externalScore?: number | null;
  /** Si false, el producto se guarda inactivo (external con score bajo). */
  active?: boolean;
}

export async function ingestProduct(
  store: CatalogStore,
  normalized: NormalizedProduct,
  options: IngestOptions = {}
): Promise<IngestResult> {
  const now = new Date().toISOString();
  const primaryImage = normalized.images[0];

  const duplicate = await findDuplicate(store, {
    source: normalized.source,
    sourceProductId: normalized.sourceProductId,
    canonicalUrl: normalized.canonicalUrl,
    sku: normalized.sku,
    gtin: normalized.gtin,
    brand: normalized.brand,
    title: normalized.title,
    color: normalized.color,
    imageSha256: primaryImage?.sha256 ?? null,
    perceptualHash: normalized.perceptualHash,
    imageEmbedding: normalized.imageEmbedding,
  });

  if (duplicate) {
    const existing = duplicate.product;
    const changed = existing.contentHash !== normalized.contentHash;
    // Re-visita del mismo producto (nivel source_product_id / canonical_url):
    // actualizamos la ficha. Duplicado cross-source (visual/sku/identidad):
    // conservamos la ficha original y solo refrescamos lastSeenAt + metadata.
    const sameListing =
      duplicate.level === "source_product_id" || duplicate.level === "canonical_url";

    if (sameListing && changed) {
      const updated: CatalogProduct = {
        ...existing,
        ...normalized,
        id: existing.id,
        origin: existing.origin,
        externalScore: existing.externalScore,
        priceHistory: existing.priceHistory,
        firstSeenAt: existing.firstSeenAt,
        lastSeenAt: now,
        updatedAt: now,
        isActive: existing.isActive,
      };
      // Conserva embeddings/hashes previos si el nuevo scrape no los trae
      updated.imageEmbedding = normalized.imageEmbedding ?? existing.imageEmbedding;
      updated.textEmbedding = normalized.textEmbedding ?? existing.textEmbedding;
      updated.perceptualHash = normalized.perceptualHash ?? existing.perceptualHash;
      if (normalized.images.length === 0) updated.images = existing.images;
      await store.saveProduct(updated);
      if (normalized.price != null && normalized.price !== existing.price) {
        await store.recordPrice(updated.id, {
          price: normalized.price,
          originalPrice: normalized.originalPrice,
          currency: normalized.currency ?? "EUR",
          recordedAt: now,
        });
      }
      return { product: updated, isNew: false, deduplicated: false, dedupLevel: duplicate.level, changed: true };
    }

    // Sin cambios (o duplicado cross-source): solo tocamos lastSeenAt
    existing.lastSeenAt = now;
    await store.saveProduct(existing);
    if (!sameListing) await store.incrementDuplicates();
    return {
      product: existing,
      isNew: false,
      deduplicated: !sameListing,
      dedupLevel: duplicate.level,
      changed: false,
    };
  }

  const product: CatalogProduct = {
    ...normalized,
    id: randomUUID(),
    origin: options.origin ?? normalized.origin ?? "scraped",
    externalScore: options.externalScore ?? null,
    priceHistory:
      normalized.price != null
        ? [{
            price: normalized.price,
            originalPrice: normalized.originalPrice,
            currency: normalized.currency ?? "EUR",
            recordedAt: now,
          }]
        : [],
    firstSeenAt: now,
    lastSeenAt: now,
    updatedAt: now,
    isActive: options.active ?? true,
  };
  await store.saveProduct(product);
  // Métrica de throughput: solo productos NUEVOS (las re-visitas no son ingesta).
  recordIngest(product.source);
  return { product, isNew: true, deduplicated: false, dedupLevel: null, changed: true };
}
