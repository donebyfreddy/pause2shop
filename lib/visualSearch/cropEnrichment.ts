import { presentationPriority } from "@/lib/priority";
import type { DetectedItem } from "@/lib/types";

/**
 * Segunda pasada de detalle sobre el CROP del objeto: un análisis del recorte
 * a alta resolución para extraer marca/modelo/OCR/rasgos discriminantes antes
 * de la búsqueda inversa. Corre EN PARALELO con la subida del crop a Storage,
 * así su latencia queda oculta casi por completo.
 *
 * Best-effort: cualquier fallo/timeout devuelve null y el matching sigue con
 * los atributos de la primera pasada — pero el error SIEMPRE queda registrado
 * (nunca silencioso). Salida validada con Structured Outputs (json_schema).
 */

const ENRICH_TIMEOUT_MS = Number(process.env.CROP_ENRICH_TIMEOUT_MS) || 20_000;

export type EvidenceStatus = "verified" | "probable" | "unknown";

export type CropDetails = {
  product_type: string;
  product_subtype: string | null;

  primary_color: string | null;
  secondary_colors: string[];
  pattern: string | null;
  material: string | null;
  silhouette: string | null;

  visible_brand: string | null;
  brand_guess: string | null;
  brand_status: EvidenceStatus;
  brand_evidence: string | null;

  model_guess: string | null;
  model_status: EvidenceStatus;
  model_evidence: string | null;

  visible_text: string | null;
  logo_visible: boolean;
  logo_description: string | null;
  logo_position: string | null;

  distinctive_features: string[];
  discriminating_terms: string[];
  negative_search_terms: string[];

  refined_query: string | null;
  alternative_queries: string[];

  crop_quality: number;
  enough_detail_for_exact_search: boolean;
};

const PROMPT = `Eres el módulo de análisis detallado de un motor profesional de visual product matching. Recibes el recorte de UN ÚNICO producto extraído de un vídeo.

Tu objetivo NO es describirlo de forma genérica: es extraer todas las señales visuales discriminantes para encontrar EXACTAMENTE el mismo producto (marca y modelo) vía Google Lens y buscadores shopping.

REGLAS ESTRICTAS:
1. No identifiques personas ni describas cara, edad, género u otros atributos personales.
2. NO inventes marcas. visible_brand SOLO con texto legible o logo inequívoco. brand_guess solo con evidencia visual concreta. Sin evidencia → null y brand_status="unknown".
3. NO inventes modelos. model_guess solo si el diseño, texto o referencia lo sostienen; si no, null y model_status="unknown".
4. Nunca presentes una marca/modelo probable como verificado.
5. Analiza solo atributos visibles.
6. refined_query en INGLÉS, concreta y discriminante. MAL: "black shirt". BIEN: "men black short sleeve camp collar hawaiian shirt oversized white hibiscus floral print all over".
7. negative_search_terms: términos a EVITAR para no traer resultados incorrectos (p.ej. "long sleeve" si es manga corta).
8. crop_quality 0-1: nitidez/oclusión/tamaño del recorte. enough_detail_for_exact_search=false si el recorte no da para identificar el producto exacto.

Analiza: tipo y subtipo exactos, colores, patrón y su distribución, material, silueta/corte (cuello, mangas, cierre, botones), texto visible (OCR), logo (forma y posición), rasgos únicos, posibles referencias, y los términos que diferencian este producto de otros similares.`;

/** JSON Schema estricto para Structured Outputs. */
const CROP_DETAILS_SCHEMA = {
  name: "crop_details",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      product_type: { type: "string" },
      product_subtype: { type: ["string", "null"] },
      primary_color: { type: ["string", "null"] },
      secondary_colors: { type: "array", items: { type: "string" }, maxItems: 4 },
      pattern: { type: ["string", "null"] },
      material: { type: ["string", "null"] },
      silhouette: { type: ["string", "null"] },
      visible_brand: { type: ["string", "null"] },
      brand_guess: { type: ["string", "null"] },
      brand_status: { type: "string", enum: ["verified", "probable", "unknown"] },
      brand_evidence: { type: ["string", "null"] },
      model_guess: { type: ["string", "null"] },
      model_status: { type: "string", enum: ["verified", "probable", "unknown"] },
      model_evidence: { type: ["string", "null"] },
      visible_text: { type: ["string", "null"] },
      logo_visible: { type: "boolean" },
      logo_description: { type: ["string", "null"] },
      logo_position: { type: ["string", "null"] },
      distinctive_features: { type: "array", items: { type: "string" }, maxItems: 5 },
      discriminating_terms: { type: "array", items: { type: "string" }, maxItems: 5 },
      negative_search_terms: { type: "array", items: { type: "string" }, maxItems: 5 },
      refined_query: { type: ["string", "null"] },
      alternative_queries: { type: "array", items: { type: "string" }, maxItems: 3 },
      crop_quality: { type: "number", minimum: 0, maximum: 1 },
      enough_detail_for_exact_search: { type: "boolean" },
    },
    required: [
      "product_type", "product_subtype", "primary_color", "secondary_colors",
      "pattern", "material", "silhouette", "visible_brand", "brand_guess",
      "brand_status", "brand_evidence", "model_guess", "model_status",
      "model_evidence", "visible_text", "logo_visible", "logo_description",
      "logo_position", "distinctive_features", "discriminating_terms",
      "negative_search_terms", "refined_query", "alternative_queries",
      "crop_quality", "enough_detail_for_exact_search",
    ],
  },
} as const;

