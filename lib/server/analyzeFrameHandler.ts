import { NextRequest, NextResponse } from "next/server";
import {
  getCatalogRepository,
  isPersistentCatalog,
  normalizeDetectedItem,
} from "@/lib/catalog";
import type { FrameSourceType } from "@/lib/catalog/types";
import { searchProducts } from "@/lib/products/searchProducts";
import { analyzeWithOpenAI, mockAnalysis, normalizeAnalysis } from "@/lib/vision";
import type {
  AnalyzeFrameApiResponse,
  FrameMeta,
  SavedCatalogItem,
} from "@/lib/api/types";
import type { FrameAnalysis } from "@/lib/types";
import { trackVisionCall, trackProductCalls } from "@/lib/server/costTracker";

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

function bad(error: string, status = 400): NextResponse<AnalyzeFrameApiResponse> {
  return NextResponse.json({ ok: false, error }, { status });
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
    if (file instanceof Blob) {
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        return { imageDataUrl: null, meta }; // se valida arriba como 413
      }
      const mime = file.type || "image/jpeg";
      return {
        imageDataUrl: `data:${mime};base64,${buf.toString("base64")}`,
        meta,
      };
    }
  }

  return { imageDataUrl: null, meta };
}

/**
 * Persiste el análisis en el catálogo: upsert de vídeo, frame, items (con
 * deduplicación) y recomendaciones iniciales. Resiliente: si la persistencia
 * falla, no rompe la respuesta de visión (devuelve warning).
 *
 * NOTA de privacidad: NO se guardan imágenes del frame en el servidor (igual
 * que el resto de la app). Sí se guarda el bounding_box para poder recortar en
 * un paso futuro con Supabase Storage. Ver README → "Siguientes pasos".
 */
async function persist(
  analysis: FrameAnalysis,
  meta: Partial<FrameMeta>
): Promise<{
  persisted: boolean;
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
    });
    const { item, created } = await repo.upsertDetectedItem(input);
    saved.push({ item, created, recommendations: [] });
  }

  // Recomendaciones iniciales (matching automático) para los items más fiables.
  // En paralelo y con tope, para acotar coste/latencia de las llamadas a OpenAI.
  const topIndexes = saved
    .map((s, idx) => ({ idx, c: s.item.confidence }))
    .sort((a, b) => b.c - a.c)
    .slice(0, INITIAL_REC_ITEMS)
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

  return {
    persisted: isPersistentCatalog(),
    videoId: video.id,
    frameId: frame.id,
    items: saved,
  };
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

  const { imageDataUrl, meta } = parsed;
  if (!imageDataUrl || !imageDataUrl.startsWith("data:image/")) {
    return bad("Falta una imagen válida (data URL en base64).");
  }

  const commaIdx = imageDataUrl.indexOf(",");
  const approxBytes = commaIdx === -1 ? 0 : (imageDataUrl.length - commaIdx) * 0.75;
  if (approxBytes > MAX_IMAGE_BYTES) {
    return bad("La imagen es demasiado grande.", 413);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.VISION_MODEL || "gpt-4.1-mini";

  // 1) Visión (real o mock).
  let analysis: FrameAnalysis;
  let mock = false;
  try {
    if (!apiKey) {
      analysis = normalizeAnalysis(mockAnalysis());
      mock = true;
    } else {
      analysis = normalizeAnalysis(
        await analyzeWithOpenAI(imageDataUrl, { apiKey, model })
      );
    }
    trackVisionCall(mock);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return bad(`No se pudo analizar el frame: ${message}`, 502);
  }

  // 2) Persistencia en catálogo (resiliente).
  try {
    const result = await persist(analysis, meta);
    return NextResponse.json({ ok: true, analysis, mock, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    // La visión funcionó; no rompemos la respuesta por un fallo de catálogo.
    return NextResponse.json({
      ok: true,
      analysis,
      mock,
      persisted: false,
      videoId: null,
      frameId: null,
      items: [],
      warning: `El análisis funcionó pero no se pudo guardar en el catálogo: ${message}`,
    });
  }
}
