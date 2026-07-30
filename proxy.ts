import { NextResponse, type NextRequest } from "next/server";

/**
 * Puerta de acceso para el panel de operaciones del catálogo.
 *
 * `/admin` y `/api/catalog/*` exponen control real sobre la ingesta (lanzar
 * syncs, pausar fuentes, activar/desactivar productos) y antes NO tenían
 * ninguna autenticación de usuario — solo heredaban la de la app, que no
 * existe. Esto es la base mínima real: HTTP Basic con una contraseña de
 * servidor. No es un sistema de usuarios; es el requisito de "no lo dejes
 * abierto al público" cumplido de la forma más simple que sigue siendo
 * honesta (no placebo, no solo un aviso en el admin).
 *
 * `ADMIN_PASSWORD` es la credencial. Si no está configurada, el gate se
 * desactiva con un aviso en logs — aceptable SOLO en desarrollo local.
 * `CATALOG_ADMIN_ENABLED=false` apaga el panel entero devolviendo 404: útil
 * para un despliegue que solo quiere servir el producto público.
 */

const ADMIN_PREFIXES = ["/admin", "/api/catalog"];

function isGated(pathname: string): boolean {
  return ADMIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function unauthorized(): NextResponse {
  return new NextResponse("Autenticación requerida.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Pause2Shop admin"' },
  });
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (!isGated(pathname)) return NextResponse.next();

  if (process.env.CATALOG_ADMIN_ENABLED === "false") {
    return NextResponse.json(
      { error: { code: "admin_disabled", message: "el panel de catálogo está desactivado en este despliegue" } },
      { status: 404 }
    );
  }

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // Sin contraseña configurada: solo aceptable en local. No bloqueamos el
    // arranque (sería peor DX que un aviso), pero se ve en cada respuesta.
    const res = NextResponse.next();
    res.headers.set("x-admin-auth", "disabled-no-password-set");
    return res;
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  const decoded = atob(header.slice("Basic ".length));
  const separator = decoded.indexOf(":");
  const suppliedPassword = separator === -1 ? decoded : decoded.slice(separator + 1);
  if (suppliedPassword !== password) return unauthorized();

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/catalog/:path*"],
};