type EnrichContext = { itemId?: string; trackId?: string };

/**
 * ¿Merece este objeto la segunda pasada de detalle? No solo los "premium":
 * también prendas con estampado distintivo, objetos con texto/logo y
 * cualquier producto con alta relevancia de compra. Nunca los de prioridad
 * baja (plantas, barandillas…) ni crops sin señal.
 */
export function shouldEnrichCrop(
  item: Pick<
    DetectedItem,
    | "category"
    | "subcategory"
    | "name"
    | "pattern"
    | "visible_text"
    | "logo_visible"
    | "visible_brand"
    | "purchase_relevance"
    | "confidence"
  >,
  premium: boolean
): boolean {
  const priority = presentationPriority(item);
  if (priority === "low") return false;
  if (premium) return true;
  // Prioridad comercial alta (ropa, chaquetas, camisas, relojes, coches,
  // electrónica…) SIEMPRE recibe segunda pasada: la camisa estampada sin
  // marca visible es exactamente el caso que la necesita.
  if (priority === "high") return true;
  const distinctivePattern = Boolean(
    item.pattern && !/^(liso|plain|solid)$/i.test(item.pattern)
  );
  return (
    distinctivePattern ||
    Boolean(item.visible_text) ||
    Boolean(item.logo_visible) ||
    Boolean(item.visible_brand) ||
    (item.purchase_relevance ?? 0) >= 0.7
  );
}

// Caché de enrichment por hash del crop (por instancia): un crop repetido no
// vuelve a pagar la llamada de visión. Clave separada de la caché de Lens.
const ENRICHMENT_CACHE_VERSION = process.env.ENRICHMENT_VERSION || "v2";
const enrichmentCache = new Map<string, CropDetails | null>();
const ENRICHMENT_CACHE_MAX = 500;

/** enrichCropDetails con memoización por hash de crop. */
export async function enrichCropDetailsCached(
  cropDataUrl: string,
  cropHash: string,
  ctx: EnrichContext = {}
): Promise<CropDetails | null> {
  const key = `${ENRICHMENT_CACHE_VERSION}:${cropHash}`;
  if (enrichmentCache.has(key)) return enrichmentCache.get(key) ?? null;
  const details = await enrichCropDetails(cropDataUrl, ctx);
  if (enrichmentCache.size >= ENRICHMENT_CACHE_MAX) {
    const first = enrichmentCache.keys().next().value;
    if (first) enrichmentCache.delete(first);
  }
  enrichmentCache.set(key, details);
  return details;
}

/** Log estructurado y seguro (sin API keys ni data URLs completas). */
function logEnrichError(
  reason: string,
  ctx: EnrichContext,
  extra: Record<string, unknown> = {}
): void {
  console.warn("[crop-enrichment] crop_enrichment_failed", {
    reason,
    model: process.env.VISION_MODEL || "gpt-5-mini",
    timeoutMs: ENRICH_TIMEOUT_MS,
    itemId: ctx.itemId ?? null,
    trackId: ctx.trackId ?? null,
    ...extra,
  });
}

export async function enrichCropDetails(
  cropDataUrl: string,
  ctx: EnrichContext = {}
): Promise<CropDetails | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logEnrichError("missing_openai_api_key", ctx);
    return null;
  }
  if (process.env.ENABLE_CROP_ENRICHMENT === "false") return null;
  const model = process.env.VISION_MODEL || "gpt-5-mini";
  const t0 = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        ...(model.startsWith("gpt-5")
          ? { max_completion_tokens: 900, reasoning_effort: "minimal" }
          : { max_tokens: 900, temperature: 0.1 }),
        response_format: { type: "json_schema", json_schema: CROP_DETAILS_SCHEMA },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              {
                type: "image_url",
                // El crop ya es pequeño (≤640px): "high" aquí es barato y es
                // donde el OCR fino aporta de verdad.
                image_url: { url: cropDataUrl, detail: "high" },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logEnrichError("openai_http_error", ctx, {
        status: res.status,
        body: body.slice(0, 200),
        durationMs: Date.now() - t0,
      });
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      logEnrichError("empty_response", ctx, { durationMs: Date.now() - t0 });
      return null;
    }
    const details = coerceCropDetails(content);
    if (!details) {
      logEnrichError("schema_mismatch", ctx, { durationMs: Date.now() - t0 });
      return null;
    }
    console.info("[crop-enrichment] crop_enrichment_completed", {
      itemId: ctx.itemId ?? null,
      trackId: ctx.trackId ?? null,
      durationMs: Date.now() - t0,
      refinedQuery: details.refined_query,
      brandStatus: details.brand_status,
      cropQuality: details.crop_quality,
    });
    return details;
  } catch (err) {
    const e = err as Error;
    logEnrichError(e.name === "TimeoutError" ? "timeout" : "exception", ctx, {
      errorName: e.name,
      errorMessage: e.message?.slice(0, 200),
      durationMs: Date.now() - t0,
    });
    return null;
  }
}

