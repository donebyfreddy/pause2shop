import type { DetectedItem, FrameAnalysis, VideoAnalysisConfig } from "./types";
import { buildProductLinks } from "./productLinks";
import { clamp } from "./utils";
import { personAssociationScore, presentationPriority } from "./priority";
import { isOversizedBox, suppressDuplicateBoxes } from "./video/boxMapping";
import {
  CATEGORY_LABELS_ES,
  isCategoryAllowed,
  isRelationshipAllowed,
} from "./analysis/categories";

/** Máximo de objetos que pedimos al modelo por frame (configurable). */
export const MAX_OBJECTS_PER_FRAME = Math.min(
  Math.max(Number(process.env.MAX_OBJECTS_PER_FRAME) || 15, 4),
  25
);

export const VISION_PROMPT = `Analiza este frame como un sistema PERSON-CENTRIC de visual commerce: detecta objetos físicos comprables, no solo prendas de ropa, pero SIEMPRE con la persona como prioridad.

OBJETIVO PRINCIPAL: detectar primero todo lo que una persona (1) lleva puesto, (2) sostiene, (3) utiliza o (4) tiene inmediatamente asociado. Solo después, objetos comprables del entorno.

ORDEN OBLIGATORIO DE BARRIDO:
A. Para CADA persona visible (aunque esté parcialmente visible), revisa sistemáticamente:
   prenda superior · prenda inferior · chaqueta/abrigo · calzado · reloj · pulseras · joyería · gafas · sombrero/gorra · bolso/mochila · cinturón · accesorios · objetos sostenidos en las manos.
B. Después, objetos que utiliza: móvil, portátil, monitores, cámara, auriculares, botella, taza, mando, objetos de trabajo o deporte, silla/mesa que está usando, mobiliario y electrónica del escritorio.
C. Por último, objetos del fondo SOLO si son claramente comprables, suficientemente visibles y comercialmente relevantes o visualmente distintivos.

NO priorices (relationship=background, purchase_relevance baja): puertas, paredes, suelo, carretera, barandillas, vegetación genérica, palmeras, arquitectura, mar o paisaje.

REGLAS IMPORTANTES:
- NUNCA devuelvas la persona, caras, pelo ni partes del cuerpo como producto, ni la identifiques. SÍ los productos que lleva o usa.
- Cada producto debe tener "relationship": worn | held | used | near_person | background.
- Cada producto asociado a una persona debe tener "person_index" (0-based); si no, null.
- person_association_score 0-1 orientativo: worn≈1.0, held≈0.95, used≈0.8, near_person≈0.55, background≈0.15.
- NO ignores un objeto por estar parcialmente visible: inclúyelo con confidence menor.
- NO uses nombres genéricos si puedes ser más específico ("camisa negra manga corta estampado floral blanco", no "camisa").
- NO inventes marcas ni modelos. Diferencia:
  · visible_brand: SOLO con texto legible o logo inequívoco (evidencia real).
  · brand_guess: solo con evidencia visual fuerte.
  · Sin evidencia: ambos null. Un reloj plateado que "parece de lujo" NO es Rolex.
- brand_evidence: la evidencia concreta que respalda la marca, o null.
- Detecta logos aunque no sean legibles: forma/posición/color en logo_description.
- bounding_box es OBLIGATORIA para CADA objeto: coordenadas normalizadas 0-1 (x,y = esquina superior izquierda). Debe encuadrar el PRODUCTO concreto, no la escena:
  · prendas: cuello/mangas/estampado, sin incluir toda la cara ni el cuerpo entero;
  · relojes/pulseras: solo muñeca y objeto (ej: {"x":0.62,"y":0.55,"width":0.08,"height":0.06});
  · objetos sostenidos: el objeto, no todo el brazo.
  NUNCA devuelvas bounding_box null.
- description: UNA frase corta (máx. 15 palabras). Sé conciso en todos los campos.
- Máximo ${MAX_OBJECTS_PER_FRAME} objetos. Si hay más, elimina PRIMERO los genéricos del fondo, nunca lo que la persona lleva o sostiene.

Para cada producto devuelve (textos MUY cortos — la latencia importa):
- name, category (t-shirt, shirt, sneakers, watch, bag, chair, monitor, mug, etc.), subcategory
- relationship, person_index, person_association_score
- color, pattern (liso | rayas | cuadros | logo | estampado | null), material_guess
- visible_brand, brand_guess, brand_evidence, logo_visible, logo_description, visible_text
- description, search_query_es, distinctive_features (máx 2)
- confidence (0-1), purchase_relevance (0-1)
- bounding_box (OBLIGATORIO)

Devuelve solo JSON válido:
{
  "summary": "1 frase",
  "style_vibe": "2 palabras",
  "items": [
    {
      "name": "",
      "category": "",
      "subcategory": "",
      "relationship": "worn",
      "person_index": 0,
      "person_association_score": 1.0,
      "color": "",
      "pattern": null,
      "material_guess": null,
      "visible_brand": null,
      "brand_guess": null,
      "brand_evidence": null,
      "logo_visible": false,
      "logo_description": null,
      "visible_text": null,
      "description": "",
      "search_query_es": "",
      "distinctive_features": [],
      "confidence": 0.0,
      "purchase_relevance": 0.0,
      "bounding_box": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }
    }
  ]
}`;

