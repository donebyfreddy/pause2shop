import type { NextRequest } from "next/server";
import { handleAnalyzeFrame } from "@/lib/server/analyzeFrameHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vision/analyze-frame
 * Analiza un frame, guarda los elementos detectados en el catálogo (con
 * deduplicación) y devuelve los items + recomendaciones iniciales.
 */
export function POST(req: NextRequest) {
  return handleAnalyzeFrame(req);
}
