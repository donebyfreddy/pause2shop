import { NextRequest, NextResponse } from "next/server";
import { getCrop } from "@/lib/server/cropStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/crops/[hash] — sirve un crop efímero publicado por el propio
 * servidor (proveedor `local` del adaptador de media, para que Google Lens pueda
 * descargar la imagen). El nombre es el sha256 del contenido (no enumerable)
 * y las entradas expiran solas (CROP_STORE_TTL_MS).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ hash: string }> }
): Promise<NextResponse> {
  const { hash } = await ctx.params;
  // "abc123.jpg" → "abc123"; solo hex para evitar cualquier path malicioso.
  const clean = hash.split(".")[0].toLowerCase();
  if (!/^[a-f0-9]{16,64}$/.test(clean)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const crop = getCrop(clean);
  if (!crop) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(crop.buffer), {
    headers: {
      "Content-Type": crop.mime,
      "Cache-Control": "public, max-age=900, immutable",
    },
  });
}
