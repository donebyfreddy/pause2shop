"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Acceso a datos del admin desde el navegador.
 *
 * Todo pasa por `/api/catalog/*` — Route Handlers de esta misma app, no un
 * proxy hacia otro servicio ni hacia otro puerto. El motor de ingesta corre
 * en el mismo proceso (`lib/catalogIngestion`), así que el cliente NUNCA
 * maneja la API key del servicio. Nada de esto lanza: los errores se
 * devuelven como estado para que la pantalla los muestre en vez de romperse.
 */

export type AdminError = { code: string; message: string };

export async function adminGet<T>(
  path: string,
  init: { signal?: AbortSignal } = {}
): Promise<{ ok: true; data: T } | { ok: false; error: AdminError }> {
  try {
    const res = await fetch(`/api/catalog/${path.replace(/^\//, "")}`, {
      signal: init.signal,
      headers: { accept: "application/json" },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        error: (body as { error?: AdminError } | null)?.error ?? {
          code: `http_${res.status}`,
          message: `el servicio respondió ${res.status}`,
        },
      };
    }
    return { ok: true, data: body as T };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { code: "aborted", message: "petición cancelada" } };
    }
    return {
      ok: false,
      error: { code: "network", message: "no se pudo contactar con el servidor" },
    };
  }
}

export async function adminPost<T>(
  path: string,
  body?: unknown
): Promise<{ ok: true; data: T } | { ok: false; error: AdminError }> {
  try {
    const res = await fetch(`/api/catalog/${path.replace(/^\//, "")}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        error: (parsed as { error?: AdminError } | null)?.error ?? {
          code: `http_${res.status}`,
          message: `el servicio respondió ${res.status}`,
        },
      };
    }
    return { ok: true, data: parsed as T };
  } catch {
    return {
      ok: false,
      error: { code: "network", message: "no se pudo contactar con el servidor" },
    };
  }
}

export type Resource<T> = {
  data: T | null;
  error: AdminError | null;
  /** Solo la primera carga: los refrescos no deben vaciar la pantalla. */
  loading: boolean;
  /** true durante un refresco con datos ya presentes. */
  refreshing: boolean;
  lastUpdatedAt: Date | null;
  reload: () => void;
};

/**
 * Hook de lectura con polling opcional.
 *
 * Detalle importante: en los refrescos se conserva el dato anterior. Un panel de
 * operaciones que parpadea a esqueleto cada 5 s es inusable.
 */
export function useAdminResource<T>(
  path: string | null,
  options: { pollMs?: number; enabled?: boolean } = {}
): Resource<T> {
  const { pollMs, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(Boolean(path) && enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const hasData = useRef(false);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path || !enabled) return;
    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      if (hasData.current) setRefreshing(true);
      const result = await adminGet<T>(path, { signal: controller.signal });
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setError(null);
        hasData.current = true;
        setLastUpdatedAt(new Date());
      } else if (result.error.code !== "aborted") {
        setError(result.error);
      }
      setLoading(false);
      setRefreshing(false);
    };

    void run();
    const interval = pollMs ? setInterval(run, pollMs) : null;
    return () => {
      cancelled = true;
      controller.abort();
      if (interval) clearInterval(interval);
    };
  }, [path, enabled, pollMs, tick]);

  return { data, error, loading, refreshing, lastUpdatedAt, reload };
}
