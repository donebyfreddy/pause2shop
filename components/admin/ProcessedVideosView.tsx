"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AnalysisJobRecord } from "@/lib/analysis/jobs/types";

export function ProcessedVideosView() {
  const [jobs, setJobs] = useState<AnalysisJobRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const response = await fetch("/api/analysis/jobs?limit=200", { cache: "no-store" });
    const body = (await response.json()) as { ok: boolean; jobs?: AnalysisJobRecord[] };
    if (body.ok) setJobs(body.jobs ?? []);
    setLoading(false);
  };

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const metrics = useMemo(() => {
    const completed = jobs.filter((job) =>
      ["completed", "partially_completed"].includes(job.status)
    );
    const products = completed.reduce((sum, job) => sum + job.counters.uniqueProducts, 0);
    const catalogHits = completed.reduce((sum, job) => sum + job.counters.catalogHits, 0);
    const external = completed.reduce((sum, job) => sum + job.counters.externalSearchesUsed, 0);
    const cacheHits = completed.reduce((sum, job) => sum + job.counters.cacheHits, 0);
    return { completed: completed.length, products, catalogHits, external, cacheHits };
  }, [jobs]);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Vídeos reutilizables" value={metrics.completed} />
        <Metric label="Productos únicos" value={metrics.products} />
        <Metric label="Resueltos por catálogo" value={metrics.catalogHits} />
        <Metric label="Fallback externo" value={metrics.external} />
        <Metric label="Cache hits" value={metrics.cacheHits} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-white/[0.025]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-xs text-ink-subtle">
            Hash + versión de catálogo + versión del pipeline gobiernan la reutilización.
          </p>
          <button type="button" onClick={() => void load()} aria-label="Actualizar" className="rounded-lg p-2 text-ink-muted hover:bg-white/5">
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-white/[0.025] text-ink-faint">
              <tr>
                {['Vídeo','Hash','Duración','Estado','Productos','Catálogo','Externos','Procesado'].map((label) => (
                  <th key={label} className="px-4 py-2.5 font-semibold uppercase tracking-wide">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {jobs.map((job) => (
                <tr key={job.id} className="text-ink-muted">
                  <td className="max-w-52 truncate px-4 py-3 font-medium text-ink">{job.media.fileName}</td>
                  <td className="px-4 py-3 font-mono text-[10px]">{job.media.fileHash?.slice(0, 12) ?? 'sin hash'}</td>
                  <td className="px-4 py-3">{job.media.durationSeconds.toFixed(1)} s</td>
                  <td className="px-4 py-3">{job.status}</td>
                  <td className="px-4 py-3">{job.counters.uniqueProducts}</td>
                  <td className="px-4 py-3">{job.counters.catalogHits}</td>
                  <td className="px-4 py-3">{job.counters.externalSearchesUsed}</td>
                  <td className="px-4 py-3">{job.media.processedAt ? new Date(job.media.processedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {!loading && jobs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-faint">Todavía no hay vídeos procesados.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.025] p-4">
      <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-ink-subtle">{label}</p>
    </div>
  );
}
