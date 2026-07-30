/**
 * Cliente server-side del catálogo integrado.
 *
 * Es el ÚNICO punto por el que el admin habla con el motor de ingesta:
 *
 *  - la `CATALOG_SERVICE_API_KEY` nunca sale del servidor (el navegador jamás
 *    la ve, a diferencia del admin anterior, que la pedía por prompt y la
 *    guardaba en localStorage);
 *  - nada de CORS: el navegador solo llama a rutas de la propia app;
 *  - nunca lanza: todo devuelve `{ ok }` para que un servicio caído degrade la
 *    pantalla en lugar de romperla.
 *
 * SOLO servidor: lee `process.env.CATALOG_SERVICE_API_KEY`. Se importa desde
 * route handlers y server components, nunca desde un componente cliente.
 */

import { invokeCatalogService } from "@/lib/catalogIngestion/service";

export type ServiceResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: { code: string; message: string } };

export function catalogServiceUrl(): string {
  return "internal://catalog";
}

export function catalogServiceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json", ...extra };
  const key = process.env.CATALOG_SERVICE_API_KEY;
  if (key) headers["x-api-key"] = key;
  return headers;
}

/** Petición tipada al servicio. `path` empieza por "/" (p. ej. "/connectors"). */
export async function catalogService<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    revalidate?: number;
    /** Timeout específico. Necesario para operaciones lentas POR DISEÑO, como
     *  el test de un conector o el health live: hacen peticiones reales a la
     *  tienda con rate limit, y pueden pasar de 30 s legítimamente. */
    timeoutMs?: number;
  } = {}
): Promise<ServiceResult<T>> {
  try {
    const result = await invokeCatalogService(path, {
      method: (init.method ?? "GET") as "GET" | "POST",
      body: init.body,
    });
    if (result.status < 200 || result.status >= 300) {
      const err = (result.body as { error?: { code?: string; message?: string } } | null)?.error;
      return {
        ok: false,
        status: result.status,
        error: {
          code: err?.code ?? `http_${result.status}`,
          message: err?.message ?? `el catálogo respondió ${result.status}`,
        },
      };
    }
    return { ok: true, status: result.status, data: result.body as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: {
        code: "unavailable",
        message: err instanceof Error ? err.message : "el catálogo integrado no está disponible",
      },
    };
  }
}
