import { NextRequest, NextResponse } from "next/server";
import { getCatalogRepository } from "@/lib/catalog";
import type { FeedbackAction } from "@/lib/catalog/types";
import type { FeedbackResponse } from "@/lib/api/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: FeedbackAction[] = [
  "clicked",
  "saved",
  "rejected",
  "purchased",
  "ignored",
];

/**
 * POST /api/catalog/feedback
 * Body: { detectedItemId, recommendationId?, action }
 */
export async function POST(
  req: NextRequest
): Promise<NextResponse<FeedbackResponse>> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON no válido." },
      { status: 400 }
    );
  }

  const detectedItemId = typeof body.detectedItemId === "string" ? body.detectedItemId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const recommendationId =
    typeof body.recommendationId === "string" ? body.recommendationId : null;

  if (!detectedItemId) {
    return NextResponse.json(
      { ok: false, error: "Falta detectedItemId." },
      { status: 400 }
    );
  }
  if (!(ACTIONS as string[]).includes(action)) {
    return NextResponse.json(
      { ok: false, error: `action no válida. Usa: ${ACTIONS.join(", ")}.` },
      { status: 400 }
    );
  }

  try {
    const feedback = await getCatalogRepository().addFeedback({
      detectedItemId,
      recommendationId,
      action: action as FeedbackAction,
    });
    return NextResponse.json({ ok: true, feedback });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
