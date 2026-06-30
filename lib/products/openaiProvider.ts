import type { CatalogItem, RecommendationInput } from "@/lib/catalog/types";
import type { ProductProvider } from "./types";
import { placeholderImage, retailerSearchUrl } from "./shared";

/**
 * Matching automático con OpenAI (MVP, sin YOLO/CLIP ni catálogo propio).
 *
 * Dado un elemento detectado, le pedimos a OpenAI varios productos concretos
 * y comprables (título, marca, retailer, precio estimado, similitud, motivo) en
 * JSON estricto. NO dejamos que el modelo invente URLs ni SKUs: construimos
 * nosotros la URL de búsqueda real del retailer (Amazon España por defecto, con
 * tag de afiliado si se configura). Así el enlace siempre resuelve.
 *
 * Activado cuando hay OPENAI_API_KEY. Si no, se usa el MockProductProvider.
 */
export class OpenAIProductProvider implements ProductProvider {
  readonly name = "OpenAIProductProvider";

  isEnabled(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async search(query: string, item: CatalogItem): Promise<RecommendationInput[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return [];
    const model =
      process.env.PRODUCT_MODEL || process.env.VISION_MODEL || "gpt-4o-mini";

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Eres un experto en shopping que sugiere productos reales y comprables. " +
              "Respondes SIEMPRE con JSON válido y nada más. No inventes URLs, SKUs ni " +
              "modelos exactos: describe el producto (tipo + marca orientativa) y un precio estimado.",
          },
          { role: "user", content: buildPrompt(query, item) },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("Respuesta vacía del modelo de matching.");
    return parseProducts(content, item);
  }
}

function buildPrompt(query: string, item: CatalogItem): string {
  const attrs = [
    ["tipo", item.type],
    ["categoría", item.category],
    ["subcategoría", item.subcategory],
    ["color", item.color],
    ["otros colores", item.secondaryColors.join(", ")],
    ["estilo", item.style],
    ["patrón", item.pattern],
    ["material", item.materialGuess],
    ["género/ajuste", item.genderFit],
    ["marca visible", item.visibleBrand],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  return `Quiero comprar este objeto detectado en un vídeo:

Nombre: ${item.name}
${attrs}
Query base: ${query}

Sugiere de 4 a 6 productos concretos y comprables que se parezcan lo máximo posible.
Para cada uno devuelve:
- title: nombre del producto (claro, buscable)
- brand: marca orientativa (o genérica si no aplica)
- retailer: uno de "Amazon", "Zalando", "ASOS", "El Corte Inglés", "MediaMarkt", "PcComponentes", "IKEA", "Leroy Merlin", "Sephora", "Decathlon", "Nike", "Zara"
- approx_price_eur: precio típico estimado en euros (número)
- similarity: 0 a 1, cómo de parecido es al objeto detectado
- reason: una frase corta en español de por qué encaja

Devuelve SOLO JSON válido con esta forma:
{ "products": [ { "title": "", "brand": "", "retailer": "Amazon", "approx_price_eur": 0, "similarity": 0.0, "reason": "" } ] }`;
}

/**
 * Convierte la respuesta JSON del modelo en RecommendationInput[].
 * Función pura (sin red) → testeable. Construye URLs reales de búsqueda.
 */
export function parseProducts(raw: string, item: CatalogItem): RecommendationInput[] {
  const obj = safeParse(raw);
  if (!obj) return [];
  const list = Array.isArray(obj)
    ? obj
    : Array.isArray((obj as Record<string, unknown>).products)
      ? ((obj as Record<string, unknown>).products as unknown[])
      : [];

  const out: RecommendationInput[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const title = typeof e.title === "string" ? e.title.trim() : "";
    if (!title) continue;

    const brand = typeof e.brand === "string" ? e.brand.trim() : "";
    const retailer = typeof e.retailer === "string" ? e.retailer : "Amazon";
    const queryText = [brand, title].filter(Boolean).join(" ");
    const { provider, url } = retailerSearchUrl(retailer, queryText);

    let price: number | null = null;
    const rawPrice =
      typeof e.approx_price_eur === "number"
        ? e.approx_price_eur
        : Number(e.approx_price_eur);
    if (Number.isFinite(rawPrice) && rawPrice > 0) price = Math.round(rawPrice * 100) / 100;

    let similarity = typeof e.similarity === "number" ? e.similarity : Number(e.similarity);
    if (!Number.isFinite(similarity)) similarity = 0.7;
    if (similarity > 1) similarity = similarity / 100; // tolera escala 0-100
    similarity = Math.min(1, Math.max(0, similarity));

    out.push({
      provider: `${provider} · IA`,
      title,
      productUrl: url,
      imageUrl: placeholderImage(title, item.color),
      price,
      currency: "EUR",
      brand: brand || null,
      similarityScore: similarity,
      reason: typeof e.reason === "string" ? e.reason.trim() : null,
    });
  }

  return out.sort((a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0));
}

function safeParse(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
