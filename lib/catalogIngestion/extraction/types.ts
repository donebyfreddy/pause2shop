/**
 * Modelo compartido por TODOS los extractores (JSON-LD, OpenGraph, microdata,
 * selectores del conector, heurísticas DOM e IA).
 *
 * La clave del diseño: cada extractor devuelve el MISMO shape parcial, y el
 * pipeline los mezcla por capas en orden de fiabilidad. Así:
 *
 *  - añadir un extractor no cambia el contrato de los demás;
 *  - se sabe siempre QUÉ campo vino de DÓNDE (`evidence`), que es lo que
 *    permite auditar un producto en el admin;
 *  - la IA no es un camino especial: es la última capa, y solo se invoca si
 *    quedan campos esenciales sin resolver.
 */

/** De dónde salió un dato. El orden aquí es el orden de preferencia. */
export type ExtractorKind =
  /** Feed/API autorizado publicado por la marca. */
  | "feed"
  /** Metadatos del propio sitemap (lastmod, imágenes). */
  | "sitemap"
  /** JSON-LD schema.org/Product. */
  | "jsonld"
  /** OpenGraph / Twitter cards / <meta>. */
  | "opengraph"
  /** Microdata itemprop / RDFa. */
  | "microdata"
  /** JSON embebido específico de la tienda (__NEXT_DATA__, viewPayload…). */
  | "embedded"
  /** Selectores CSS declarados en el spec del conector. */
  | "selectors"
  /** Heurísticas genéricas de DOM (patrones de precio, galería…). */
  | "heuristics"
  /** El mismo pipeline pero sobre el DOM renderizado por Playwright. */
  | "playwright"
  /** OpenAI sobre HTML condensado — SOLO fallback. */
  | "ai"
  /** Derivado de la URL (id, género, locale). */
  | "url";

/**
 * Orden de preferencia canónico: el índice bajo gana al mezclar capas.
 *
 * `opengraph` va DESPUÉS de los datos estructurados y del JSON embebido a
 * propósito. OpenGraph existe para las tarjetas de redes sociales, no para
 * describir el producto: su `og:title` suele llevar el nombre de la tienda y su
 * `og:image` es UNA miniatura de compartir. Puesto antes, pisaba la galería
 * completa de la ficha con esa miniatura — y eso se vio en un test.
 */
export const EXTRACTOR_PRIORITY: ExtractorKind[] = [
  "feed",
  "sitemap",
  "jsonld",
  "embedded",
  "microdata",
  "opengraph",
  "selectors",
  "heuristics",
  "url",
  "playwright",
  "ai",
];

export interface FieldEvidence {
  /** Nombre del campo de `ExtractedFields`. */
  field: string;
  /** Extractor que aportó el valor. */
  source: ExtractorKind;
  /** Recorte corto que lo respalda (selector, clave JSON, texto del DOM…). */
  snippet: string;
  /** 0–1. Los extractores estructurados son ~1; heurísticas e IA, menos. */
  confidence: number;
}

export interface ExtractedVariant {
  color: string | null;
  size: string | null;
  sku: string | null;
  price: number | null;
  currency: string | null;
  availability: string | null;
}

/**
 * Campos que sabe extraer el pipeline. Todo es nullable a propósito: un
 * extractor que no encuentra evidencia devuelve `null`, nunca un valor
 * inventado ni una cadena vacía.
 */
export interface ExtractedFields {
  /** ¿Es una ficha de producto, un listado, o no se sabe? */
  productType: "product" | "listing" | "unknown";
  sourceProductId: string | null;
  canonicalUrl: string;
  brand: string | null;
  title: string | null;
  model: string | null;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  color: string | null;
  secondaryColors: string[];
  material: string | null;
  pattern: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string | null;
  availability: string | null;
  sku: string | null;
  gtin: string | null;
  sizes: string[];
  variants: ExtractedVariant[];
  imageUrls: string[];
  /** 0–1 agregado sobre los campos esenciales resueltos. */
  confidence: number;
  evidence: FieldEvidence[];
  warnings: string[];
}

/** Lo que devuelve un extractor: campos parciales + de dónde salió cada uno. */
export interface ExtractionLayer {
  kind: ExtractorKind;
  fields: Partial<Omit<ExtractedFields, "confidence" | "evidence" | "warnings">>;
  /** Snippet por campo, para poblar `evidence` al mezclar. */
  snippets?: Partial<Record<string, string>>;
  /** Confianza de esta capa (por defecto la del tipo de extractor). */
  confidence?: number;
  warnings?: string[];
}

