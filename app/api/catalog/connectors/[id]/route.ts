import { NextResponse, type NextRequest } from "next/server";
import { catalogRoute } from "@/lib/catalogService/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  return catalogRoute(`/connectors/${id}${req.nextUrl.search}`, { method: "GET" });
}
