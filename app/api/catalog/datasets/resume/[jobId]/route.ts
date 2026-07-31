import { type NextResponse } from "next/server";
import { catalogRoute } from "@/lib/catalogService/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Reanuda una importación desde el checkpoint del job indicado. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const { jobId } = await ctx.params;
  return catalogRoute(`/datasets/resume/${encodeURIComponent(jobId)}`, {
    method: "POST",
    background: true,
  });
}
