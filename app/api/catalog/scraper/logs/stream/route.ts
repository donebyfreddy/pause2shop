import type { NextRequest } from "next/server";
import {
  JOB_STAGES,
  LEVEL_ORDER,
  queryMemoryJobLogs,
  subscribeJobLogs,
  type JobLogEntry,
  type JobLogLevel,
  type JobStage,
} from "@/lib/catalogIngestion/observability/jobLog";
import { bootstrapIngestion } from "@/lib/catalogIngestion/bootstrap";

/**
 * Streaming de logs de ingesta por Server-Sent Events.
 *
 * SSE y no WebSocket porque el flujo es de una sola dirección y SSE se
 * reconecta solo: si la función serverless se recicla, el navegador reabre y
 * sigue por donde estaba usando `Last-Event-ID`/`?afterSeq`.
 *
 * Va sobre el runtime Node.js (no Edge): comparte proceso con los jobs, que es
 * la única forma de que `subscribeJobLogs` reciba sus eventos. Si el job corre
 * en OTRA invocación, el cliente cae al polling de `/scraper/logs`, que sí lee
 * de la base de datos.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Se corta el stream antes del límite de la función para cerrar limpiamente. */
const STREAM_BUDGET_MS = 240_000;
const HEARTBEAT_MS = 15_000;

export async function GET(req: NextRequest): Promise<Response> {
  await bootstrapIngestion();

  const params = req.nextUrl.searchParams;
  const filters = {
    jobId: params.get("jobId") ?? undefined,
    connectorId: params.get("connector") ?? params.get("source") ?? undefined,
    level: (params.get("level") as JobLogLevel | null) ?? undefined,
    stage: (params.get("stage") as JobStage | null) ?? undefined,
    q: params.get("q") ?? undefined,
  };
  const afterSeq = Number(req.headers.get("last-event-id") ?? params.get("afterSeq") ?? 0) || 0;

  const matches = (entry: JobLogEntry): boolean => {
    if (filters.jobId && entry.jobId !== filters.jobId) return false;
    if (filters.connectorId && entry.connectorId !== filters.connectorId) return false;
    if (filters.stage && entry.stage !== filters.stage) return false;
    if (filters.level && LEVEL_ORDER[entry.level] < LEVEL_ORDER[filters.level]) return false;
    if (filters.q) {
      const haystack = `${entry.message} ${entry.url ?? ""}`.toLowerCase();
      if (!haystack.includes(filters.q.toLowerCase())) return false;
    }
    return true;
  };

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let budget: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown, id?: number): void => {
        try {
          const lines = [
            id != null ? `id: ${id}` : null,
            `event: ${event}`,
            `data: ${JSON.stringify(data)}`,
            "",
            "",
          ]
            .filter((l) => l !== null)
            .join("\n");
          controller.enqueue(encoder.encode(lines));
        } catch {
          // El cliente cerró: el cleanup del cancel() se encarga.
        }
      };

      const cleanup = (): void => {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        if (budget) clearTimeout(budget);
      };

      // Backlog primero: quien abre la consola quiere ver el contexto, no
      // esperar a que ocurra la siguiente línea.
      const backlog = queryMemoryJobLogs({ ...filters, afterSeq, limit: 300 }).reverse();
      send("hello", {
        stages: JOB_STAGES,
        backlog: backlog.length,
        // Honestidad: si el job corre en otra invocación, este stream no lo verá.
        note:
          "streaming en proceso: solo llegan los eventos de ESTA invocación. " +
          "Para histórico completo usa el polling de /api/catalog/scraper/logs.",
      });
      for (const entry of backlog) send("log", entry, entry.seq);

      unsubscribe = subscribeJobLogs((entry) => {
        if (matches(entry)) send("log", entry, entry.seq);
      });

      // Comentario SSE periódico: mantiene viva la conexión a través de proxies
      // que cortan por inactividad.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      budget = setTimeout(() => {
        send("bye", { reason: "límite de duración de la función; reconecta" });
        cleanup();
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      }, STREAM_BUDGET_MS);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      if (budget) clearTimeout(budget);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Evita que un proxy intermedio acumule el cuerpo y rompa el streaming.
      "x-accel-buffering": "no",
    },
  });
}
