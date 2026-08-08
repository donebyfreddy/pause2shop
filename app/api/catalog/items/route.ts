import { NextRequest, NextResponse } from "next/server";
import {
  getCatalogRepository,
  getPersistenceMode,
  isPersistentCatalog,
} from "@/lib/catalog";
import type {
  CatalogFilters,
  CatalogListItem,
  ItemStatus,
} from "@/lib/catalog/types";
import { deriveImagePersistenceStatus } from "@/lib/catalog/images";
import type { CatalogListResponse } from "@/lib/api/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ItemStatus[] = [
  "detected",
  "catalog_matched",
  "external_candidate",
  "review_required",
  "approved",
  "published",
  "reviewed",
  "matched",
  "ignored",
];

/**
 * GET /api/catalog/items
 * Filtros: ?category=&color=&type=&videoId=&status=&q=&limit=&offset=
 */
export async function GET(
  req: NextRequest
): Promise<NextResponse<CatalogListResponse>> {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");

  const filters: CatalogFilters = {
    category: sp.get("category") || undefined,
    color: sp.get("color") || undefined,
    type: sp.get("type") || undefined,
    videoId: sp.get("videoId") || undefined,
    status: status && (STATUSES as string[]).includes(status)
      ? (status as ItemStatus)
      : undefined,
    q: sp.get("q") || undefined,
    sourceType: sp.get("sourceType") || undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
    offset: sp.get("offset") ? Number(sp.get("offset")) : undefined,
  };

  try {
    const repo = getCatalogRepository();
    const { items, total } = await repo.listItems(filters);
    const persistence = getPersistenceMode();

    // Imagen del producto encontrado: mejor recomendación por item, en una
    // sola consulta. Best-effort — si falla, las tarjetas salen sin match.
    const topRecs = await repo
      .listTopRecommendations(items.map((i) => i.id))
      .catch(() => new Map());

    const enriched: CatalogListItem[] = items.map((item) => ({
      ...item,
      bestMatch: topRecs.get(item.id) ?? null,
      imagePersistenceStatus: deriveImagePersistenceStatus(item, persistence),
    }));

    return NextResponse.json({
      ok: true,
      items: enriched,
      total,
      persisted: isPersistentCatalog(),
      persistence,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json(
      { ok: false, error: `No se pudo leer el catálogo: ${message}` },
      { status: 500 }
    );
  }
}
