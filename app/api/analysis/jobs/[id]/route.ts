import { NextRequest, NextResponse } from "next/server";
import { getJobStatusView } from "@/lib/analysis/jobs";
import { getAnalysisJobStore } from "@/lib/analysis/jobs/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/analysis/jobs/[id] — estado completo del job: status, progreso
 * (frames recibidos/analizados, escenas, tracks, productos únicos), llamadas
 * caras evitadas (frames dedup, tracks fundidos, cache/catalog hits), timings
 * por etapa y timeline de apariciones por producto.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const view = await getJobStatusView(id, { store: getAnalysisJobStore() });
  if (!view) {
    return NextResponse.json({ ok: false, error: "Job no encontrado." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, job: view });
}
