import { NextResponse, after } from "next/server";
import { catalogService } from "./server";
import { drainCatalogJobs } from "@/lib/catalogIngestion/service";

/**
 * Fábrica de handlers para `app/api/catalog/**`.
 *
 * Cada route.ts del árbol es un wrapper de ~10 líneas sobre esta función: la
 * ruta HTTP existe para que el admin (cliente) tenga una URL estable que
 * llamar, pero el trabajo real ya está en `lib/catalogIngestion` — aquí no
 * hay lógica de negocio, solo el pegamento Next.js.
 *
 * `background: true` marca los endpoints que encolan un job (`202`): tras
 * responder, `after()` mantiene la función viva lo que Vercel permita para
 * drenar la cola en este mismo invocation en vez de depender de un proceso
 * de fondo que no existe. Si el job no termina a tiempo, su checkpoint ya
 * quedó persistido y el propio cron (`/api/catalog/cron/jobs`) o un reintento
 * manual lo retoma — nunca se pierde progreso, solo se reparte en más pasos.
 */
export async function catalogRoute(
  path: string,
  opts: { method: "GET" | "POST"; body?: unknown; background?: boolean } = { method: "GET" }
): Promise<NextResponse> {
  // `background` marca las rutas que encolan trabajo real (sync, reindex,
  // retry): con CATALOG_JOBS_ENABLED=false un despliegue puede servir el
  // catálogo ya ingerido (lectura, búsqueda) sin permitir lanzar más ingesta.
  if (opts.background && process.env.CATALOG_JOBS_ENABLED === "false") {
    return NextResponse.json(
      { error: { code: "jobs_disabled", message: "los jobs de ingesta están desactivados en este despliegue (CATALOG_JOBS_ENABLED=false)" } },
      { status: 403 }
    );
  }

  const result = await catalogService<unknown>(path, { method: opts.method, body: opts.body });

  if (opts.background && result.ok && result.status === 202) {
    after(drainCatalogJobs);
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status === 0 ? 503 : result.status });
  }
  return NextResponse.json(result.data, { status: result.status });
}

/** Body JSON del POST, tolerante a peticiones sin cuerpo (pause/resume/test). */
export async function readJsonBody(req: Request): Promise<unknown> {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidBodyError();
  }
}

export class InvalidBodyError extends Error {
  constructor() {
    super("el cuerpo no es JSON válido");
  }
}
