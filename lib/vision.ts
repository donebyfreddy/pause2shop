import type { DetectedItem, FrameAnalysis } from "./types";
import { buildProductLinks } from "./productLinks";
import { clamp } from "./utils";

export const VISION_PROMPT = `Analiza este frame de vídeo como un experto en shopping visual, moda, decoración y productos de consumo.

Detecta únicamente objetos comprables que aparecen visualmente en la imagen.
Prioriza:
- ropa
- calzado
- accesorios
- electrónica
- muebles
- decoración
- material deportivo
- productos de belleza visibles
- objetos del hogar
- gadgets
- bolsos/mochilas
- relojes/gafas
- productos de escritorio

Ignora:
- caras
- identidad de personas
- edad exacta
- género si no es necesario
- rasgos biométricos
- contenido sensible
- texto irrelevante
- objetos demasiado borrosos
- marcas que no se vean claramente

Para cada objeto devuelve:
- name: nombre claro en español
- type: tipo grueso en inglés -> clothing | footwear | accessory | electronics | home | beauty | other
- category
- subcategory
- color: color principal
- secondary_colors: array de colores secundarios (vacío si no hay)
- pattern: estampado/patrón (liso, rayas, cuadros, floral, logo…) — usa "liso" si es liso
- material_guess: material probable si se aprecia (algodón, denim, cuero, lana, plástico, metal…), si no null
- gender_fit: "hombre" | "mujer" | "unisex" si aplica, si no null
- visible_brand: marca solo si se ve claramente, si no null
- style: por ejemplo streetwear, minimalista, deportivo, formal, casual, tech, gamer, vintage, luxury, outdoor
- description: descripción corta visual
- search_query_es: query optimizada para buscar en Amazon España
- alternative_queries: 3 queries alternativas en español (sirven como marketplace_keywords)
- verified_provider_queries: queries para buscar en proveedores oficiales o tiendas fiables
- confidence: número de 0 a 1
- bounding_box: si puedes estimarlo, x/y/width/height normalizado de 0 a 1
- why_recommended: por qué puede gustarle al usuario según el estilo del vídeo/frame

Devuelve solo JSON válido con esta forma:
{
  "summary": "resumen corto de lo que se ve",
  "style_vibe": "vibe general del frame",
  "items": [
    {
      "name": "",
      "type": "clothing",
      "category": "",
      "subcategory": "",
      "color": "",
      "secondary_colors": [],
      "pattern": "liso",
      "material_guess": null,
      "gender_fit": null,
      "visible_brand": null,
      "style": "",
      "description": "",
      "search_query_es": "",
      "alternative_queries": [],
      "verified_provider_queries": [],
      "confidence": 0.0,
      "bounding_box": null,
      "why_recommended": ""
    }
  ]
}

No inventes productos exactos.
No digas que algo es Nike, Adidas, Apple, Zara, etc. si el logo o marca no se ve claramente.
Si no estás seguro, usa descripciones genéricas.
Máximo 8 objetos.
Prioriza los objetos más grandes, visibles y comprables.`;

const CONFIDENCE_THRESHOLD = 0.45;

/**
 * Call OpenAI Vision via the Chat Completions API using fetch (no SDK dependency).
 * `imageDataUrl` must be a `data:image/jpeg;base64,...` string.
 */
export async function analyzeWithOpenAI(
  imageDataUrl: string,
  opts: { apiKey: string; model: string }
): Promise<FrameAnalysis> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Eres un asistente de shopping visual. Respondes SIEMPRE con JSON válido y nada más. Nunca identificas personas.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: VISION_PROMPT },
            { type: "image_url", image_url: { url: imageDataUrl, detail: "low" } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Respuesta vacía del modelo de visión.");

  const parsed = safeParseAnalysis(content);
  if (!parsed) throw new Error("No se pudo interpretar la respuesta del modelo.");
  return parsed;
}

/** Parse possibly-dirty JSON from the model into a FrameAnalysis. */
export function safeParseAnalysis(raw: string): FrameAnalysis | null {
  const candidate = extractJson(raw);
  if (!candidate) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch {
    // Light repair: strip trailing commas and retry once.
    try {
      obj = JSON.parse(candidate.replace(/,(\s*[}\]])/g, "$1"));
    } catch {
      return null;
    }
  }

  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const rawItems = Array.isArray(o.items) ? o.items : [];

  return {
    summary: typeof o.summary === "string" ? o.summary : "",
    style_vibe: typeof o.style_vibe === "string" ? o.style_vibe : "",
    items: rawItems
      .map(coerceItem)
      .filter((it): it is DetectedItem => it !== null),
  };
}

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  // Strip ```json fences if present.
  const fenceless = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = fenceless.indexOf("{");
  const end = fenceless.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return fenceless.slice(start, end + 1);
}

