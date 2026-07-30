"use client";

import { useCallback, useState } from "react";
import Link from "next/link";

type CheckStatus = "ok" | "warning" | "error";

type CheckResult = {
  id: string;
  label: string;
  status: CheckStatus;
  latencyMs: number | null;
  detail: string;
  action?: string;
};

type ApiResponse = {
  ok: boolean;
  overall: CheckStatus;
  checks: CheckResult[];
  ranAt: number;
};

const STATUS_UI: Record<CheckStatus, { icon: string; text: string; cls: string }> = {
  ok: { icon: "✓", text: "OK", cls: "text-success border-success/30 bg-success/10" },
  warning: { icon: "!", text: "Aviso", cls: "text-warning border-warning/30 bg-warning/10" },
  error: { icon: "✕", text: "Error", cls: "text-danger border-danger/30 bg-danger/10" },
};

/** Checks que solo pueden hacerse en el navegador (permisos/APIs). */
function browserChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  const hasDisplayMedia =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getDisplayMedia);
  results.push({
    id: "displaymedia",
    label: "Captura de pestaña (getDisplayMedia)",
    status: hasDisplayMedia ? "ok" : "error",
    latencyMs: null,
    detail: hasDisplayMedia
      ? "El navegador soporta captura de pestaña para YouTube."
      : "Este navegador no soporta getDisplayMedia: el flujo de YouTube no funcionará.",
    action: hasDisplayMedia ? undefined : "Usa Chrome/Edge de escritorio.",
  });
  const hasClipboard =
    typeof navigator !== "undefined" && Boolean(navigator.clipboard);
  results.push({
    id: "clipboard",
    label: "Portapapeles (pegar imagen)",
    status: hasClipboard ? "ok" : "warning",
    latencyMs: null,
    detail: hasClipboard
      ? "Pegar con Ctrl+V disponible."
      : "API de portapapeles limitada; usa arrastrar y soltar.",
  });
  return results;
}

export default function DemoCheckPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [clientChecks, setClientChecks] = useState<CheckResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setClientChecks(browserChecks());
    try {
      const res = await fetch("/api/demo-check", {
        signal: AbortSignal.timeout(30_000),
      });
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch {
      setError("No se pudo ejecutar la comprobación (timeout o servidor caído).");
    } finally {
      setLoading(false);
    }
  }, []);

  const all = [...(data?.checks ?? []), ...clientChecks];
  const overall: CheckStatus | null = all.length
    ? all.some((c) => c.status === "error")
      ? "error"
      : all.some((c) => c.status === "warning")
        ? "warning"
        : "ok"
    : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-ink">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Preflight de la demo</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Comprueba servicios externos, base de datos y permisos del navegador
            antes de empezar. No muestra claves.
          </p>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:text-ink">
          ← Volver
        </Link>
      </div>

      <button
        onClick={run}
        disabled={loading}
        className="mb-6 rounded-xl bg-success px-5 py-2.5 text-sm font-semibold text-canvas transition hover:bg-success disabled:opacity-50"
      >
        {loading ? "Comprobando…" : "Ejecutar comprobación completa"}
      </button>

      {error && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {overall && (
        <div
          className={`mb-6 rounded-xl border px-4 py-3 text-sm font-medium ${STATUS_UI[overall].cls}`}
        >
          {overall === "ok" && "Todo listo para la demo."}
          {overall === "warning" &&
            "La demo puede hacerse, pero hay avisos: revisa las acciones recomendadas."}
          {overall === "error" &&
            "Hay errores que afectan a la demo: resuélvelos o usa el plan B del runbook."}
        </div>
      )}

      <ul className="space-y-3">
        {all.map((c) => (
          <li
            key={c.id}
            className="rounded-xl border border-line bg-white/[0.03] px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${STATUS_UI[c.status].cls}`}
              >
                {STATUS_UI[c.status].icon}
              </span>
              <span className="font-medium">{c.label}</span>
              <span className={`ml-auto text-xs ${STATUS_UI[c.status].cls.split(" ")[0]}`}>
                {STATUS_UI[c.status].text}
              </span>
              {c.latencyMs != null && (
                <span className="text-xs text-ink-subtle">{c.latencyMs} ms</span>
              )}
            </div>
            <p className="mt-1.5 pl-9 text-sm text-ink-muted">{c.detail}</p>
            {c.action && (
              <p className="mt-1 pl-9 text-sm text-warning/90">→ {c.action}</p>
            )}
          </li>
        ))}
      </ul>

      {!all.length && !loading && (
        <p className="text-sm text-ink-subtle">
          Pulsa el botón para lanzar todas las comprobaciones.
        </p>
      )}
    </main>
  );
}
