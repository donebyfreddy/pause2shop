import { NextResponse, type NextRequest } from "next/server";
import { catalogRoute, readJsonBody, InvalidBodyError } from "@/lib/catalogService/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Comprueba que el dataset es alcanzable y devuelve su esquema real. Sin
 * `background`: la respuesta es justamente lo que se quiere ver, y la
 * comprobación es una petición al proveedor, no un job.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err instanceof InvalidBodyError) {
      return NextResponse.json(
        { error: { code: "invalid_body", message: err.message } },
        { status: 400 }
      );
    }
    throw err;
  }
  return catalogRoute("/datasets/inspect", { method: "POST", body });
}
