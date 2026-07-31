import { NextResponse } from "next/server";
import { buildCapabilities } from "@/lib/matching/capabilities";
import { catalogService } from "@/lib/catalogService/server";
import type { Overview } from "@/lib/catalogService/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/matching/capabilities — qué fuentes de coincidencias puede usar
 * este despliegue, para que el selector deshabilite las que no funcionarían.
 *
 * El número que importa NO es "productos en el catálogo" sino "productos CON
 * embedding": sin embedding no hay búsqueda por imagen, así que un catálogo
 * lleno pero sin indexar no habilita el modo catálogo.
 */
export async function GET() {
  let indexedProducts: number | null = null;
  try {
    const overview = await catalogService<Overview>("/overview", {
      revalidate: 30,
    });
    if (overview.ok) {
      indexedProducts = overview.data.catalog.withEmbeddings;
    }
  } catch {
    // Catálogo ilegible: se devuelve null y NO se deshabilita ningún modo.
    // Bloquear la UI por un fallo de lectura sería peor que dejar intentarlo.
    indexedProducts = null;
  }

  return NextResponse.json({
    ok: true,
    ...buildCapabilities({ indexedProducts }),
  });
}