const CLOTHING_PROMPT = `Analiza este frame EXCLUSIVAMENTE para detectar prendas de ropa que llevan puestas las personas visibles.

Primero localiza las personas. Después, para CADA persona, revisa: torso · brazos · cintura · piernas · ropa exterior.

Devuelve ÚNICAMENTE prendas de ropa (camiseta, camisa, polo, sudadera, chaqueta, abrigo, vestido, falda, pantalón, vaqueros, shorts, prenda superior/inferior/exterior, ropa deportiva, uniforme).

NO devuelvas: personas, cara, pelo, piel, relojes, joyería, calzado, muebles, puertas, plantas, decoración ni objetos del fondo.

Cada prenda es un item separado. La bounding_box debe encuadrar la PRENDA (cuello/mangas/estampado), no la persona entera ni la cara.

No inventes marcas. Prioriza: tipo de prenda, color, patrón, corte, estampado, cuello, mangas, botones, material visible, logo/texto si existe.

Incluye siempre: relationship="worn", person_index (0-based), bounding_box, confidence, purchase_relevance.

${jsonShape()}`;

function jsonShape(): string {
  return `Devuelve solo JSON válido:
{
  "summary": "1 frase",
  "style_vibe": "2 palabras",
  "items": [
    {
      "name": "", "category": "", "subcategory": "",
      "relationship": "worn", "person_index": 0, "person_association_score": 1.0,
      "color": "", "pattern": null, "material_guess": null,
      "visible_brand": null, "brand_guess": null, "brand_evidence": null,
      "logo_visible": false, "logo_description": null, "visible_text": null,
      "description": "", "search_query_es": "", "distinctive_features": [],
      "confidence": 0.0, "purchase_relevance": 0.0,
      "bounding_box": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }
    }
  ]
}`;
}

/**
 * Prompt DINÁMICO por configuración. No menciona categorías que el usuario no
 * seleccionó. Con solo `clothing` + personCentric usa el prompt ropa-only.
 */
export function buildVisionPrompt(config?: VideoAnalysisConfig): string {
  if (!config || config.categories.includes("all")) return VISION_PROMPT;

  const onlyClothing =
    config.categories.length === 1 && config.categories[0] === "clothing";
  if (onlyClothing && config.personCentric) return CLOTHING_PROMPT;

  const labels = config.categories
    .map((c) => CATEGORY_LABELS_ES[c])
    .filter(Boolean)
    .join(", ");
  const centric = config.personCentric
    ? `Prioriza SIEMPRE lo que las personas llevan puesto o sostienen; rechaza objetos del fondo (relationship=background).`
    : `Detecta los productos comprables de esas categorías, estén o no asociados a una persona.`;

  return `Analiza este frame como sistema de visual commerce.

Detecta ÚNICAMENTE productos de estas categorías: ${labels}.
NO devuelvas productos de otras categorías, ni personas, caras, pelo, piel ni partes del cuerpo.
${centric}

Reglas: no inventes marcas; bounding_box OBLIGATORIA y ceñida al PRODUCTO (no a la escena); cada producto con relationship (worn|held|used|near_person|background), person_index (0-based o null), color, pattern, confidence y purchase_relevance. Máximo ${MAX_OBJECTS_PER_FRAME} objetos, eliminando primero los genéricos del fondo.

${jsonShape()}`;
}

