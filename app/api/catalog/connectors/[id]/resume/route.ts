import { NextResponse, type NextRequest } from "next/server";
import { catalogRoute, readJsonBody, InvalidBodyError } from "@/lib/catalogService/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof InvalidBodyError) {
      return NextResponse.json({ error: { code: "invalid_body", message: err.message } }, { status: 400 });
    }
    throw err;
  }
  return catalogRoute(`/connectors/__ID__/resume`.replace("__ID__", id), { method: "POST", body, background: false });
}
