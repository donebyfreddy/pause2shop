import { NextRequest, NextResponse } from "next/server";
import { finalizeAnalysisJob, getJobStatusView } from "@/lib/analysis/jobs";
import { buildJobEngineDeps } from "@/lib/analysis/jobs/serverDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/analysis/jobs/[id]/finalize — cierra el job: dedup GLOBAL entre
 * tracks (el mismo objeto que reaparece con otro trackId se funde en un único
 * producto) y matching por producto único con su mejor crop, respetando
 * MAX_EXTERNAL_SEARCHES_PER_PRODUCT. Idempotente.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const deps = buildJobEngineDeps(req.nextUrl.origin);
  const result = await finalizeAnalysisJob(id, deps);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  const view = await getJobStatusView(id, { store: deps.store });
  return NextResponse.json({ ok: true, job: view });
}
