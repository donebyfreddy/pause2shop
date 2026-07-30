import type {
  CatalogItem,
  ImagePersistenceStatus,
  ProductRecommendation,
  RecommendationMatchType,
} from "./types";

/**
 * Lógica pura de imágenes del catálogo: estado de persistencia derivado y
 * orden de fallback de la imagen a mostrar. Sin IO → ver test/catalogImages.test.ts.
 */

/** Modo de persistencia de la FILA (no de la imagen). */
export type RowPersistence = "postgres" | "memory" | "memory_fallback";

export function isDataUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("data:");
}

export function isHttpUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/**
 * Deriva el estado de persistencia de la imagen detectada sin columna nueva:
 * la propia forma de la URL dice dónde vive la imagen.
 */
export function deriveImagePersistenceStatus(
  item: Pick<CatalogItem, "imageCropUrl">,
  rowPersistence: RowPersistence
): ImagePersistenceStatus {
  if (!item.imageCropUrl) return "none";
  if (isDataUrl(item.imageCropUrl)) return "local_only";
  if (rowPersistence === "postgres") return "synced";
  return "pending_database_sync";
}

/**
 * Orden de fallback de la imagen principal de la tarjeta:
 *  1. crop detectado  2. frame de origen  3. imagen del mejor match.
 * Devuelve la lista ordenada de candidatas (la UI avanza al siguiente si
 * una URL externa falla al cargar). Vacía ⇒ placeholder por categoría.
 */
export function itemImageCandidates(
  item: Pick<CatalogItem, "imageCropUrl" | "frameImageUrl">,
  bestMatchImageUrl?: string | null
): string[] {
  return [item.imageCropUrl, item.frameImageUrl, bestMatchImageUrl ?? null].filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
}

/**
 * Tipo de match de una recomendación, con compatibilidad hacia atrás: las
 * filas antiguas no tienen match_type pero lo llevaban embebido en `reason`
 * ("near_exact match (112 pts, …)"). Último recurso: umbral por score.
 */
export function recommendationMatchType(
  rec: Pick<ProductRecommendation, "matchType" | "reason" | "similarityScore">
): RecommendationMatchType | null {
  if (rec.matchType) return rec.matchType;
  const m = /^(exact|near_exact|similar) match/.exec(rec.reason ?? "");
  if (m) return m[1] as RecommendationMatchType;
  if (rec.similarityScore == null) return null;
  if (rec.similarityScore >= 0.8) return "near_exact";
  return "similar";
}

/** Selecciona la mejor recomendación (mayor score; empate → primera). */
export function pickBestRecommendation(
  recs: ProductRecommendation[]
): ProductRecommendation | null {
  if (!recs.length) return null;
  return recs.reduce((best, r) =>
    (r.similarityScore ?? 0) > (best.similarityScore ?? 0) ? r : best
  );
}

/** Techo de bytes del crop que aceptamos guardar inline como data URL. */
export const MAX_INLINE_CROP_BYTES = 400 * 1024;
