import type { DetectedItem as VisionItem } from "@/lib/types";
import type { DetectedItemInput, FrameSourceType, ItemType } from "./types";

/**
 * Funciones puras de normalización y deduplicación del catálogo.
 * Sin dependencias de IO → fáciles de testear (ver test/normalize.test.ts).
 */

/** Tamaño por defecto del bucket de timestamp para deduplicar (segundos). */
export const DEFAULT_BUCKET_SECONDS = 5;

/** Normaliza texto: minúsculas, sin acentos, espacios colapsados. */
export function normalizeText(input?: string | null): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos (marcas combinantes)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Bucket de timestamp: agrupa segundos cercanos en una misma "ventana".
 * Con bucket=5, los segundos 12, 13 y 14 caen todos en el bucket 10.
 */
export function timestampBucket(
  seconds: number,
  bucketSize: number = DEFAULT_BUCKET_SECONDS
): number {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const size = bucketSize > 0 ? bucketSize : DEFAULT_BUCKET_SECONDS;
  return Math.floor(s / size) * size;
}

/**
 * Mapea la categoría/subcategoría (en español o inglés) a un tipo grueso.
 * Si el modelo ya devuelve un `type` válido, se respeta.
 */
export function inferItemType(
  category?: string | null,
  subcategory?: string | null,
  hint?: string | null
): ItemType {
  const valid: ItemType[] = [
    "clothing",
    "footwear",
    "accessory",
    "electronics",
    "home",
    "beauty",
    "other",
  ];
  const h = normalizeText(hint);
  if ((valid as string[]).includes(h)) return h as ItemType;

  const hay = `${normalizeText(category)} ${normalizeText(subcategory)} ${h}`;
  const has = (...w: string[]) => w.some((k) => hay.includes(k));

  if (
    has(
      "zapat",
      "calzado",
      "sneaker",
      "zapatilla",
      "bota",
      "shoe",
      "footwear",
      "sandalia",
      "tacon"
    )
  )
    return "footwear";
  if (
    has(
      "reloj",
      "gafas",
      "bolso",
      "mochila",
      "gorra",
      "cinturon",
      "accesorio",
      "watch",
      "sunglasses",
      "bag",
      "backpack",
      "hat",
      "cap",
      "joya",
      "collar",
      "pulsera"
    )
  )
    return "accessory";
  if (
    has(
      "electr",
      "gadget",
      "portatil",
      "laptop",
      "movil",
      "phone",
      "tablet",
      "auricular",
      "headphone",
      "camara",
      "camera",
      "tv",
      "consola",
      "console",
      "tech"
    )
  )
    return "electronics";
  if (
    has(
      "mueble",
      "furniture",
      "lampara",
      "lamp",
      "silla",
      "chair",
      "sofa",
      "decora",
      "decor",
      "hogar",
      "home",
      "cocina",
      "botella",
      "utensilio"
    )
  )
    return "home";
  if (
    has("belleza", "beauty", "cosm", "maquillaje", "makeup", "perfume", "skincare")
  )
    return "beauty";
  if (
    has(
      "ropa",
      "camiseta",
      "camisa",
      "sudadera",
      "chaqueta",
      "pantalon",
      "vaquero",
      "jean",
      "short",
      "vestido",
      "falda",
      "abrigo",
      "jersey",
      "clothing",
      "shirt",
      "hoodie",
      "jacket",
      "dress",
      "skirt",
      "tshirt",
      "t-shirt"
    )
  )
    return "clothing";

  return "other";
}

/**
 * Huella para deduplicación.
 * Incluye las primeras 4 palabras del nombre normalizado para distinguir
 * items de la misma categoría/color pero con descripción diferente
 * (ej: "camiseta blanca logo" vs "camiseta blanca sin logo").
 */
export function generateItemFingerprint(input: {
  videoId: string;
  name?: string | null;
  category?: string | null;
  color?: string | null;
  style?: string | null;
  visibleBrand?: string | null;
  timestampBucket: number;
}): string {
  const shortName = normalizeText(input.name)
    .split(" ")
    .slice(0, 4)
    .join(" ") || "_";

  return [
    input.videoId.trim(),
    shortName,
    normalizeText(input.category) || "general",
    normalizeText(input.color) || "_",
    normalizeText(input.style) || "_",
    normalizeText(input.visibleBrand) || "_",
    String(input.timestampBucket),
  ].join("|");
}

function cleanString(v?: string | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
}

function uniqueNonEmpty(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export type NormalizeContext = {
  videoId: string;
  frameId: string | null;
  sourceType: FrameSourceType | null;
  sourceUrl: string | null;
  timestampSeconds: number;
  bucketSeconds?: number;
  frameImageUrl?: string | null;
};

/**
 * Convierte un item de la respuesta de visión en una fila lista para persistir,
 * calculando bucket y fingerprint. El `name` conserva su forma original (para
 * mostrar), pero el fingerprint usa la versión normalizada.
 */
export function normalizeDetectedItem(
  visionItem: VisionItem,
  ctx: NormalizeContext
): DetectedItemInput {
  const bucketSeconds = ctx.bucketSeconds ?? DEFAULT_BUCKET_SECONDS;
  const bucket = timestampBucket(ctx.timestampSeconds, bucketSeconds);

  const category = cleanString(visionItem.category) ?? "general";
  const color = cleanString(visionItem.color);
  const style = cleanString(visionItem.style);
  const visibleBrand = cleanString(visionItem.visible_brand ?? null);
  const name = cleanString(visionItem.name) ?? "objeto sin nombre";

  const fingerprint = generateItemFingerprint({
    videoId: ctx.videoId,
    name,
    category,
    color,
    style,
    visibleBrand,
    timestampBucket: bucket,
  });

  const searchQuery =
    cleanString(visionItem.search_query_es) ?? normalizeText(name);

  const marketplaceKeywords = uniqueNonEmpty([
    ...(visionItem.marketplace_keywords ?? []),
    searchQuery,
    ...(visionItem.alternative_queries ?? []),
    ...(visionItem.verified_provider_queries ?? []),
  ]).slice(0, 8);

  const confidence = Number.isFinite(visionItem.confidence)
    ? Math.min(1, Math.max(0, visionItem.confidence))
    : 0;

  return {
    videoId: ctx.videoId,
    frameId: ctx.frameId,
    sourceType: ctx.sourceType,
    sourceUrl: ctx.sourceUrl,
    timestampSeconds: Math.max(0, ctx.timestampSeconds || 0),
    timestampBucket: bucket,
    fingerprint,
    type: inferItemType(category, visionItem.subcategory, visionItem.type),
    category,
    subcategory: cleanString(visionItem.subcategory),
    name,
    description: cleanString(visionItem.description),
    color,
    secondaryColors: uniqueNonEmpty(visionItem.secondary_colors ?? []),
    style,
    pattern: cleanString(visionItem.pattern),
    materialGuess: cleanString(visionItem.material_guess),
    genderFit: cleanString(visionItem.gender_fit),
    visibleBrand,
    confidence,
    searchQuery,
    marketplaceKeywords,
    boundingBox: visionItem.bounding_box ?? null,
    imageCropUrl: null,
    frameImageUrl: ctx.frameImageUrl ?? null,
  };
}
