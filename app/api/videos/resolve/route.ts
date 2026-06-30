import { NextRequest, NextResponse } from "next/server";
import { detectVideoProvider, PROVIDER_LABELS } from "@/lib/video/detectVideoProvider";
import type { VideoProviderDetectionResult } from "@/lib/video/types";

type ResolveResponse =
  | ({ ok: true } & VideoProviderDetectionResult & { providerLabel: string })
  | { ok: false; error: string };

export async function POST(req: NextRequest): Promise<NextResponse<ResolveResponse>> {
  let url: string;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON inválido." }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json({ ok: false, error: "Falta el campo 'url'." }, { status: 400 });
  }

  try {
    new URL(url);
  } catch {
    return NextResponse.json({ ok: false, error: "URL no válida." }, { status: 400 });
  }

  const result = detectVideoProvider(url);
  return NextResponse.json({
    ok: true,
    ...result,
    providerLabel: PROVIDER_LABELS[result.provider],
  });
}
