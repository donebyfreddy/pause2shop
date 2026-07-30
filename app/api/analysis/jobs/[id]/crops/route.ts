import { NextRequest, NextResponse } from "next/server";
import { attachCrops, type CropPayload } from "@/lib/analysis/jobs";
import { buildJobEngineDeps } from "@/lib/analysis/jobs/serverDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/analysis/jobs/[id]/crops — el cliente sube los crops REALES
 * pedidos en cropRequests (mejor encuadre por track). El matching final por
 * producto único usará este crop; sin él se degrada al frame completo.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: { crops?: CropPayload[] };
  try {
    body = (await req.json()) as { crops?: CropPayload[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo inválido." }, { status: 400 });
  }
  if (!Array.isArray(body.crops) || body.crops.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Falta `crops` (array no vacío)." },
      { status: 400 }
    );
  }
  const result = await attachCrops(id, body.crops, buildJobEngineDeps(req.nextUrl.origin));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, attached: result.attached });
}
