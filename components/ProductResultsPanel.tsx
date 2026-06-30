"use client";

import Link from "next/link";
import { useState } from "react";
import type { DetectedItem, FrameAnalysis, ProductLink } from "@/lib/types";
import { normalizeStyle, prettyStyleLabel } from "@/lib/utils";
import FramePreview from "./FramePreview";
import LoadingAnalysis from "./LoadingAnalysis";
import ProductCard from "./ProductCard";

type Props = {
  loading: boolean;
  error: string | null;
  warning?: string | null;
  analysis: FrameAnalysis | null;
  items: DetectedItem[];
  /** All unique items detected across the whole video session. */
  sessionItems?: DetectedItem[];
  frameDataUrl: string | null;
  mock: boolean;
  persisted?: boolean;
  savedCount?: number;
  videoId?: string | null;
  onLinkClick: (item: DetectedItem, link: ProductLink) => void;
  onReanalyze?: () => void;
  canReanalyze?: boolean;
};

type Tab = "frame" | "session";

export default function ProductResultsPanel({
  loading,
  error,
  warning,
  analysis,
  items,
  sessionItems = [],
  frameDataUrl,
  mock,
  persisted,
  savedCount = 0,
  videoId,
  onLinkClick,
  onReanalyze,
  canReanalyze,
}: Props) {
  const [tab, setTab] = useState<Tab>("frame");
  const vibe = normalizeStyle(analysis?.style_vibe);
  const catalogHref = videoId ? `/catalog?videoId=${videoId}` : "/catalog";

  const showSessionTab = sessionItems.length > 0;

  return (
    <aside className="flex h-full flex-col rounded-3xl border border-white/10 bg-zinc-900/60 backdrop-blur">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Resultados</h2>
          <p className="text-xs text-zinc-500">Objetos comprables detectados</p>
        </div>
        {onReanalyze && (
          <button
            onClick={onReanalyze}
            disabled={!canReanalyze || loading}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ↻ Analizar otra vez
          </button>
        )}
      </header>

      {/* Tab bar */}
      {showSessionTab && (
        <div className="flex border-b border-white/10">
          <TabButton
            active={tab === "frame"}
            onClick={() => setTab("frame")}
            label="Este frame"
            count={items.length}
          />
          <TabButton
            active={tab === "session"}
            onClick={() => setTab("session")}
            label="Historial del vídeo"
            count={sessionItems.length}
            accent
          />
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {mock && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Modo demo (sin <code className="font-mono">OPENAI_API_KEY</code>): datos de ejemplo realistas.
          </div>
        )}

        {savedCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <span>
              ✓ {savedCount} elemento{savedCount === 1 ? "" : "s"} guardado
              {savedCount === 1 ? "" : "s"} en tu catálogo
              {!persisted && (
                <span className="text-emerald-300/70">
                  {" "}(en memoria — configura <code className="font-mono">DATABASE_URL</code> para persistir)
                </span>
              )}
            </span>
            <Link
              href={catalogHref}
              className="shrink-0 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 font-medium text-emerald-100 transition hover:bg-emerald-500/20"
            >
              Ver en catálogo →
            </Link>
          </div>
        )}

        {warning && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {warning}
          </div>
        )}

        {/* SESSION TAB: all items seen during the video */}
        {tab === "session" && showSessionTab && (
          <>
            <div className="rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
              {sessionItems.length} objeto{sessionItems.length === 1 ? "" : "s"} único{sessionItems.length === 1 ? "" : "s"} detectado{sessionItems.length === 1 ? "" : "s"} durante el vídeo
            </div>
            <div className="space-y-3">
              {sessionItems.map((item, idx) => (
                <ProductCard
                  key={`session-${item.name}-${idx}`}
                  item={item}
                  rank={idx + 1}
                  onLinkClick={onLinkClick}
                />
              ))}
            </div>
          </>
        )}

        {/* FRAME TAB: items from the current paused frame */}
        {tab === "frame" && (
          <>
            {frameDataUrl && <FramePreview dataUrl={frameDataUrl} />}

            {error && (
              <div className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}

            {loading && <LoadingAnalysis />}

            {!loading && analysis && (
              <>
                {analysis.summary && (
                  <p className="text-sm leading-relaxed text-zinc-300">{analysis.summary}</p>
                )}

                {items.length > 0 && (
                  <div className="rounded-xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/10 to-fuchsia-500/10 px-4 py-3">
                    <p className="text-xs leading-relaxed text-zinc-200">
                      Estilo detectado:{" "}
                      <span className="font-semibold text-indigo-200">
                        {prettyStyleLabel(vibe)}
                      </span>
                    </p>
                  </div>
                )}

                {items.length > 0 ? (
                  <div className="space-y-3">
                    {items.map((item, idx) => (
                      <ProductCard
                        key={`${item.name}-${idx}`}
                        item={item}
                        rank={idx + 1}
                        onLinkClick={onLinkClick}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState />
                )}
              </>
            )}

            {!loading && !analysis && !error && <Placeholder />}
          </>
        )}
      </div>

      <footer className="border-t border-white/10 px-5 py-3 text-[11px] leading-relaxed text-zinc-500">
        🔒 La captura solo se usa para analizar objetos comprables. No identificamos
        personas ni guardamos imágenes en el servidor.
      </footer>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition " +
        (active
          ? accent
            ? "border-emerald-400 text-emerald-300"
            : "border-indigo-400 text-indigo-200"
          : "border-transparent text-zinc-500 hover:text-zinc-300")
      }
    >
      {label}
      {count > 0 && (
        <span
          className={
            "rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
            (active
              ? accent
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-indigo-500/20 text-indigo-300"
              : "bg-white/10 text-zinc-400")
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

function Placeholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-2xl">
        🛍️
      </div>
      <p className="max-w-[15rem] text-sm text-zinc-400">
        Reproduce el vídeo y haz <span className="text-zinc-200">pausa</span> para
        analizar el frame visible.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="text-3xl">🔍</div>
      <p className="max-w-[16rem] text-sm text-zinc-400">
        No he detectado objetos comprables claros. Prueba con otro frame más visible.
      </p>
    </div>
  );
}
