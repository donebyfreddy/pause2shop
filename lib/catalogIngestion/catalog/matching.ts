import type { CatalogProduct } from "./types";
import type { CatalogStore } from "./store";
import { hammingDistance } from "../images/dhash";
import { cosineSimilarity, getEmbeddingProvider } from "../embeddings/index";
import { normalizeText, normalizeColor, normalizeBrand, categoriesMatch } from "../normalization/normalize";
import { getConfig } from "../config/index";
import { getProductsForMatching } from "./productSnapshot";

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
  /** Tipo de artículo detectado ("tote bag", "trench"…): señal, no filtro duro. */
  type?: string | null;
  /**
   * Género. Filtro duro SOLO cuando la ficha declara uno incompatible: un
   * producto sin género no se descarta (la mayoría del catálogo no lo trae).
   */
  gender?: string | null;
  material?: string | null;
  pattern?: string | null;
  /**
   * Exigir que la ficha tenga imagen presentable. Por defecto true: un match
   * sin imagen no se puede pintar como tarjeta, así que como resultado de
   * búsqueda VISUAL no sirve.
   */
  requireImage?: boolean;
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

/**
 * Score de atributos: cuántos de los filtros suaves casan.
 *
 * Categoría/marca/color son las señales fuertes. Tipo, material y patrón son
 * señales DÉBILES (la visión los acierta a medias) y por eso solo se cuentan
 * cuando la ficha declara ese campo: castigar a un producto por no tener
 * `material` rellenado penalizaría la calidad de los datos, no la del match.
 */
export function attributeScore(
  product: CatalogProduct,
  filters: {
    category?: string | null;
    brand?: string | null;
    color?: string | null;
    type?: string | null;
    material?: string | null;
    pattern?: string | null;
  }
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
  // El tipo de artículo se busca en subcategoría/estilo/título: es donde las
  // tiendas lo ponen ("Bolso tote", "trench largo"), no en un campo propio.
  if (filters.type) {
    const haystack = normalizeText(
      `${product.subcategory ?? ""} ${product.style ?? ""} ${product.title}`
    );
    const needles = normalizeText(filters.type).split(" ").filter(Boolean);
    checks.push(needles.length > 0 && needles.some((n) => haystack.includes(n)));
  }
  if (filters.material && product.material) {
    checks.push(normalizeText(product.material) === normalizeText(filters.material));
  }
  if (filters.pattern && product.pattern) {
    checks.push(normalizeText(product.pattern) === normalizeText(filters.pattern));
  }
  if (checks.length === 0) return 0.5; // neutro: sin filtros no premia ni castiga
  return checks.filter(Boolean).length / checks.length;
}

/** Géneros compatibles con cualquier consulta: la prenda vale para ambos. */
const UNISEX = new Set(["unisex", "unisexo", "all", "todos", "mixto", "kids", "nino", "nina"]);

/**
 * ¿El género de la ficha es incompatible con el detectado? Solo puede excluir
 * cuando AMBOS constan y ninguno es unisex — nunca por ausencia de dato.
 */
export function genderConflicts(
  productGender: string | null,
  queryGender: string | null | undefined
): boolean {
  if (!queryGender || !productGender) return false;
  const p = normalizeText(productGender);
  const q = normalizeText(queryGender);
  if (!p || !q) return false;
  if (UNISEX.has(p) || UNISEX.has(q)) return false;
  return p !== q;
}

/**
 * Calidad de la imagen indexada, 0-1. No mide el match: desempata entre dos
 * fichas igual de parecidas a favor de la que se verá mejor en la tarjeta.
 * Sin dimensiones conocidas devuelve un valor neutro (no se penaliza).
 */
export function imageQualityScore(product: CatalogProduct): number {
  const img = product.images.find((i) => i.width && i.height) ?? null;
  if (!img?.width || !img.height) return 0.5;
  const minSide = Math.min(img.width, img.height);
  // 200px ≈ mínimo presentable; 800px ya es holgado para la tarjeta.
  return Math.max(0, Math.min(1, (minSide - 200) / 600));
}

/** ¿Tiene la ficha una imagen que la UI pueda pintar? */
function hasPresentableImage(p: CatalogProduct): boolean {
  return Boolean(p.primaryImage ?? p.images.find((i) => i.url)?.url);
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

  // Una búsqueda VISUAL sin imagen presentable no da resultado utilizable.
  const requireImage = q.requireImage ?? hasImage;

  const results: ProductMatch[] = [];
  for (const p of await getProductsForMatching(store)) {
    if (!p.isActive) continue;
    if (requireImage && !hasPresentableImage(p)) continue;
    // Filtros duros: si el caller especifica categoría/marca los usamos también
    // como filtro además de como señal de score — evita ruido cross-categoría.
    if (q.category && !categoriesMatch(p.category, q.category)) continue;
    if (q.brand && normalizeBrand(p.brand) !== normalizeBrand(q.brand)) continue;
    // El género solo excluye cuando consta en ambos lados y no casa.
    if (genderConflicts(p.gender, q.gender)) continue;

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

    const attr = attributeScore(p, {
      category: q.category,
      brand: q.brand,
      color: q.color,
      type: q.type,
      material: q.material,
      pattern: q.pattern,
    });
    const finalScore = combineScores(visual, text, attr, hasImage, hasText);
    if (finalScore < minScore) continue;
    results.push({ product: p, visualScore: visual, textScore: text, attributeScore: attr, matchStage: stage, finalScore });
  }

  // Orden: score final y, a igualdad real (±0.005, dentro del ruido del
  // coseno), la ficha cuya imagen se verá mejor en la tarjeta.
  results.sort((a, b) => {
    const diff = b.finalScore - a.finalScore;
    if (Math.abs(diff) > 0.005) return diff;
    return imageQualityScore(b.product) - imageQualityScore(a.product);
  });
  return results.slice(0, topK);
}
