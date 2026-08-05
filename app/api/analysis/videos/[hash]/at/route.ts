import { NextRequest, NextResponse } from "next/server";
import { findProductsAtTimestamp } from "@/lib/analysis/jobs/timestampQuery";
import { isSha256 } from "@/lib/videoProcessing/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/analysis/videos/[hash]/at?ms=47000 — catálogo del vídeo en un
 * instante: qué productos únicos están activos en ese timestamp.
 *
 * Se resuelve contra `video_product_occurrences` (una fila por producto único,
 * con su rango de aparición indexado), no recorriendo apariciones en memoria.
 * Es la consulta que responde una pausa, y por eso tiene que ser barata.
 *
 * Distinto de `GET /api/analysis/videos/[hash]?time=…`, que reconstruye el
 * panel completo del job desde su estado de runtime: aquel sirve la demo, este
 * sirve la integración (playout, panel editorial, API de terceros).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ hash: string }> }
): Promise<NextResponse> {
  const { hash } = await ctx.params;
  if (!isSha256(hash)) {
    return NextResponse.json({ ok: false, error: "Hash inválido." }, { status: 400 });
  }

  const raw = req.nextUrl.searchParams.get("ms");
  const timestampMs = Number(raw);
  if (raw == null || !Number.isFinite(timestampMs) || timestampMs < 0) {
    return NextResponse.json(
      { ok: false, error: "Falta el parámetro `ms` (entero, milisegundos)." },
      { status: 400 }
    );
  }

  const rawTolerance = req.nextUrl.searchParams.get("toleranceMs");
  const toleranceMs = Number(rawTolerance);
  const editorialStatus =
    req.nextUrl.searchParams.get("editorialStatus")?.trim() || undefined;

  try {
    const products = await findProductsAtTimestamp({
      videoHash: hash,
      timestampMs,
      ...(Number.isFinite(toleranceMs) && toleranceMs >= 0
        ? { toleranceSeconds: toleranceMs / 1000 }
        : {}),
      ...(editorialStatus ? { editorialStatus } : {}),
    });
    return NextResponse.json({ ok: true, timestampMs, products });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message.slice(0, 200) : "Consulta fallida.",
      },
      { status: 500 }
    );
  }
}
