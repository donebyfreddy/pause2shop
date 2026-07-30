import { NextResponse } from "next/server";

import {
  describeStorage,
  isPubliclyReachableBase,
} from "@/lib/mediaStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/storage — comprueba que se puede publicar un crop en un sitio
 * PÚBLICO alcanzable por los proveedores de reverse image search.
 *
 * Con el proveedor `local` no hay credenciales que validar (la app se sirve a sí
 * misma el crop), así que lo único que puede fallar es lo que de verdad falla en
 * la práctica: que el origen no sea alcanzable desde Internet. Un `localhost`
 * pasa cualquier chequeo de configuración y luego Google Lens no puede
 * descargar nada — por eso ese es EL chequeo.
 *
 * No expone secretos.
 */
export async function GET(request: Request) {
  const storage = describeStorage();
  const base =
    storage.publicBaseUrl ?? new URL(request.url).origin;
  const reachable = isPubliclyReachableBase(base);

  if (!storage.implemented) {
    return NextResponse.json(
      {
        ...storage,
        publishable: false,
        detail:
          `El proveedor "${storage.provider}" está declarado pero no ` +
          "implementado. Pon STORAGE_PROVIDER=local o implementa el proveedor " +
          "en lib/mediaStorage.",
      },
      { status: 503 }
    );
  }

  if (!reachable) {
    return NextResponse.json(
      {
        ...storage,
        publishable: false,
        publicBaseUrl: base,
        detail:
          `"${base}" no es alcanzable desde Internet (localhost o red ` +
          "privada): los proveedores de reverse image search no podrían " +
          "descargar el crop. Expón la app con un túnel o define " +
          "PUBLIC_MEDIA_BASE_URL. El resto del pipeline (catálogo, visión) " +
          "funciona igual.",
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ...storage,
    publishable: true,
    publicBaseUrl: base,
    detail: storage.ephemeral
      ? "Proveedor `local`: los objetos son EFÍMEROS (TTL en memoria, se " +
        "pierden al reiniciar). Suficiente para reverse image search, no para " +
        "almacenamiento duradero."
      : null,
  });
}
