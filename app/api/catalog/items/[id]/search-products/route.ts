import { NextRequest, NextResponse } from "next/server";
import { getCatalogRepository } from "@/lib/catalog";
import { isUsingMockProducts, searchProducts } from "@/lib/products/searchProducts";
import type { SearchProductsResponse } from "@/lib/api/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/catalog/items/:id/search-products
 * Genera recomendaciones para el item (proveedores activos), las persiste y
 * las devuelve.
 */
export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/catalog/items/[id]/search-products">
): Promise<NextResponse<SearchProductsResponse>> {
  const { id } = await ctx.params;
  const repo = getCatalogRepository();

  try {
    const item = await repo.getItem(id);
    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Elemento no encontrado." },
        { status: 404 }
      );
    }

    const recsInput = await searchProducts(item, { limit: 8 });
    const recommendations = await repo.replaceRecommendations(id, recsInput);
    return NextResponse.json({
      ok: true,
      recommendations,
      mock: isUsingMockProducts(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      { ok: false, error: `No se pudieron buscar productos: ${message}` },
      { status: 500 }
    );
  }
}
