import { NextRequest, NextResponse } from "next/server";
import { cancelAnalysisJob } from "@/lib/analysis/jobs";
import { buildJobEngineDeps } from "@/lib/analysis/jobs/serverDeps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/analysis/jobs/[id]/cancel — cancela el job (idempotente). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const result = await cancelAnalysisJob(id, buildJobEngineDeps(req.nextUrl.origin));
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, job: result.job });
}
