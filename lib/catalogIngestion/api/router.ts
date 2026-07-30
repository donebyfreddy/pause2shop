import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Router mínimo sobre node:http — sin Express/Fastify a propósito: el
 * contrato tiene ~15 rutas y un router de patrones con :params cubre todo
 * sin arrastrar dependencias.
 */

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
}

export type Handler = (ctx: RequestContext) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  requiresAuth: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler, opts: { auth?: boolean } = {}): void {
    const paramNames: string[] = [];
    const pattern = new RegExp(
      "^" +
        path
          .split("/")
          .map((seg) => {
            if (seg.startsWith(":")) {
              paramNames.push(seg.slice(1));
              return "([^/]+)";
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("/") +
        "$"
    );
    this.routes.push({ method, pattern, paramNames, handler, requiresAuth: opts.auth !== false });
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
    return null;
  }
}

/** Lee y parsea el body JSON con límite de tamaño (las imágenes base64 pesan). */
export function readBody(req: IncomingMessage, maxBytes = 15 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ApiError(413, "payload_too_large", `body supera ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError(400, "invalid_json", "el body no es JSON válido"));
      }
    });
    req.on("error", reject);
  });
}