// Umbral bajado (antes 0.45): el prompt ahora pide incluir objetos
// parcialmente visibles con confianza menor; no queremos descartarlos todos.
const CONFIDENCE_THRESHOLD = clamp(
  Number(process.env.VISION_CONFIDENCE_THRESHOLD) || 0.35,
  0,
  1
);

/**
 * Call OpenAI Vision via the Chat Completions API using fetch (no SDK dependency).
 * `imageDataUrl` must be a `data:image/jpeg;base64,...` string.
 */
// Timeout duro de la llamada de visión: sin esto, un request colgado de OpenAI
// deja la petición (y el spinner del cliente) bloqueados indefinidamente.
const OPENAI_TIMEOUT_MS = 45_000;

const VALID_SERVICE_TIERS = ["auto", "default", "flex", "priority"] as const;
type ServiceTier = (typeof VALID_SERVICE_TIERS)[number];

/**
 * Saneador de OPENAI_SERVICE_TIER: la env puede llegar rota (vacía, "||",
 * espacios, valores concatenados por un script de sync) y OpenAI devuelve
 * 400 si el valor no es exactamente uno de los soportados. NUNCA propagamos
 * el valor crudo a la petición: o es uno de los 4 válidos, o se omite.
 */
let loggedServiceTierOnce = false;

function sanitizeServiceTier(raw: string | undefined): ServiceTier | null {
  const detected = raw ?? "(no definido)";
  const cleaned = (raw ?? "").trim().replace(/^["']|["']$/g, "");
  const isValid = (VALID_SERVICE_TIERS as readonly string[]).includes(cleaned);
  const finalValue = isValid ? (cleaned as ServiceTier) : null;

  // Se loguea una sola vez por proceso (no en cada request) para no ensuciar
  // los logs de producción; el valor no cambia entre peticiones.
  if (!loggedServiceTierOnce) {
    loggedServiceTierOnce = true;
    console.log(
      `[vision] OPENAI_SERVICE_TIER detectado="${detected}" → final=${
        finalValue ?? "(omitido, fallback)"
      } fallback=${raw !== undefined && !isValid}`
    );
    if (raw !== undefined && !isValid) {
      console.warn(
        `[vision] OPENAI_SERVICE_TIER="${detected}" no es válido (valores permitidos: ${VALID_SERVICE_TIERS.join(", ")}). Se omite el parámetro service_tier en la petición a OpenAI.`
      );
    }
  }
  return finalValue;
}

function buildVisionRequestBody(
  imageDataUrl: string,
  model: string,
  stream: boolean,
  config?: VideoAnalysisConfig
): string {
  const prompt = buildVisionPrompt(config);
  const serviceTier = sanitizeServiceTier(process.env.OPENAI_SERVICE_TIER);
  return JSON.stringify({
    model,
    stream,
    // Con hasta 15 objetos, 2000 tokens truncaban el JSON y el parser
    // descartaba la cola de la lista.
    // gpt-5*: max_completion_tokens + reasoning minimal (rápido) y sin
    // temperature (la familia gpt-5 no acepta valores ≠ 1).
    ...(model.startsWith("gpt-5")
      ? { max_completion_tokens: 4000, reasoning_effort: "minimal" }
      : { max_tokens: 4000, temperature: 0.2 }),
    // Tier de prioridad opcional para el día de la demo (menos latencia,
    // más coste). Valores soportados por OpenAI: "auto" | "default" | "flex"
    // | "priority". Saneado defensivo: nunca se envía un valor crudo/roto.
    ...(serviceTier ? { service_tier: serviceTier } : {}),
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
          { type: "text", text: prompt },
          {
            type: "image_url",
            // "low" reducía el frame a ~512px y hacía indetectables los
            // objetos pequeños (reloj, taza, teclado). "high" procesa la
            // resolución real del frame (1280px) por tiles.
            image_url: {
              url: imageDataUrl,
              detail: process.env.VISION_IMAGE_DETAIL === "low" ? "low" : "high",
            },
          },
        ],
      },
    ],
  });
}

async function visionFetch(
  imageDataUrl: string,
  opts: { apiKey: string; model: string; config?: VideoAnalysisConfig },
  stream: boolean
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: buildVisionRequestBody(imageDataUrl, opts.model, stream, opts.config),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(
        `El modelo de visión tardó más de ${OPENAI_TIMEOUT_MS / 1000}s. Inténtalo de nuevo.`
      );
    }
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

