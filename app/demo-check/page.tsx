"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

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

const STATUS_ICON: Record<CheckStatus, string> = { ok: "✓", warning: "!", error: "✕" };
const STATUS_CLS: Record<CheckStatus, string> = {
  ok: "text-success border-success/30 bg-success/10",
  warning: "text-warning border-warning/30 bg-warning/10",
  error: "text-danger border-danger/30 bg-danger/10",
};

/** Checks que solo pueden hacerse en el navegador (permisos/APIs). */
function useBrowserChecks(): () => CheckResult[] {
  const t = useTranslations("demo.check.browserChecks");
  return () => {
    const results: CheckResult[] = [];
    const hasDisplayMedia =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getDisplayMedia);
    results.push({
      id: "displaymedia",
      label: t("displayMedia.label"),
      status: hasDisplayMedia ? "ok" : "error",
      latencyMs: null,
      detail: hasDisplayMedia
        ? t("displayMedia.okDetail")
        : t("displayMedia.errorDetail"),
      action: hasDisplayMedia ? undefined : t("displayMedia.action"),
    });
    const hasClipboard =
      typeof navigator !== "undefined" && Boolean(navigator.clipboard);
    results.push({
      id: "clipboard",
      label: t("clipboard.label"),
      status: hasClipboard ? "ok" : "warning",
      latencyMs: null,
      detail: hasClipboard ? t("clipboard.okDetail") : t("clipboard.warningDetail"),
    });
    return results;
  };
}

export default function DemoCheckPage() {
  const t = useTranslations("demo.check");
  const tStatus = useTranslations("demo.check.status");
  const browserChecks = useBrowserChecks();
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
      setError(t("runError"));
    } finally {
      setLoading(false);
    }
  }, [browserChecks, t]);

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
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("description")}</p>
        </div>
        <Link href="/" className="text-sm text-ink-muted hover:text-ink">
          {t("back")}
        </Link>
      </div>

      <button
        onClick={run}
        disabled={loading}
        className="mb-6 rounded-xl bg-success px-5 py-2.5 text-sm font-semibold text-canvas transition hover:bg-success disabled:opacity-50"
      >
        {loading ? t("running") : t("runButton")}
      </button>

      {error && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {overall && (
        <div
          className={`mb-6 rounded-xl border px-4 py-3 text-sm font-medium ${STATUS_CLS[overall]}`}
        >
          {overall === "ok" && t("overall.ok")}
          {overall === "warning" && t("overall.warning")}
          {overall === "error" && t("overall.error")}
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
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${STATUS_CLS[c.status]}`}
              >
                {STATUS_ICON[c.status]}
              </span>
              <span className="font-medium">{c.label}</span>
              <span className={`ml-auto text-xs ${STATUS_CLS[c.status].split(" ")[0]}`}>
                {tStatus(c.status)}
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
        <p className="text-sm text-ink-subtle">{t("emptyHint")}</p>
      )}
    </main>
  );
}
