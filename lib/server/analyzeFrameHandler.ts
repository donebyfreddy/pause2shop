import { NextRequest, NextResponse } from "next/server";
import {
  getCatalogRepository,
  getPersistenceMode,
  isPersistentCatalog,
  normalizeDetectedItem,
} from "@/lib/catalog";
import type { FrameSourceType, RecommendationInput } from "@/lib/catalog/types";
import { searchProducts } from "@/lib/products/searchProducts";
import {
  analyzeWithOpenAI,
  analyzeWithOpenAIStream,
  mockAnalysis,
  normalizeAnalysis,
} from "@/lib/vision";
import type {
  AnalyzeFrameApiResponse,
  FrameMeta,
  PersistenceStatus,
  SavedCatalogItem,
} from "@/lib/api/types";
import type { FrameAnalysis, VideoAnalysisConfig } from "@/lib/types";
import {
  isCategoryAllowed,
  isRelationshipAllowed,
  parseConfig,
} from "@/lib/analysis/categories";
import { trackVisionCall, trackProductCalls } from "@/lib/server/costTracker";
import { enrichAnalysisWithVisualMatches } from "@/lib/visualSearch/engine";
import type { EnrichedItem } from "@/lib/visualSearch/types";
import { toAnalysisFailure } from "@/lib/errors";

// ~8MB techo del payload de imagen decodificada para proteger la función.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Cuántos items, como máximo, reciben recomendaciones iniciales por análisis.
// Configurable: con OpenAI cada item = 1 llamada, así que mantenemos un tope bajo.
const INITIAL_REC_ITEMS = Number(process.env.INITIAL_MATCH_ITEMS) || 3;

// Rate limiter en memoria (best-effort, por instancia de servidor).
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > RATE_LIMIT;
}

function clientKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

function bad(
  error: string,
  status = 400,
  errorDetail?: string
): NextResponse<AnalyzeFrameApiResponse> {
  return NextResponse.json({ ok: false, error, errorDetail }, { status });
}

const SOURCE_TYPES: FrameSourceType[] = [
  "uploaded",
  "youtube",
  "screen_capture",
  "external_url",
  "dailymotion",
  "vimeo",
  "direct_mp4",
  "hls",
  "image_upload",
];

/** Derivado del sourceType para determinar mediaType sin importar MediaType explícito. */
function mediaTypeForSource(
  sourceType: FrameSourceType
): "video" | "image" | "screen_capture" {
  if (sourceType === "image_upload") return "image";
  if (sourceType === "screen_capture") return "screen_capture";
  return "video";
}

function coerceSourceType(v: unknown): FrameSourceType {
  return typeof v === "string" && (SOURCE_TYPES as string[]).includes(v)
    ? (v as FrameSourceType)
    : "external_url";
}

type ParsedBody = {
  imageDataUrl: string | null;
  meta: Partial<FrameMeta>;
  config: VideoAnalysisConfig;
};

async function parseBody(req: NextRequest): Promise<ParsedBody> {
  const contentType = req.headers.get("content-type") ?? "";
  const meta: Partial<FrameMeta> = {};

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as Record<string, unknown>;
    meta.sourceType = coerceSourceType(body.sourceType);
    meta.videoKey = typeof body.videoKey === "string" ? body.videoKey : undefined;
    meta.videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : undefined;
    meta.videoTitle =
      typeof body.videoTitle === "string" ? body.videoTitle : undefined;
    meta.timestampSeconds =
      typeof body.timestampSeconds === "number" ? body.timestampSeconds : 0;
    return {
      imageDataUrl: typeof body.image === "string" ? body.image : null,
      meta,
      config: parseConfig(body.analysisConfig),
    };
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("frame");
    meta.sourceType = coerceSourceType(form.get("sourceType"));
    meta.videoKey = (form.get("videoKey") as string) || undefined;
    meta.videoUrl = (form.get("videoUrl") as string) || undefined;
    meta.videoTitle = (form.get("videoTitle") as string) || undefined;
    meta.timestampSeconds = Number(form.get("timestampSeconds")) || 0;
    const formConfig = form.get("analysisConfig");
    const config = parseConfig(
      typeof formConfig === "string" ? safeJson(formConfig) : undefined
    );
    if (file instanceof Blob) {
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        return { imageDataUrl: null, meta, config }; // se valida arriba como 413
      }
      const mime = file.type || "image/jpeg";
      return {
        imageDataUrl: `data:${mime};base64,${buf.toString("base64")}`,
        meta,
        config,
      };
    }
    return { imageDataUrl: null, meta, config };
  }

  return { imageDataUrl: null, meta, config: parseConfig(undefined) };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Aplica el filtro de categorías/relationship al análisis mock. */
