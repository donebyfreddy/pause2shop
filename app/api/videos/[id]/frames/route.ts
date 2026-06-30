import { NextRequest, NextResponse } from "next/server";
import { getCatalogRepository } from "@/lib/catalog";
import type { FramesResponse } from "@/lib/api/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/videos/:id/frames — frames analizados de un vídeo. */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/videos/[id]/frames">
): Promise<NextResponse<FramesResponse>> {
  const { id } = await ctx.params;
  try {
    const repo = getCatalogRepository();
    const [frames, videos] = await Promise.all([
      repo.listFramesByVideo(id),
      repo.listVideos(),
    ]);
    const video = videos.find((v) => v.id === id) ?? null;
    return NextResponse.json({ ok: true, video, frames });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