/** Valida y normaliza el JSON del modelo al tipo CropDetails. */
export function coerceCropDetails(content: string): CropDetails | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const arr = (v: unknown, max: number) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max)
      : [];
  const status = (v: unknown): EvidenceStatus =>
    v === "verified" || v === "probable" ? v : "unknown";
  const productType = str(parsed.product_type);
  if (!productType) return null;

  const quality = typeof parsed.crop_quality === "number" ? parsed.crop_quality : 0.5;
  return {
    product_type: productType,
    product_subtype: str(parsed.product_subtype),
    primary_color: str(parsed.primary_color),
    secondary_colors: arr(parsed.secondary_colors, 4),
    pattern: str(parsed.pattern),
    material: str(parsed.material),
    silhouette: str(parsed.silhouette),
    visible_brand: str(parsed.visible_brand),
    brand_guess: str(parsed.brand_guess),
    brand_status: status(parsed.brand_status),
    brand_evidence: str(parsed.brand_evidence),
    model_guess: str(parsed.model_guess),
    model_status: status(parsed.model_status),
    model_evidence: str(parsed.model_evidence),
    visible_text: str(parsed.visible_text),
    logo_visible: parsed.logo_visible === true,
    logo_description: str(parsed.logo_description),
    logo_position: str(parsed.logo_position),
    distinctive_features: arr(parsed.distinctive_features, 5),
    discriminating_terms: arr(parsed.discriminating_terms, 5),
    negative_search_terms: arr(parsed.negative_search_terms, 5),
    refined_query: str(parsed.refined_query),
    alternative_queries: arr(parsed.alternative_queries, 3),
    crop_quality: Math.min(1, Math.max(0, quality)),
    enough_detail_for_exact_search: parsed.enough_detail_for_exact_search === true,
  };
}

/** Valores genéricos que NO deben bloquear a la segunda pasada. */
const GENERIC_VALUES = new Set([
  "desconocido", "desconocida", "no identificado", "no identificada",
  "unknown", "n/a", "na", "none", "generico", "genérico", "generic", "null",
]);

/**
 * Normaliza un valor visual nullable: los genéricos ("desconocido", "n/a"…)
 * cuentan como null para que no impidan que el detalle del crop los sustituya.
 */
export function normalizeNullableVisualValue(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || GENERIC_VALUES.has(t.toLowerCase())) return null;
  return t;
}

/**
 * Fusiona el detalle del crop en el item. El crop se analizó a MÁS resolución,
 * así que sus valores tienen prioridad sobre los genéricos de la primera
 * pasada — con una excepción: nunca se pisa una marca VERIFICADA previa con
 * una conjetura nueva.
 */
export function mergeCropDetails(
  item: DetectedItem,
  details: CropDetails | null
): DetectedItem {
  if (!details) return item;

  const prevBrand = normalizeNullableVisualValue(item.visible_brand);
  // La marca verificada previa solo cede ante otra marca VERIFICADA del crop.
  const visibleBrand =
    prevBrand && details.brand_status !== "verified"
      ? prevBrand
      : (details.visible_brand ?? prevBrand);

  return {
    ...item,
    visible_brand: visibleBrand,
    brand_guess:
      details.brand_guess ?? normalizeNullableVisualValue(item.brand_guess),
    brand_evidence:
      details.brand_evidence ?? normalizeNullableVisualValue(item.brand_evidence),
    visible_text:
      details.visible_text ?? normalizeNullableVisualValue(item.visible_text),
    subcategory:
      details.product_subtype ?? item.subcategory,
    color: details.primary_color ?? item.color,
    pattern: details.pattern ?? item.pattern,
    material_guess: details.material ?? item.material_guess,
    logo_visible: details.logo_visible || item.logo_visible,
    logo_description:
      details.logo_description ?? normalizeNullableVisualValue(item.logo_description),
    distinctive_features: [
      ...new Set([
        ...details.distinctive_features,
        ...details.discriminating_terms,
        ...(item.distinctive_features ?? []),
      ]),
    ].slice(0, 8),
    // La query refinada y el modelo son el producto principal de esta pasada:
    // NUNCA deben perderse en el merge.
    refined_query: details.refined_query ?? item.refined_query ?? null,
    alternative_queries: [
      ...new Set([
        ...details.alternative_queries,
        ...(item.alternative_queries ?? []),
      ]),
    ].slice(0, 5),
    model_guess: details.model_guess ?? item.model_guess ?? null,
    model_status: details.model_guess
      ? details.model_status
      : (item.model_status ?? "unknown"),
    model_evidence: details.model_evidence ?? item.model_evidence ?? null,
    brand_status: visibleBrand
      ? (details.brand_status === "verified" || prevBrand ? "verified" : details.brand_status)
      : details.brand_guess || item.brand_guess
        ? "probable"
        : "unknown",
  };
}
