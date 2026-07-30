import { NextRequest, NextResponse } from "next/server";
import { processFrameBatch, type FramePayload } from "@/lib/analysis/jobs";
import { buildJobEngineDeps } from "@/lib/analysis/jobs/serverDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Techo defensivo del payload del lote (~25 frames JPEG 1280px + thumbs).
const MAX_BATCH_BYTES = 24 * 1024 * 1024;

/**
 * POST /api/analysis/jobs/[id]/frames — recibe un LOTE de frames extraídos
 * por el cliente. Segmentos con checkpoint: los timestamps ya procesados se
 * ignoran (reenvío tras un corte = reanudación sin trabajo duplicado).
 * Devuelve las detecciones con trackId (overlay en vivo) y cropRequests: los
 * mejores encuadres cuyos crops reales debe subir el cliente a /crops.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params;

  const raw = await req.text();
  if (raw.length > MAX_BATCH_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Lote demasiado grande: envía menos frames por petición." },
      { status: 413 }
    );
  }
  let body: { frames?: FramePayload[] };
  try {
    body = JSON.parse(raw) as { frames?: FramePayload[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }
  if (!Array.isArray(body.frames) || body.frames.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Falta `frames` (array no vacío)." },
      { status: 400 }
    );
  }

  const deps = buildJobEngineDeps(req.nextUrl.origin);
  const processed = await processFrameBatch(id, body.frames, deps);
  if (!processed.ok) {
    return NextResponse.json(
      { ok: false, error: processed.error },
      { status: processed.status }
    );
  }
  return NextResponse.json({ ok: true, ...processed.result });
}
