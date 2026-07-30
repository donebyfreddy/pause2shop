import type { IncomingMessage, ServerResponse } from "node:http";
import { buildRouter } from "./api/routes";
import { ApiError } from "./api/router";
import { getStore } from "./catalog/store";
import { getQueue } from "./jobs/queue";
import { bootstrapIngestion } from "./bootstrap";
import { flushJobLogs } from "./observability/jobLog";

export type InternalCatalogResult = {
  status: number;
  body: unknown;
};

type CapturedResponse = ServerResponse & {
  capturedStatus: number;
  capturedBody: unknown;
};

function responseCapture(): CapturedResponse {
  const capture = {
    capturedStatus: 200,
    capturedBody: null,
    writeHead(status: number) {
      capture.capturedStatus = status;
      return capture;
    },
    end(payload?: string | Buffer) {
      if (payload == null || payload.length === 0) {
        capture.capturedBody = null;
        return capture;
      }
      const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
      capture.capturedBody = JSON.parse(text);
      return capture;
    },
  };
  return capture as unknown as CapturedResponse;
}

/**
 * Executes the former catalog-scraper API contract in-process. This is the
 * serverless replacement for the HTTP hop to CATALOG_SERVICE_URL.
 */
export async function invokeCatalogService(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<InternalCatalogResult> {
  const method = init.method ?? "GET";
  const url = new URL(path, "http://catalog.internal");
  // Conecta el sink de logs y la caché de IA persistente antes de servir nada:
  // es idempotente y así ninguna ruta trabaja con observabilidad a medias.
  await bootstrapIngestion();
  const store = await getStore();
  const router = buildRouter(store);
  const matched = router.match(method, url.pathname);

  if (!matched) {
    return {
      status: 404,
      body: { error: { code: "not_found", message: `${method} ${url.pathname} no existe` } },
    };
  }

  const res = responseCapture();
  try {
    await matched.route.handler({
      req: {} as IncomingMessage,
      res,
      params: matched.params,
      query: url.searchParams,
      body: init.body ?? null,
    });
    return { status: res.capturedStatus, body: res.capturedBody };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        status: error.status,
        body: { error: { code: error.code, message: error.message } },
      };
    }
    const message = error instanceof Error ? error.message : "error interno de ingesta";
    return {
      status: 500,
      body: { error: { code: "internal_error", message } },
    };
  }
}

/**
 * Keeps a bounded queue alive within Next/Vercel's request lifetime, AND
 * resumes anything a previous invocation left `queued`/`running` in the
 * database but never got to drain (the in-memory queue of a fresh
 * invocation starts empty). Called from `after()` on job-enqueuing routes
 * and from the `/api/cron/catalog-jobs` safety-net cron.
 */
export async function drainCatalogJobs(): Promise<void> {
  await bootstrapIngestion();
  const store = await getStore();
  const queue = getQueue(store);
  await queue.resumeStalled();
  await queue.drain();
  // La invocación está a punto de morir: los logs pendientes en el buffer de
  // lotes se pierden si no se vuelcan aquí a mano.
  await flushJobLogs();
}
