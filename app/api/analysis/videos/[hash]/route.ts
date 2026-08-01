import { NextRequest, NextResponse } from "next/server";
import { getJobStatusView } from "@/lib/analysis/jobs";
import { buildJobEngineDeps } from "@/lib/analysis/jobs/serverDeps";
import { isSha256 } from "@/lib/videoProcessing/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ hash: string }> };

export async function GET(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { hash } = await params;
  if (!isSha256(hash)) {
    return NextResponse.json({ ok: false, error: "Hash inválido." }, { status: 400 });
  }
  const deps = buildJobEngineDeps(req.nextUrl.origin);
  const catalogVersion = process.env.CATALOG_VERSION?.trim() || "catalog:v1";
  const analysisVersion = process.env.VIDEO_ANALYSIS_VERSION?.trim() || "video-pipeline:v2";
  const job = await deps.store.findReusableJob(hash, catalogVersion, analysisVersion);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Vídeo no procesado." }, { status: 404 });
  }
  const view = await getJobStatusView(job.id, deps);
  const rawTime = req.nextUrl.searchParams.get("time");
  const time = rawTime == null ? null : Number(rawTime);
  const products =
    view?.products.filter(
      (product) =>
        time == null ||
        !Number.isFinite(time) ||
        product.segments.some(
          (segment) => time >= segment.startSeconds - 0.25 && time <= segment.endSeconds + 0.25
        )
    ) ?? [];
  return NextResponse.json({
    ok: true,
    cached: true,
    reused: true,
    video: view?.media,
    jobId: job.id,
    timestampSeconds: Number.isFinite(time) ? time : null,
    products,
  });
}