function filterMock(
  analysis: FrameAnalysis,
  config: VideoAnalysisConfig
): FrameAnalysis {
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
 * Convierte los candidatos rankeados del Visual Matching Engine en
 * recomendaciones persistibles (productos REALES con URL, imagen y precio,
 * en lugar de sugerencias generadas por el modelo).
 */
function recommendationsFromVisualMatch(
  item: EnrichedItem,
  limit = 6
): RecommendationInput[] {
  const ranked = item.visual_match?.ranked_candidates ?? [];
  return ranked
    .filter((c) => c.score > 0)
    .slice(0, limit)
    .map((c) => ({
      provider: c.source,
      title: c.title,
      productUrl: c.link,
      imageUrl: c.imageUrl,
      price: c.price,
      currency: c.currency ?? (c.price != null ? "EUR" : null),
      brand: c.brand,
      // Normalizamos el score de matching (~0-180) a 0-1 para la columna.
      similarityScore: Math.min(c.score / 150, 1),
      reason: `${c.matchType} match (${Math.round(c.score)} pts, ${c.source})`,
    }));
}

/**
 * Persiste el análisis en el catálogo: upsert de vídeo, frame, items (con
 * deduplicación) y recomendaciones iniciales. Resiliente: si la persistencia
 * falla, no rompe la respuesta de visión (devuelve warning).
 *
 * NOTA de privacidad: solo se guarda la URL del frame si el Visual Matching
 * Engine ya lo publicó en Storage para la búsqueda inversa (modo imagen). El
 * crop por objeto se persiste después vía /api/vision/match-object.
 */
async function persist(
  analysis: FrameAnalysis,
  meta: Partial<FrameMeta>,
  frameImageUrl: string | null = null
): Promise<{
  persisted: boolean;
  persistence: PersistenceStatus;
  videoId: string | null;
  frameId: string | null;
  items: SavedCatalogItem[];
  warning?: string;
}> {
  const repo = getCatalogRepository();
  const sourceType = meta.sourceType ?? "external_url";
  const externalKey =
    meta.videoKey?.trim() ||
    meta.videoUrl?.trim() ||
    `${sourceType}:adhoc`;
  const timestampSeconds = meta.timestampSeconds ?? 0;

  const video = await repo.upsertVideoSource({
    externalKey,
    sourceType,
    title: meta.videoTitle ?? null,
    url: meta.videoUrl ?? null,
    mediaType: mediaTypeForSource(sourceType),
    provider: meta.provider ?? sourceType,
    normalizedUrl: meta.normalizedUrl ?? meta.videoUrl ?? null,
    embedUrl: meta.embedUrl ?? null,
    canEmbed: meta.canEmbed ?? (sourceType !== "image_upload"),
    canCaptureFrame: meta.canCaptureFrame ?? (sourceType === "direct_mp4" || sourceType === "hls" || sourceType === "uploaded"),
  });

  const frame = await repo.createFrame({
    videoId: video.id,
    timestampSeconds,
    sourceType,
    sceneSummary: analysis.summary || null,
    styleVibe: analysis.style_vibe || null,
    analysisStatus: "completed",
    rawVisionResponse: analysis,
  });

  const saved: SavedCatalogItem[] = [];
  for (const visionItem of analysis.items) {
    const input = normalizeDetectedItem(visionItem, {
      videoId: video.id,
      frameId: frame.id,
      sourceType,
      sourceUrl: meta.videoUrl ?? null,
      timestampSeconds,
      frameImageUrl,
    });
    const { item, created } = await repo.upsertDetectedItem(input);
    saved.push({ item, created, recommendations: [] });
  }

  // Recomendaciones: si el Visual Matching Engine encontró productos reales
  // (Lens/Shopping), se persisten esos. Solo si no hay match visual se cae al
  // matching automático con OpenAI, con tope para acotar coste/latencia.
  const visualRecIndexes = new Set<number>();
  await Promise.allSettled(
    saved.map(async (entry, idx) => {
      const recs = recommendationsFromVisualMatch(analysis.items[idx]);
      if (recs.length) {
        entry.recommendations = await repo.replaceRecommendations(
          entry.item.id,
          recs
        );
        visualRecIndexes.add(idx);
      }
    })
  );

  const topIndexes = saved
    .map((s, idx) => ({ idx, c: s.item.confidence }))
    .filter((x) => !visualRecIndexes.has(x.idx))
    .sort((a, b) => b.c - a.c)
    // Para frames de vídeo el matching real corre asíncrono en el cliente
    // (/api/vision/match-object): no pagamos aquí la latencia de las
    // sugerencias OpenAI inline — solo para imágenes sueltas.
    .slice(0, sourceType === "image_upload" ? INITIAL_REC_ITEMS : 0)
    .map((x) => x.idx);

  await Promise.allSettled(
    topIndexes.map(async (idx) => {
      const entry = saved[idx];
      if (entry.created) {
        const recs = await searchProducts(entry.item, { limit: 6 });
        if (recs.length) {
          entry.recommendations = await repo.replaceRecommendations(
            entry.item.id,
            recs
          );
          trackProductCalls(1);
        }
      } else {
        entry.recommendations = await repo.listRecommendations(entry.item.id);
      }
    })
  );

  const persistence = getPersistenceMode();
  return {
    persisted: isPersistentCatalog(),
    persistence,
    videoId: video.id,
    frameId: frame.id,
    items: saved,
    warning:
      persistence === "memory_fallback"
        ? "El análisis se completó. El catálogo se sincronizará cuando vuelva la conexión."
        : undefined,
  };
}

/**
 * Variante en STREAMING (NDJSON) de analyze-frame. Emite una línea JSON por
 * evento para que el cliente pinte cada objeto según lo genera el modelo:
 *   {"type":"start"}
 *   {"type":"item","item":{…},"index":0}        ← uno por objeto, en vivo
 *   {"type":"analysis","analysis":{…}}          ← análisis completo normalizado
 *   {"type":"complete", persisted, persistence, videoId, frameId, items,
 *     warning?, timings}
 *   {"type":"error","error":"…"}                ← solo si la visión falla
 */
export async function handleAnalyzeFrameStream(
  req: NextRequest
): Promise<NextResponse | Response> {
  if (rateLimited(clientKey(req))) {
    return bad(
      "Demasiadas peticiones. Espera unos segundos e inténtalo de nuevo.",
      429
    );
  }

  let parsed: ParsedBody;
  try {
    parsed = await parseBody(req);
  } catch {
    return bad("No se pudo leer el cuerpo de la petición.");
  }
  const { imageDataUrl, meta, config } = parsed;
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    return bad("Falta una imagen válida (data URL en base64).");
  }
  const commaIdx = imageDataUrl.indexOf(",");
  const approxBytes = commaIdx === -1 ? 0 : (imageDataUrl.length - commaIdx) * 0.75;
  if (approxBytes > MAX_IMAGE_BYTES) {
    return bad("La imagen es demasiado grande.", 413);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.VISION_MODEL || "gpt-5-mini";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const timings: Record<string, number> = {};
      const tStart = Date.now();
      send({ type: "start" });

      let analysis: FrameAnalysis;
      let mock = false;
      try {
        if (!apiKey) {
          analysis = normalizeAnalysis(filterMock(mockAnalysis(), config));
          mock = true;
          analysis.items.forEach((item, index) => send({ type: "item", item, index }));
        } else {
          analysis = normalizeAnalysis(
            await analyzeWithOpenAIStream(
              imageDataUrl,
              { apiKey, model, config },
              (item, index) => send({ type: "item", item, index })
            )
          );
        }
        trackVisionCall(mock);
      } catch (err) {
        const failure = toAnalysisFailure(err);
        console.error("[analyze-frame-stream] fallo de visión:", failure.detail);
        send({ type: "error", error: failure.message, errorDetail: failure.detail });
        controller.close();
        return;
      }
      timings.detectionMs = Date.now() - tStart;

      // Análisis completo normalizado (orden por relevancia + productLinks).
      send({ type: "analysis", analysis, mock });

      // Persistencia resiliente: nunca rompe el stream.
      try {
        const tPersist = Date.now();
        const result = await persist(analysis, meta);
        timings.persistenceMs = Date.now() - tPersist;
        timings.totalMs = Date.now() - tStart;
        send({ type: "complete", mock, ...result, timings });
      } catch (err) {
        timings.totalMs = Date.now() - tStart;
        send({
          type: "complete",
          mock,
          persisted: false,
          persistence: "memory_fallback",
          videoId: null,
          frameId: null,
          items: [],
          warning: `El análisis funcionó pero no se pudo guardar en el catálogo: ${err instanceof Error ? err.message : "error"}`,
          timings,
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

/** Lógica completa de POST /api/vision/analyze-frame (compartida). */
export async function handleAnalyzeFrame(
  req: NextRequest
): Promise<NextResponse<AnalyzeFrameApiResponse>> {
  if (rateLimited(clientKey(req))) {
    return bad(
      "Demasiadas peticiones. Espera unos segundos e inténtalo de nuevo.",
      429
    );
  }

  let parsed: ParsedBody;
  try {
    parsed = await parseBody(req);
  } catch {
    return bad("No se pudo leer el cuerpo de la petición.");
  }

  const { imageDataUrl, meta, config } = parsed;
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    return bad("Falta una imagen válida (data URL en base64).");
  }

  const commaIdx = imageDataUrl.indexOf(",");
  const approxBytes = commaIdx === -1 ? 0 : (imageDataUrl.length - commaIdx) * 0.75;
  if (approxBytes > MAX_IMAGE_BYTES) {
    return bad("La imagen es demasiado grande.", 413);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  // gpt-5-mini con reasoning minimal: en benchmark (2026-07) detecta ~12
  // objetos con boxes en ~17s vs 8 en ~36s de gpt-4.1-mini.
  const model = process.env.VISION_MODEL || "gpt-5-mini";

  // 1) Visión (real o mock).
  const timings: Record<string, number> = {};
  const tStart = Date.now();
  let analysis: FrameAnalysis;
  let mock = false;
  try {
    if (!apiKey) {
      analysis = normalizeAnalysis(filterMock(mockAnalysis(), config));
      mock = true;
    } else {
      analysis = normalizeAnalysis(
        await analyzeWithOpenAI(imageDataUrl, { apiKey, model, config })
      );
    }
    trackVisionCall(mock);
  } catch (err) {
    const failure = toAnalysisFailure(err);
    console.error("[analyze-frame] fallo de visión:", failure.detail);
    return bad(failure.message, 502, failure.detail);
  }
  timings.detectionMs = Date.now() - tStart;

  // 2) Visual Matching Engine: reverse image search (Google Lens) + shopping
  // real (SerpAPI/DataForSEO) con caché por hash. Best-effort: si no hay
  // motores configurados o fallan, los items conservan sus deep-links.
  let frameImageUrl: string | null = null;
  if (!mock) {
    const tEnrich = Date.now();
    const { items, outcome } = await enrichAnalysisWithVisualMatches(
      imageDataUrl,
      analysis
    );
    analysis = { ...analysis, items };
    frameImageUrl = outcome?.frameImageUrl ?? null;
    timings.enrichMs = Date.now() - tEnrich;
  }

  // 3) Persistencia en catálogo (resiliente).
  try {
    const tPersist = Date.now();
    const result = await persist(analysis, meta, frameImageUrl);
    timings.persistenceMs = Date.now() - tPersist;
    timings.totalMs = Date.now() - tStart;
    return NextResponse.json({ ok: true, analysis, mock, ...result, timings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    // La visión funcionó; no rompemos la respuesta por un fallo de catálogo.
    return NextResponse.json({
      ok: true,
      analysis,
      mock,
      persisted: false,
      persistence: "memory_fallback" as const,
      videoId: null,
      frameId: null,
      items: [],
      warning: `El análisis funcionó pero no se pudo guardar en el catálogo: ${message}`,
    });
  }
}