function coerceItem(input: unknown): DetectedItem | null {
  if (!input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;

  const name = typeof i.name === "string" ? i.name.trim() : "";
  if (!name) return null;

  const asString = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : fallback;
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  let confidence = typeof i.confidence === "number" ? i.confidence : 0.5;
  if (confidence > 1) confidence = confidence / 100; // tolerate 0-100 scale
  confidence = clamp(confidence, 0, 1);

  return {
    name,
    category: asString(i.category, "general"),
    subcategory: asString(i.subcategory) || undefined,
    color: asString(i.color) || undefined,
    visible_brand:
      typeof i.visible_brand === "string" && i.visible_brand.trim()
        ? i.visible_brand.trim()
        : null,
    style: asString(i.style) || undefined,
    description: asString(i.description),
    search_query_es: asString(i.search_query_es) || name,
    alternative_queries: asStringArray(i.alternative_queries),
    verified_provider_queries: asStringArray(i.verified_provider_queries),
    confidence,
    bounding_box: coerceBox(i.bounding_box),
    why_recommended: asString(i.why_recommended) || undefined,

    // Campos del esquema de catálogo (opcionales).
    type: asString(i.type) || undefined,
    secondary_colors: asStringArray(i.secondary_colors),
    pattern: asString(i.pattern) || undefined,
    material_guess: asString(i.material_guess) || undefined,
    gender_fit: asString(i.gender_fit) || undefined,
    marketplace_keywords: asStringArray(i.marketplace_keywords),
  };
}

function coerceBox(v: unknown): DetectedItem["bounding_box"] {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" ? clamp(x, 0, 1) : null);
  const x = num(b.x);
  const y = num(b.y);
  const width = num(b.width);
  const height = num(b.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

/**
 * Normalize an analysis: attach product links, drop low-confidence items,
 * sort by a composite score (confidence + buyability + visual prominence).
 */
export function normalizeAnalysis(analysis: FrameAnalysis): FrameAnalysis {
  const items = analysis.items
    .filter((it) => it.confidence >= CONFIDENCE_THRESHOLD)
    .map((it) => {
      const area = it.bounding_box
        ? it.bounding_box.width * it.bounding_box.height
        : 0.25;
      const buyability = buyabilityScore(it.category);
      const score = it.confidence * 0.6 + buyability * 0.25 + area * 0.15;
      return { ...it, productLinks: buildProductLinks(it), score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8);

  return { ...analysis, items };
}

function buyabilityScore(category: string): number {
  const c = category.toLowerCase();
  const high = ["ropa", "calzado", "zapat", "electr", "mueble", "accesorio", "bolso", "reloj", "gafas"];
  const mid = ["decora", "hogar", "deport", "belleza", "gadget"];
  if (high.some((k) => c.includes(k))) return 1;
  if (mid.some((k) => c.includes(k))) return 0.7;
  return 0.5;
}

/** Deterministic-ish realistic mock for dev mode (no API key). */
export function mockAnalysis(): FrameAnalysis {
  const items: DetectedItem[] = [
    {
      name: "Sudadera con capucha oversize",
      type: "clothing",
      category: "ropa",
      subcategory: "sudaderas",
      color: "gris jaspeado",
      secondary_colors: ["blanco"],
      pattern: "liso",
      material_guess: "algodón",
      gender_fit: "unisex",
      visible_brand: null,
      style: "streetwear",
      description: "Sudadera holgada de algodón con capucha y bolsillo canguro.",
      search_query_es: "sudadera capucha oversize gris hombre",
      alternative_queries: [
        "hoodie oversize gris",
        "sudadera streetwear algodón",
        "sudadera capucha unisex gris",
      ],
      verified_provider_queries: ["sudadera capucha oversize"],
      confidence: 0.86,
      bounding_box: { x: 0.32, y: 0.18, width: 0.36, height: 0.5 },
      why_recommended:
        "Encaja con el estilo urbano del frame y es una prenda versátil de uso diario.",
    },
    {
      name: "Zapatillas deportivas blancas",
      type: "footwear",
      category: "calzado",
      subcategory: "zapatillas",
      color: "blanco",
      secondary_colors: [],
      pattern: "liso",
      material_guess: "piel sintética",
      gender_fit: "unisex",
      visible_brand: null,
      style: "casual",
      description: "Zapatillas chunky blancas de perfil retro.",
      search_query_es: "zapatillas blancas chunky retro hombre",
      alternative_queries: [
        "sneakers blancas retro",
        "zapatillas casual blancas",
        "zapatillas dad shoes blancas",
      ],
      verified_provider_queries: ["zapatillas blancas casual"],
      confidence: 0.81,
      bounding_box: { x: 0.4, y: 0.78, width: 0.22, height: 0.16 },
      why_recommended: "Las zapatillas blancas combinan con el look casual del vídeo.",
    },
    {
      name: "Reloj minimalista de pulsera",
      category: "accesorios",
      subcategory: "relojes",
      color: "negro",
      visible_brand: null,
      style: "minimalista",
      description: "Reloj de esfera limpia con correa fina negra.",
      search_query_es: "reloj minimalista hombre correa negra",
      alternative_queries: [
        "reloj esfera blanca minimalista",
        "reloj pulsera fino negro",
        "reloj diseño limpio unisex",
      ],
      verified_provider_queries: ["reloj minimalista"],
      confidence: 0.67,
      bounding_box: { x: 0.6, y: 0.52, width: 0.08, height: 0.07 },
      why_recommended: "Un reloj sobrio refuerza el estilo minimalista detectado.",
    },
    {
      name: "Auriculares inalámbricos over-ear",
      category: "electrónica",
      subcategory: "auriculares",
      color: "negro mate",
      visible_brand: null,
      style: "tech",
      description: "Cascos cerrados con almohadillas acolchadas.",
      search_query_es: "auriculares inalámbricos over ear bluetooth",
      alternative_queries: [
        "cascos bluetooth over ear",
        "auriculares diadema inalámbricos",
        "headphones bluetooth cancelación ruido",
      ],
      verified_provider_queries: ["auriculares over ear bluetooth"],
      confidence: 0.58,
      bounding_box: { x: 0.45, y: 0.1, width: 0.16, height: 0.14 },
      why_recommended: "Complemento tech habitual en este tipo de contenido.",
    },
  ];

  return {
    summary:
      "Una persona con ropa urbana de pie en un entorno interior luminoso, con varios accesorios visibles.",
    style_vibe: "streetwear casual con toques minimalistas",
    items,
  };
}
