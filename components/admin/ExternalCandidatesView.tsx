"use client";

import { useEffect, useState } from "react";
import type { ExternalCandidateRecord } from "@/lib/videoProcessing/types";

export function ExternalCandidatesView() {
  const [candidates, setCandidates] = useState<ExternalCandidateRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const response = await fetch("/api/catalog/candidates?limit=200", { cache: "no-store" });
    const body = (await response.json()) as { ok: boolean; candidates?: ExternalCandidateRecord[] };
    if (body.ok) setCandidates(body.candidates ?? []);
  };
  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const review = async (id: string, action: "approve" | "reject") => {
    setBusy(`${id}:${action}`);
    await fetch(`/api/catalog/candidates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reviewedBy: "admin" }),
    });
    setBusy(null);
    await load();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {candidates.map((candidate) => (
        <article key={candidate.id} className="rounded-2xl border border-line bg-white/[0.025] p-4">
          <div className="flex gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={candidate.imageUrl} alt={candidate.title} className="size-24 shrink-0 rounded-xl border border-line object-cover" />
            <div className="min-w-0 flex-1">
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">{candidate.status}</span>
              <h2 className="mt-2 line-clamp-2 text-sm font-semibold text-ink">{candidate.title}</h2>
              <p className="mt-1 text-[11px] text-ink-subtle">{candidate.merchant ?? candidate.provider} · score {Math.round(candidate.finalScore * 100)}%</p>
              {candidate.price != null ? <p className="mt-1 text-sm font-bold text-ink">{candidate.price} {candidate.currency ?? ''}</p> : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a href={candidate.productUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink-muted hover:text-ink">Abrir fuente</a>
            {candidate.status === "review_required" || candidate.status === "external_candidate" ? (
              <>
                <button type="button" disabled={busy != null} onClick={() => void review(candidate.id, "approve")} className="rounded-lg bg-success px-3 py-1.5 text-[11px] font-bold text-black disabled:opacity-40">Aprobar y crear producto</button>
                <button type="button" disabled={busy != null} onClick={() => void review(candidate.id, "reject")} className="rounded-lg border border-danger/40 px-3 py-1.5 text-[11px] text-danger disabled:opacity-40">Rechazar</button>
              </>
            ) : null}
          </div>
          <p className="mt-3 border-t border-line pt-3 text-[10px] text-ink-faint">Proveedor: {candidate.provider} · Consultado: {new Date(candidate.queriedAt).toLocaleString()}</p>
        </article>
      ))}
      {candidates.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-ink-faint lg:col-span-2">No hay candidatos externos pendientes.</p> : null}
    </div>
  );
}
