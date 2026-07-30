import { handleAnalyzeFrameStream } from "@/lib/server/analyzeFrameHandler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vision/analyze-frame-stream — detección en streaming (NDJSON).
 * Mismo contrato de entrada que /api/vision/analyze-frame; la salida emite
 * cada objeto detectado según lo genera el modelo (ver analyzeFrameHandler).
 */
export const POST = handleAnalyzeFrameStream;
