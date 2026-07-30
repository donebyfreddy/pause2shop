import { NextResponse, type NextRequest } from "next/server";
import { drainCatalogJobs } from "@/lib/catalogIngestion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Continuación manual de jobs de ingesta.
 *
 * Un job largo (sync completo de una fuente con muchas fichas) puede no
 * terminar dentro de una sola invocación — `after(drainCatalogJobs)` en los
 * endpoints que encolan trabajo ya intenta drenarlo justo después de
 * responder, pero si esa invocación termina antes de que el job acabe, este
 * endpoint permite reanudar manualmente cualquier job `queued`/`running`
 * desde su checkpoint
 * persistido. Es idempotente — si no hay nada pendiente, no hace nada — y
 * nunca mantiene un proceso vivo entre invocaciones: cada disparo es una
 * ejecución nueva y acotada.
 *
 * Protegido mediante `Authorization: Bearer $CRON_SECRET` cuando
 * `CRON_SECRET` está definida.
 * Fuera de `/admin` y `/api/catalog` a propósito: el middleware de Basic Auth
 * no se aplica aquí.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: { code: "unauthorized", message: "falta o no coincide CRON_SECRET" } }, { status: 401 });
    }
  }

  const startedAt = Date.now();
  await drainCatalogJobs();
  return NextResponse.json({ ok: true, durationMs: Date.now() - startedAt });
}
