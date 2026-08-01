import { NextRequest, NextResponse } from "next/server";
import { getCatalogClient } from "@/lib/matching/catalogClient";
import { getExternalCandidateStore } from "@/lib/videoProcessing/candidateStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    action?: "approve" | "reject";
    reviewedBy?: string;
  } | null;
  if (body?.action !== "approve" && body?.action !== "reject") {
    return NextResponse.json({ ok: false, error: "Acción inválida." }, { status: 400 });
  }

  const store = getExternalCandidateStore();
  const candidate = await store.get(id);
  if (!candidate) {
    return NextResponse.json({ ok: false, error: "Candidato no encontrado." }, { status: 404 });
  }
  if (body.action === "reject") {
    const rejected = await store.updateStatus(id, "rejected", {
      reviewedBy: body.reviewedBy,
    });
    return NextResponse.json({ ok: true, candidate: rejected });
  }

  await store.updateStatus(id, "approved", { reviewedBy: body.reviewedBy });
  const provider = candidate.provider as
    | "serpapi_google_lens"
    | "searchapi_google_lens"
    | "serpapi_google_shopping"
    | "dataforseo_google_shopping";
  const created = await getCatalogClient().saveExternalProduct({
    provider,
    title: candidate.title,
    brand: candidate.brand ?? null,
    price: candidate.price ?? null,
    currency: candidate.currency ?? null,
    productUrl: candidate.productUrl,
    imageUrl: candidate.imageUrl,
    merchant: candidate.merchant ?? null,
    category: candidate.category ?? null,
    color: typeof candidate.attributes.color === "string" ? candidate.attributes.color : null,
    score: candidate.finalScore,
    evidence: candidate.evidence,
    approved: true,
    candidateId: candidate.id,
    reviewedBy: body.reviewedBy ?? "admin",
    sourcePage: candidate.sourcePage ?? candidate.productUrl,
    originalImageUrl: candidate.originalImageUrl ?? candidate.imageUrl,
  });
  if (!created.ok) {
    return NextResponse.json(
      { ok: false, error: created.error.message, candidateStatus: "approved" },
      { status: 502 }
    );
  }
  const published = await store.updateStatus(id, "published", {
    reviewedBy: body.reviewedBy,
    catalogProductId: created.data.productId,
  });
  return NextResponse.json({ ok: true, candidate: published, product: created.data });
}
