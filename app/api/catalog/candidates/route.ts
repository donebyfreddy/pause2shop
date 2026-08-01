import { NextRequest, NextResponse } from "next/server";
import { getExternalCandidateStore } from "@/lib/videoProcessing/candidateStore";
import type { CatalogCandidateStatus } from "@/lib/videoProcessing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set<CatalogCandidateStatus>([
  "external_candidate",
  "review_required",
  "approved",
  "rejected",
  "published",
]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rawStatus = req.nextUrl.searchParams.get("status");
  const status = rawStatus && STATUSES.has(rawStatus as CatalogCandidateStatus)
    ? (rawStatus as CatalogCandidateStatus)
    : undefined;
  const candidates = await getExternalCandidateStore().list({
    status,
    limit: Number(req.nextUrl.searchParams.get("limit") ?? 100),
  });
  return NextResponse.json({ ok: true, candidates });
}