export async function analyzeWithOpenAI(
  imageDataUrl: string,
  opts: { apiKey: string; model: string; config?: VideoAnalysisConfig }
): Promise<FrameAnalysis> {
  const res = await visionFetch(imageDataUrl, opts, false);

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Respuesta vacía del modelo de visión.");

  const parsed = safeParseAnalysis(content);
  if (!parsed) throw new Error("No se pudo interpretar la respuesta del modelo.");
  return applyConfigFilter(parsed, opts.config);
}

/** Filtra el análisis final por categorías + relationship (idempotente). */
function applyConfigFilter(
  analysis: FrameAnalysis,
  config?: VideoAnalysisConfig
): FrameAnalysis {
  if (!config) return analysis;
  return {
    ...analysis,
    items: analysis.items.filter(
      (it) =>
        isCategoryAllowed(it, config.categories) &&
        isRelationshipAllowed(it.relationship, config)
    ),
  };
}

/**
 * Variante en STREAMING: consume la respuesta SSE de OpenAI y llama a
 * `onItem` con cada objeto detectado EN CUANTO el modelo termina de
 * generarlo. Reduce el tiempo hasta el primer resultado de ~15-30s (JSON
 * completo) a ~4-8s (primer item). Devuelve el análisis completo al final.
 */
export async function analyzeWithOpenAIStream(
  imageDataUrl: string,
  opts: { apiKey: string; model: string; config?: VideoAnalysisConfig },
  onItem: (item: DetectedItem, index: number) => void
): Promise<FrameAnalysis> {
  const { createItemStreamParser } = await import("./streamingParser");
  const res = await visionFetch(imageDataUrl, opts, true);
  if (!res.body) throw new Error("Respuesta sin cuerpo del modelo de visión.");

  const parser = createItemStreamParser();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let sseBuffer = "";
  let emitted = 0;

  const cfg = opts.config;
  const handleDelta = (delta: string) => {
    for (const raw of parser.push(delta)) {
      const item = coerceItem(raw);
      if (!item || item.confidence < CONFIDENCE_THRESHOLD) continue;
      // Filtro de categoría + relationship EN EL STREAM: un objeto fuera de las
      // categorías seleccionadas (o del fondo en modo person-centric) no se
      // emite → no gasta llamadas de matching ni aparece en la UI.
      if (
        cfg &&
        (!isCategoryAllowed(item, cfg.categories) ||
          !isRelationshipAllowed(item.relationship, cfg))
      ) {
        continue;
      }
      onItem({ ...item, productLinks: buildProductLinks(item) }, emitted++);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    // Eventos SSE separados por doble salto de línea; cada uno "data: {...}".
    const events = sseBuffer.split("\n\n");
    sseBuffer = events.pop() ?? "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) handleDelta(delta);
        } catch {
          // chunk SSE parcial/keep-alive: ignorar
        }
      }
    }
  }

  const parsed = safeParseAnalysis(parser.fullText());
  if (!parsed) throw new Error("No se pudo interpretar la respuesta del modelo.");
  return applyConfigFilter(parsed, cfg);
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

  const RELATIONSHIPS = ["worn", "held", "used", "near_person", "background"] as const;
  const relationship = RELATIONSHIPS.includes(
    i.relationship as (typeof RELATIONSHIPS)[number]
  )
    ? (i.relationship as DetectedItem["relationship"])
    : undefined;

  return {
    name,
    category: asString(i.category, "general"),
    subcategory: asString(i.subcategory) || undefined,
    relationship,
    person_index:
      typeof i.person_index === "number" && Number.isInteger(i.person_index)
        ? i.person_index
        : null,
    person_association_score:
      typeof i.person_association_score === "number"
        ? clamp(i.person_association_score, 0, 1)
        : undefined,
    color: asString(i.color) || undefined,
    visible_brand:
      typeof i.visible_brand === "string" && i.visible_brand.trim()
        ? i.visible_brand.trim()
        : null,
    brand_guess:
      typeof i.brand_guess === "string" && i.brand_guess.trim()
        ? i.brand_guess.trim()
        : null,
    logo_visible: typeof i.logo_visible === "boolean" ? i.logo_visible : false,
    logo_description:
      typeof i.logo_description === "string" && i.logo_description.trim()
        ? i.logo_description.trim()
        : null,
    visible_text:
      typeof i.visible_text === "string" && i.visible_text.trim()
        ? i.visible_text.trim()
        : null,
    style: asString(i.style) || undefined,
    description: asString(i.description),
    search_query_es: asString(i.search_query_es) || name,
    alternative_queries: asStringArray(i.alternative_queries),
    verified_provider_queries: asStringArray(i.verified_provider_queries),
    confidence,
    purchase_relevance:
      typeof i.purchase_relevance === "number"
        ? clamp(i.purchase_relevance, 0, 1)
        : undefined,
    brand_evidence:
      typeof i.brand_evidence === "string" && i.brand_evidence.trim()
        ? i.brand_evidence.trim()
        : null,
    distinctive_features: asStringArray(i.distinctive_features),
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
  // Tolerar escala 0-100 (el modelo a veces devuelve porcentajes).
  const raw = (x: unknown): number | null => {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    return x > 1 ? x / 100 : x;
  };
  const rx = raw(b.x);
  const ry = raw(b.y);
  const rw = raw(b.width);
  const rh = raw(b.height);
  if (rx === null || ry === null || rw === null || rh === null) return null;

  // Clamp coherente: x/y a [0,1] y width/height a lo que quede hasta el borde
  // (garantiza x+width ≤ 1 e y+height ≤ 1, no solo clamps individuales).
  const x = clamp(rx, 0, 1);
  const y = clamp(ry, 0, 1);
  const width = clamp(rw, 0, 1 - x);
  const height = clamp(rh, 0, 1 - y);
  if (width <= 0 || height <= 0) {
    console.warn("[vision] bounding_box inválida descartada", { x: rx, y: ry, w: rw, h: rh });
    return null;
  }
  return { x, y, width, height };
}

