import { NextResponse, type NextRequest } from "next/server";
import { catalogRoute } from "@/lib/catalogService/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  return catalogRoute(`/settings${req.nextUrl.search}`, { method: "GET" });
}
