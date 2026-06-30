import { NextRequest, NextResponse } from "next/server";
import { getCatalogRepository } from "@/lib/catalog";
import type { ItemPatch, ItemStatus, ItemType } from "@/lib/catalog/types";
import type {
  CatalogItemResponse,
  CatalogItemUpdateResponse,
} from "@/lib/api/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ItemStatus[] = ["detected", "reviewed", "matched", "ignored"];
const TYPES: ItemType[] = [
  "clothing",
  "footwear",
  "accessory",
  "electronics",
  "home",
  "beauty",
  "other",
];

/** GET /api/catalog/items/:id — detalle + recomendaciones. */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/catalog/items/[id]">
): Promise<NextResponse<CatalogItemResponse>> {
  const { id } = await ctx.params;
  try {
    const item = await getCatalogRepository().getItem(id);
    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Elemento no encontrado." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** PATCH /api/catalog/items/:id — actualiza estado, nombre, categoría, etc. */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/catalog/items/[id]">
): Promise<NextResponse<CatalogItemUpdateResponse>> {
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON no válido." },
      { status: 400 }
    );
  }

  const patch: ItemPatch = {};
  const setStr = (key: keyof ItemPatch) => {
    const v = body[key];
    if (typeof v === "string" && v.trim()) {
      (patch[key] as string) = v.trim();
    }
  };

  if (typeof body.status === "string") {
    if (!(STATUSES as string[]).includes(body.status)) {
      return NextResponse.json(
        { ok: false, error: `status no válido. Usa: ${STATUSES.join(", ")}.` },
        { status: 400 }
      );
    }
    patch.status = body.status as ItemStatus;
  }
  if (typeof body.type === "string") {
    if (!(TYPES as string[]).includes(body.type)) {
      return NextResponse.json(
        { ok: false, error: `type no válido. Usa: ${TYPES.join(", ")}.` },
        { status: 400 }
      );
    }
    patch.type = body.type as ItemType;
  }
  setStr("name");
  setStr("category");
  setStr("subcategory");
  setStr("color");
  setStr("style");
  setStr("pattern");
  setStr("materialGuess");
  setStr("genderFit");
  setStr("visibleBrand");
  setStr("searchQuery");

  try {
    const item = await getCatalogRepository().updateItem(id, patch);
    if (!item) {
      return NextResponse.json(
        { ok: false, error: "Elemento no encontrado." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
