import { NextRequest, NextResponse } from "next/server";
import { getJobAppearances, getJobStatusView } from "@/lib/analysis/jobs";
import { buildJobEngineDeps } from "@/lib/analysis/jobs/serverDeps";
import { isSha256 } from "@/lib/videoProcessing/hash";
import type { DetectedItem } from "@/lib/types";
import type { DetectionMatchResult, ProductCandidate } from "@/lib/matching/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ hash: string }> };

function candidate(match: {
  source: "catalog" | "external";
  productId: string | null;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  productUrl: string;
  price: number | null;
  currency: string | null;
  merchant: string | null;
  category: string | null;
  matchType: "exact" | "probable" | "similar";
  scores: { finalScore: number };
}): ProductCandidate {
  return {
    id: match.productId ?? `${match.source}:${match.productUrl}`,
    title: match.title,
    brand: match.brand,
    imageUrl: match.imageUrl,
    price: match.price,
    currency: match.currency,
    productUrl: match.productUrl,
    category: match.category,
    merchant: match.merchant,
    score: match.scores.finalScore,
    source: match.source,
    matchType: match.matchType,
  };
}

/** Reconstruye el contrato del panel desde el matching ya persistido del VOD. */
function persistedDetection(
  item: DetectedItem,
  timestampSeconds: number,
  boundingBox: DetectedItem["bounding_box"],
  matching: NonNullable<Awaited<ReturnType<typeof getJobStatusView>>>["products"][number]["matching"]
): DetectedItem {
  const matches = matching?.matches ?? [];
  const catalogCandidates = matches.filter((match) => match.source === "catalog").map(candidate);
  const externalCandidates = matches.filter((match) => match.source === "external").map(candidate);
  const catalogSelected = catalogCandidates[0];
  const externalSelected = externalCandidates[0];
  const catalogMatched = matching?.matchLabel === "CATALOG_MATCH" && Boolean(catalogSelected);
  const externalMatched = matching?.matchLabel === "EXTERNAL_MATCH" && Boolean(externalSelected);
  const detection: DetectionMatchResult = {
    detectionId: `vod:${item.name}:${timestampSeconds.toFixed(3)}`,
    label: item.name,
    confidence: item.confidence,
    boundingBox: boundingBox ?? null,
    timestampSeconds,
    catalog: {
      status: catalogMatched ? "matched" : "unresolved",
      selected: catalogMatched ? catalogSelected : undefined,
      candidates: catalogCandidates,
      threshold: Number(process.env.CATALOG_MATCH_THRESHOLD ?? "0.80"),
      unresolvedReason: catalogMatched ? undefined : matching?.unresolvedReason,
    },
    external: {
      status: externalMatched ? "matched" : externalCandidates.length ? "unresolved" : "not_requested",
      selected: externalMatched ? externalSelected : undefined,
      candidates: externalCandidates,
      provider: matching?.providerUsed ?? undefined,
      threshold: Number(process.env.EXTERNAL_MATCH_THRESHOLD ?? "0.72"),
      unresolvedReason: externalMatched ? undefined : matching?.unresolvedReason,
    },
    matchingMode: "catalog_first",
  };
  return {
    ...item,
    bounding_box: boundingBox ?? null,
    detection_result: detection,
    matchingStatus: catalogMatched || externalMatched ? "matched" : "no_match",
  };
}

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
  const appearances = await getJobAppearances(job.id, deps);
  const detections =
    time == null || !Number.isFinite(time)
      ? []
      : products.map((product) => {
          const closest = appearances
            .filter((appearance) => product.trackIds.includes(appearance.trackId))
            .sort(
              (a, b) =>
                Math.abs(a.timestampSeconds - time) - Math.abs(b.timestampSeconds - time)
            )[0];
          return persistedDetection(
            product.item,
            time,
            closest?.box ?? product.item.bounding_box ?? null,
            product.matching
          );
        });
  return NextResponse.json({
    ok: true,
    cached: true,
    reused: true,
    video: view?.media,
    jobId: job.id,
    timestampSeconds: Number.isFinite(time) ? time : null,
    products,
    detections,
  });
}
