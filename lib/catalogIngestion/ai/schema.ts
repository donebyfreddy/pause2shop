import { z } from "zod";

/**
 * Contrato de salida del extractor por IA, validado con Zod.
 *
 * Dos capas de defensa, porque un modelo puede desviarse de cualquiera:
 *  1. `AI_JSON_SCHEMA` se envía a OpenAI con `response_format: json_schema`
 *     (strict), que fuerza la forma en el propio decodificado.
 *  2. `AiExtractionSchema` re-valida en nuestro lado y coacciona tipos
 *     (un precio que llega como "39,95 €" se convierte a 39.95 o a null).
 *
 * `SCHEMA_VERSION` forma parte de la clave de caché: al cambiar el contrato,
 * las extracciones antiguas dejan de reutilizarse automáticamente.
 */

export const SCHEMA_VERSION = "1.0.0";

/** Precio: acepta número o texto de tienda; nunca lanza, devuelve null. */
const priceLike = z
  .union([z.number(), z.string(), z.null()])
  .transform((value) => {
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
    const cleaned = value.replace(/[^\d.,-]/g, "");
    if (!cleaned) return null;
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    const normalized =
      lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
    const n = Number(normalized);
    return Number.isFinite(n) && n >= 0 ? n : null;
  })
  .nullable()
  .default(null);

const nullableString = z
  .union([z.string(), z.number(), z.null()])
  .transform((v) => {
    if (v == null) return null;
    const t = String(v).trim();
    // "N/A", "null", "unknown" son formas de decir "no hay evidencia".
    if (!t || /^(n\/?a|null|none|unknown|desconocido|no data)$/i.test(t)) return null;
    return t;
  })
  .nullable()
  .default(null);

const stringArray = z
  .union([z.array(z.union([z.string(), z.number()])), z.null()])
  .transform((v) => (v ?? []).map((s) => String(s).trim()).filter((s) => s.length > 0))
  .default([]);

export const AiVariantSchema = z.object({
  color: nullableString,
  size: nullableString,
  sku: nullableString,
  price: priceLike,
  currency: nullableString,
  availability: nullableString,
});

export const AiFieldEvidenceSchema = z.object({
  field: z.string(),
  /** Cita literal del HTML que respalda el valor. */
  snippet: z.string().transform((s) => s.slice(0, 240)),
  confidence: z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0.5;
    })
    .default(0.5),
});

export const AiExtractionSchema = z.object({
  productType: z
    .union([z.literal("product"), z.literal("listing"), z.literal("unknown"), z.string(), z.null()])
    .transform((v) => (v === "product" || v === "listing" ? v : "unknown"))
    .default("unknown"),
  sourceProductId: nullableString,
  canonicalUrl: z.union([z.string(), z.null()]).transform((v) => v ?? "").default(""),
  brand: nullableString,
  title: nullableString,
  model: nullableString,
  description: nullableString,
  category: nullableString,
  subcategory: nullableString,
  gender: nullableString,
  color: nullableString,
  secondaryColors: stringArray,
  material: nullableString,
  pattern: nullableString,
  price: priceLike,
  originalPrice: priceLike,
  currency: nullableString,
  availability: nullableString,
  sku: nullableString,
  gtin: nullableString,
  sizes: stringArray,
  variants: z
    .union([z.array(AiVariantSchema), z.null()])
    .transform((v) => v ?? [])
    .default([]),
  imageUrls: stringArray,
  confidence: z
    .union([z.number(), z.string(), z.null()])
    .transform((v) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0.5;
    })
    .default(0.5),
  evidence: z
    .union([z.array(AiFieldEvidenceSchema), z.null()])
    .transform((v) => v ?? [])
    .default([]),
  warnings: stringArray,
});

export type AiExtraction = z.output<typeof AiExtractionSchema>;

/**
 * JSON Schema enviado a OpenAI. En modo `strict` la API exige que TODAS las
 * propiedades estén en `required` y que `additionalProperties` sea false, de
 * ahí que los campos opcionales se declaren como `["string","null"]`.
 */
export const AI_JSON_SCHEMA = {
  name: "product_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      productType: { type: "string", enum: ["product", "listing", "unknown"] },
      sourceProductId: { type: ["string", "null"] },
      canonicalUrl: { type: ["string", "null"] },
      brand: { type: ["string", "null"] },
      title: { type: ["string", "null"] },
      model: { type: ["string", "null"] },
      description: { type: ["string", "null"] },
      category: { type: ["string", "null"] },
      subcategory: { type: ["string", "null"] },
      gender: { type: ["string", "null"] },
      color: { type: ["string", "null"] },
      secondaryColors: { type: "array", items: { type: "string" } },
      material: { type: ["string", "null"] },
      pattern: { type: ["string", "null"] },
      price: { type: ["number", "null"] },
      originalPrice: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      availability: { type: ["string", "null"] },
      sku: { type: ["string", "null"] },
      gtin: { type: ["string", "null"] },
      sizes: { type: "array", items: { type: "string" } },
      variants: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            color: { type: ["string", "null"] },
            size: { type: ["string", "null"] },
            sku: { type: ["string", "null"] },
            price: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            availability: { type: ["string", "null"] },
          },
          required: ["color", "size", "sku", "price", "currency", "availability"],
        },
      },
      imageUrls: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            snippet: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["field", "snippet", "confidence"],
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: [
      "productType", "sourceProductId", "canonicalUrl", "brand", "title", "model",
      "description", "category", "subcategory", "gender", "color", "secondaryColors",
      "material", "pattern", "price", "originalPrice", "currency", "availability",
      "sku", "gtin", "sizes", "variants", "imageUrls", "confidence", "evidence", "warnings",
    ],
  },
} as const;
