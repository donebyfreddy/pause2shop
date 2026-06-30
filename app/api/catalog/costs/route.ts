import { NextResponse } from "next/server";
import { getCostSummary } from "@/lib/server/costTracker";

export const dynamic = "force-dynamic";

export function GET() {
  const summary = getCostSummary();
  return NextResponse.json({ ok: true, ...summary });
}
