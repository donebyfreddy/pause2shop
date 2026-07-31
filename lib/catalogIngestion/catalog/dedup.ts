import type { CatalogProduct } from "./types";
import type { CatalogStore } from "./store";
import { hammingDistance } from "../images/dhash";
import { cosineSimilarity } from "../embeddings/index";
import { identityKey } from "../normalization/normalize";
import { getConfig } from "../config/index";

/**
 * Deduplicación multinivel, de más barata/segura a más difusa. El orden
 * importa: los niveles exactos (ids, URLs, hashes) no tienen falsos positivos;
 * los difusos (perceptual, embedding, identidad textual) usan umbrales
 * configurables por entorno.
 *
 *   1. source + sourceProductId   (mismo producto de la misma tienda)
 *   2. canonicalUrl
 *   3. sha256 exacto de imagen
 *   4. dHash con distancia Hamming ≤ umbral (default 6/64 bits)
 *   5. similitud coseno de embedding ≥ umbral (default 0.96)
 *   6. SKU / GTIN
 *   7. marca + título normalizado + color
 */

export type DedupLevel =
  | "source_product_id"
  | "canonical_url"
  | "exact_image_hash"
  | "perceptual_hash"
  | "embedding"
  | "sku_gtin"
  | "brand_title_color";

export interface DedupCandidate {
  source: string;
  sourceProductId: string;
  canonicalUrl: string;
  sku: string | null;
  gtin: string | null;
  brand: string | null;
  title: string;
  color: string | null;
  imageSha256: string | null;
  perceptualHash: string | null;
  imageEmbedding: number[] | null;
}

export interface DedupMatch {
  product: CatalogProduct;
  level: DedupLevel;
}

export interface FindDuplicateOptions {
  /**
   * Salta los niveles difusos (perceptual_hash, embedding, brand_title_color) y
   * se queda en los exactos e indexables.
   *
   * Existe por dos razones, las dos medidas:
   *
   *  · COSTE. Los niveles difusos recorren `store.allProducts()`, que trae
   *    hasta 5.000 `doc` jsonb completos (embeddings incluidos) por CADA
   *    producto que no case por un nivel exacto. Un producto nuevo nunca casa,
   *    así que importar 1.000 fichas nuevas serían 1.000 escaneos completos:
   *    gigabytes de egreso de Neon para no encontrar nada.
   *
   *  · CORRECCIÓN. Cuando la fuente tiene ids propios y únicos por construcción
   *    (un dataset cerrado), el id ES la autoridad y el nivel difuso solo puede
   *    equivocarse. Y se equivoca precisamente con fotos de catálogo sobre
   *    fondo blanco, que es lo que hay aquí: el mismo fallo que fusionó tres
   *    productos de Ecoalf.
   */
  exactOnly?: boolean;
}

export async function findDuplicate(
  store: CatalogStore,
  c: DedupCandidate,
  options: FindDuplicateOptions = {}
): Promise<DedupMatch | null> {
  const config = getConfig();

  // Niveles exactos: una sola query indexable cada uno
  const bySourceId = await store.findBySourceProductId(c.source, c.sourceProductId);
  if (bySourceId) return { product: bySourceId, level: "source_product_id" };

  const byUrl = await store.findByCanonicalUrl(c.canonicalUrl);
  if (byUrl) return { product: byUrl, level: "canonical_url" };

  if (c.imageSha256) {
    const byHash = await store.findByImageSha256(c.imageSha256);
    if (byHash) return { product: byHash, level: "exact_image_hash" };
  }

  if (c.sku) {
    const bySku = await store.findBySku(c.sku);
    if (bySku) return { product: bySku, level: "sku_gtin" };
  }
  if (c.gtin) {
    const byGtin = await store.findByGtin(c.gtin);
    if (byGtin) return { product: byGtin, level: "sku_gtin" };
  }

  // A partir de aquí empieza lo caro. Quien sabe que su fuente tiene ids
  // autoritativos se baja antes de pagar el escaneo completo.
  if (options.exactOnly) return null;

  // Niveles difusos: recorren candidatos en memoria. El identityKey se
  // comprueba junto a los visuales para no pagar dos pasadas.
  const key = identityKey(c.brand, c.title, c.color);
  let best: DedupMatch | null = null;

  for (const p of await store.allProducts()) {
    // GUARDA CRÍTICA: dentro de UNA MISMA tienda, el id de producto de la
    // tienda es la autoridad. Dos fichas de la misma tienda con ids distintos
    // son productos distintos, y punto — aunque sus fotos se parezcan.
    //
    // Sin esto, la fotografía de catálogo (objeto centrado sobre fondo blanco)
    // hace colisionar el dHash de productos que no tienen nada que ver, y el
    // sync "funciona" mientras se come el catálogo: se vio en real con tres
    // productos de Ecoalf fusionados en uno.
    //
    // El dedup visual sigue existiendo para su caso legítimo: el MISMO producto
    // encontrado en tiendas DISTINTAS.
    if (p.source === c.source) {
      if (isSameSourceDifferentProduct(p, c)) continue;
    }

    if (
      c.perceptualHash &&
      p.perceptualHash &&
      hammingDistance(c.perceptualHash, p.perceptualHash) <= config.perceptualHashMaxDistance
    ) {
      return { product: p, level: "perceptual_hash" };
    }
    if (
      c.imageEmbedding &&
      p.imageEmbedding &&
      p.imageEmbedding.length === c.imageEmbedding.length &&
      cosineSimilarity(c.imageEmbedding, p.imageEmbedding) >= config.embeddingDedupThreshold
    ) {
      return { product: p, level: "embedding" };
    }
    if (!best && identityKey(p.brand, p.title, p.color) === key) {
      // La identidad textual es el nivel más débil: la guardamos pero seguimos
      // buscando una coincidencia visual más fuerte.
      best = { product: p, level: "brand_title_color" };
    }
  }
  return best;
}

/**
 * ¿Son dos productos DISTINTOS de la misma tienda? Lo son si la tienda les da
 * ids distintos y no comparten SKU ni GTIN. En ese caso ningún nivel difuso
 * debe fusionarlos.
 */
function isSameSourceDifferentProduct(existing: CatalogProduct, candidate: DedupCandidate): boolean {
  if (existing.sourceProductId === candidate.sourceProductId) return false;
  if (candidate.sku && existing.sku && candidate.sku === existing.sku) return false;
  if (candidate.gtin && existing.gtin && candidate.gtin === existing.gtin) return false;
  return true;
}
