import type { CatalogProduct } from "./types";
import type { CatalogStore } from "./store";
import { hammingDistance } from "../images/dhash";
import { cosineSimilarity, getEmbeddingProvider } from "../embeddings/index";
import { normalizeText, normalizeColor, normalizeBrand, categoriesMatch } from "../normalization/normalize";
import { getConfig } from "../config/index";

/**
 * Matching de búsqueda (imagen/texto/híbrido) según el contrato de
 * CATALOG_API_CONTRACT.md. Cascada visual: exact hash → perceptual hash →
 * embedding coseno. Los scores se reportan por separado (visualScore,
 * textScore, attributeScore) y el finalScore es una combinación ponderada
 * que además decide el corte por minScore.
 */

export type MatchStage = "exact_hash" | "perceptual_hash" | "embedding";

export interface MatchQuery {
  imageSha256?: string | null;
  perceptualHash?: string | null;
  imageEmbedding?: number[] | null;
  queryText?: string | null;
  category?: string | null;
  brand?: string | null;
  color?: string | null;
  topK?: number;
  minScore?: number;
}

export interface ProductMatch {
  product: CatalogProduct;
  visualScore: number;
  textScore: number;
  attributeScore: number;
  finalScore: number;
  matchStage: MatchStage;
}

/** Solapamiento de tokens (Jaccard suavizado) para el score textual. */
export function textOverlapScore(query: string, product: CatalogProduct): number {
  const qTokens = new Set(normalizeText(query).split(" ").filter(Boolean));
  if (qTokens.size === 0) return 0;
  const pTokens = new Set(
    normalizeText(`${product.brand ?? ""} ${product.title} ${product.category ?? ""} ${product.color ?? ""}`)
      .split(" ")
      .filter(Boolean)
  );
  let hits = 0;
  for (const t of qTokens) if (pTokens.has(t)) hits++;
  // Normalizamos por los tokens de la query: "vestido rojo" debe puntuar alto
  // contra "Vestido midi rojo Zara" aunque el título tenga más palabras.
  return hits / qTokens.size;
}

/** Score de atributos: cuántos de los filtros suaves (categoría/marca/color) casan. */
export function attributeScore(
  product: CatalogProduct,
  filters: { category?: string | null; brand?: string | null; color?: string | null }
): number {
  const checks: boolean[] = [];
  // Compatibilidad de granularidad: pause2shop manda familias ("clothing"),
  // el catálogo guarda categorías finas ("dress") — ver categoriesMatch.
  if (filters.category) checks.push(categoriesMatch(product.category, filters.category));
  if (filters.brand) checks.push(normalizeBrand(product.brand) === normalizeBrand(filters.brand));
  if (filters.color) {
    const qColor = normalizeColor(filters.color);
    checks.push(
      normalizeColor(product.color) === qColor ||
        product.secondaryColors.some((c) => normalizeColor(c) === qColor)
    );
  }
  if (checks.length === 0) return 0.5; // neutro: sin filtros no premia ni castiga
  return checks.filter(Boolean).length / checks.length;
}

interface ScoredCandidate {
  product: CatalogProduct;
  visualScore: number;
  matchStage: MatchStage;
}

/** Cascada visual sobre un producto candidato. */
function visualScoreFor(q: MatchQuery, p: CatalogProduct): ScoredCandidate | null {
  // 1. Hash exacto: coincidencia perfecta
  if (q.imageSha256 && p.images.some((i) => i.sha256 === q.imageSha256)) {
    return { product: p, visualScore: 1, matchStage: "exact_hash" };
  }
  // 2. Perceptual hash: score decae linealmente con la distancia Hamming
  if (q.perceptualHash && p.perceptualHash) {
    const dist = hammingDistance(q.perceptualHash, p.perceptualHash);
    const { perceptualHashMaxDistance } = getConfig();
    if (dist <= perceptualHashMaxDistance) {
      return { product: p, visualScore: 1 - dist / 64, matchStage: "perceptual_hash" };
    }
  }
  // 3. Embedding coseno (solo si las dimensiones coinciden — un reindex a
  // medias puede dejar vectores de providers distintos conviviendo)
  if (
    q.imageEmbedding &&
    p.imageEmbedding &&
    p.imageEmbedding.length === q.imageEmbedding.length
  ) {
    const sim = cosineSimilarity(q.imageEmbedding, p.imageEmbedding);
    return { product: p, visualScore: Math.max(0, sim), matchStage: "embedding" };
  }
  return null;
}

export function combineScores(
  visual: number,
  text: number,
  attribute: number,
  hasImage: boolean,
  hasText: boolean
): number {
  // Pesos según el modo: imagen manda cuando hay imagen; en texto puro el
  // textScore es el principal y los atributos ayudan a desempatar.
  if (hasImage && hasText) return 0.6 * visual + 0.25 * text + 0.15 * attribute;
  if (hasImage) return 0.85 * visual + 0.15 * attribute;
  return 0.8 * text + 0.2 * attribute;
}

export async function matchProducts(store: CatalogStore, q: MatchQuery): Promise<ProductMatch[]> {
  const config = getConfig();
  const topK = Math.min(q.topK ?? 10, 50);
  const minScore = q.minScore ?? config.minImageScore;
  const hasImage = Boolean(q.imageSha256 || q.perceptualHash || q.imageEmbedding);
  const hasText = Boolean(q.queryText && q.queryText.trim());

  // Embedding textual para búsqueda semántica ligera (provider activo)
  let textQueryEmbedding: number[] | null = null;
  if (hasText) {
    const provider = await getEmbeddingProvider();
    textQueryEmbedding = await provider.embedText(q.queryText!);
  }

  const results: ProductMatch[] = [];
  for (const p of await store.allProducts()) {
    if (!p.isActive) continue;
    // Filtros duros: si el caller especifica categoría/marca los usamos también
    // como filtro además de como señal de score — evita ruido cross-categoría.
    if (q.category && !categoriesMatch(p.category, q.category)) continue;
    if (q.brand && normalizeBrand(p.brand) !== normalizeBrand(q.brand)) continue;

    let visual = 0;
    let stage: MatchStage = "embedding";
    if (hasImage) {
      const scored = visualScoreFor(q, p);
      if (!scored) continue; // sin señal visual comparable, fuera
      visual = scored.visualScore;
      stage = scored.matchStage;
    }

    let text = 0;
    if (hasText) {
      const overlap = textOverlapScore(q.queryText!, p);
      let semantic = 0;
      if (textQueryEmbedding && p.textEmbedding && p.textEmbedding.length === textQueryEmbedding.length) {
        semantic = Math.max(0, cosineSimilarity(textQueryEmbedding, p.textEmbedding));
      }
      text = Math.max(overlap, semantic);
    }

    const attr = attributeScore(p, { category: q.category, brand: q.brand, color: q.color });
    const finalScore = combineScores(visual, text, attr, hasImage, hasText);
    if (finalScore < minScore) continue;
    results.push({ product: p, visualScore: visual, textScore: text, attributeScore: attr, matchStage: stage, finalScore });
  }

  results.sort((a, b) => b.finalScore - a.finalScore);
  return results.slice(0, topK);
}