/** Confianza por defecto de cada extractor. Datos estructurados ≫ heurísticas. */
export const EXTRACTOR_CONFIDENCE: Record<ExtractorKind, number> = {
  feed: 1,
  sitemap: 0.9,
  jsonld: 0.97,
  opengraph: 0.85,
  microdata: 0.9,
  embedded: 0.93,
  selectors: 0.9,
  heuristics: 0.6,
  url: 0.75,
  playwright: 0.9,
  ai: 0.7,
};

/**
 * Campos SIN los que un producto no vale para el catálogo. Si faltan tras las
 * capas baratas, se escala a Playwright y después a la IA. Si sobreviven
 * ausentes, el producto se descarta con un warning honesto.
 */
export const ESSENTIAL_FIELDS = ["title", "price", "currency", "imageUrls"] as const;

/** Campos deseables: su ausencia justifica IA, pero no descarta el producto. */
export const DESIRABLE_FIELDS = ["brand", "color", "category", "availability", "description"] as const;

export function isFieldPresent(fields: Partial<ExtractedFields>, field: string): boolean {
  const value = (fields as Record<string, unknown>)[field];
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function missingEssentials(fields: Partial<ExtractedFields>): string[] {
  return ESSENTIAL_FIELDS.filter((f) => !isFieldPresent(fields, f));
}

export function missingDesirables(fields: Partial<ExtractedFields>): string[] {
  return DESIRABLE_FIELDS.filter((f) => !isFieldPresent(fields, f));
}

/** Resultado completo de extraer una ficha. */
export interface ExtractionResult extends ExtractedFields {
  /** Extractores que aportaron al menos un campo, en orden de aplicación. */
  extractorsUsed: ExtractorKind[];
  /** El extractor que resolvió el título (el "principal" de cara al admin). */
  primaryExtractor: ExtractorKind | null;
  /** ¿Se recurrió a la IA? Alimenta el % con IA / sin IA del admin. */
  aiUsed: boolean;
  /** ¿Se renderizó con navegador? */
  browserUsed: boolean;
  /** Coste estimado en USD de las llamadas a la IA de esta ficha. */
  aiCostUsd: number;
  aiTokens: { prompt: number; completion: number } | null;
  durationMs: number;
}

/** Representación legible de un valor para la evidencia (sin [object Object]). */
function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Mezcla capas en orden de prioridad: para cada campo gana la primera capa
 * (por prioridad) que aporta un valor presente. Registra evidencia por campo.
 */
export function mergeLayers(canonicalUrl: string, layers: ExtractionLayer[]): ExtractedFields {
  const ordered = [...layers].sort(
    (a, b) => EXTRACTOR_PRIORITY.indexOf(a.kind) - EXTRACTOR_PRIORITY.indexOf(b.kind)
  );

  const out: ExtractedFields = {
    productType: "unknown",
    sourceProductId: null,
    canonicalUrl,
    brand: null,
    title: null,
    model: null,
    description: null,
    category: null,
    subcategory: null,
    gender: null,
    color: null,
    secondaryColors: [],
    material: null,
    pattern: null,
    price: null,
    originalPrice: null,
    currency: null,
    availability: null,
    sku: null,
    gtin: null,
    sizes: [],
    variants: [],
    imageUrls: [],
    confidence: 0,
    evidence: [],
    warnings: [],
  };

  const claimed = new Set<string>();
  for (const layer of ordered) {
    const layerConfidence = layer.confidence ?? EXTRACTOR_CONFIDENCE[layer.kind];
    for (const [field, value] of Object.entries(layer.fields)) {
      if (value == null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      if (field === "productType" && value === "unknown") continue;
      if (claimed.has(field)) continue;
      claimed.add(field);
      (out as unknown as Record<string, unknown>)[field] = value;
      out.evidence.push({
        field,
        source: layer.kind,
        snippet: (layer.snippets?.[field] ?? describeValue(value)).slice(0, 240),
        confidence: layerConfidence,
      });
    }
    for (const w of layer.warnings ?? []) {
      if (!out.warnings.includes(w)) out.warnings.push(w);
    }
  }

  // La confianza agregada penaliza campos esenciales ausentes y pondera por la
  // fiabilidad del extractor que resolvió cada uno.
  const scored = [...ESSENTIAL_FIELDS, ...DESIRABLE_FIELDS];
  let sum = 0;
  for (const field of scored) {
    const ev = out.evidence.find((e) => e.field === field);
    if (ev) sum += ev.confidence;
  }
  out.confidence = Math.round((sum / scored.length) * 100) / 100;

  return out;
}