/**
 * Normalize an analysis: attach product links, drop low-confidence items,
 * sort by a composite score (confidence + buyability + visual prominence).
 */
export function normalizeAnalysis(analysis: FrameAnalysis): FrameAnalysis {
  // Saneado geométrico:
  //  - Cajas absurdamente grandes (≈ escena/persona completa) se anulan: el
  //    item se conserva pero sin caja — no pintamos media pantalla.
  //  - NMS entre items de la misma categoría muy solapados (duplicados).
  const sanitized = suppressDuplicateBoxes(
    analysis.items.map((it) =>
      it.bounding_box && isOversizedBox(it.bounding_box)
        ? { ...it, bounding_box: null }
        : it
    )
  );

  const items = sanitized
    .filter((it) => it.confidence >= CONFIDENCE_THRESHOLD)
    .map((it) => {
      const area = it.bounding_box
        ? it.bounding_box.width * it.bounding_box.height
        : 0.25;
      const relevance =
        it.purchase_relevance ?? buyabilityScore(it.category) * 0.8;
      // Scoring PERSON-CENTRIC: lo que la persona lleva/sostiene manda; el
      // fondo genérico (puertas, palmeras, barandillas) queda penalizado y
      // nunca desplaza a una prenda o un reloj.
      const association = personAssociationScore(it);
      const distinctiveness =
        it.logo_visible ||
        Boolean(it.visible_text) ||
        (it.pattern && !/^(liso|plain|solid)$/i.test(it.pattern))
          ? 1
          : 0.3;
      const visibility = Math.min(1, area * 4) * it.confidence;
      const backgroundPenalty =
        it.relationship === "background" || presentationPriority(it) === "low"
          ? -0.3
          : 0;
      const score =
        association * 0.45 +
        relevance * 0.25 +
        visibility * 0.2 +
        distinctiveness * 0.1 +
        backgroundPenalty;
      return { ...it, productLinks: buildProductLinks(it), score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MAX_OBJECTS_PER_FRAME);

  return { ...analysis, items };
}

function buyabilityScore(category: string): number {
  const c = category.toLowerCase();
  // El modelo devuelve categorías en ES o EN indistintamente: cubrir ambas.
  const high = [
    "ropa", "camisa", "camiseta", "calzado", "zapat", "electr", "mueble",
    "accesorio", "bolso", "reloj", "gafas", "coche",
    "shirt", "t-shirt", "hoodie", "watch", "sneaker", "shoe", "bag",
    "glasses", "laptop", "monitor", "phone", "camera", "car", "furniture",
    "electronics", "chair", "headphone",
  ];
  const mid = [
    "decora", "hogar", "deport", "belleza", "gadget",
    "mug", "taza", "lamp", "lampara", "bottle", "home", "decor", "sport", "beauty",
  ];
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
