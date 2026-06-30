"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import VideoProviderAnalyzer from "@/components/VideoProviderAnalyzer";
import ImageAnalyzer from "@/components/ImageAnalyzer";
import ProductResultsPanel from "@/components/ProductResultsPanel";
import { useFrameAnalysis } from "@/hooks/useFrameAnalysis";
import {
  loadHistory,
  loadPreferences,
  personalizeRanking,
  pushHistory,
  recordClick,
  clearHistory,
} from "@/lib/storage";
import type {
  DetectedItem,
  HistoryEntry,
  Preferences,
  ProductLink,
} from "@/lib/types";
import type { FrameMeta } from "@/lib/api/types";
import { formatTimestamp } from "@/lib/utils";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

type Mode = "video" | "image";

/** Reconstruye un FrameMeta a partir de una entrada del historial. */
function metaFromHistory(entry: HistoryEntry): FrameMeta {
  const key = entry.videoKey;
  const sourceType: FrameMeta["sourceType"] = key.startsWith("yt:")
    ? "youtube"
    : key.startsWith("local:")
      ? "uploaded"
      : key.startsWith("img:")
        ? "image_upload"
        : "external_url";
  return {
    sourceType,
    videoKey: key,
    videoUrl: key.startsWith("yt:")
      ? `https://www.youtube.com/watch?v=${key.slice(3)}`
      : undefined,
    timestampSeconds: entry.timestampSeconds,
    cacheKey: `${key}:${entry.timestampSeconds}`,
  };
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("video");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [prefs, setPrefs] = useState<Preferences>({
    categoryClicks: {},
    styleClicks: {},
  });

  const analysisHook = useFrameAnalysis();
  const {
    analyze,
    analysis,
    loading,
    error,
    warning,
    mock,
    frameDataUrl,
    videoId: analyzedVideoId,
    savedItems,
    persisted,
  } = analysisHook;
  const [lastFrame, setLastFrame] = useState<{ url: string; meta: FrameMeta } | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    setPrefs(loadPreferences());
  }, []);

  const handleRequestAnalysis = useCallback(
    async (dataUrl: string, meta: FrameMeta) => {
      setLastFrame({ url: dataUrl, meta });
      const result = await analyze(dataUrl, meta);
      if (result) {
        const updated = pushHistory({
          videoKey: meta.videoKey,
          timestampSeconds: meta.timestampSeconds,
          analysis: result,
          frameDataUrl: dataUrl,
        });
        setHistory(updated);
      }
    },
    [analyze]
  );

  const handleReanalyze = useCallback(() => {
    if (lastFrame) {
      void handleRequestAnalysis(lastFrame.url, {
        ...lastFrame.meta,
        cacheKey: `${lastFrame.meta.cacheKey}:r${Date.now()}`,
      });
    }
  }, [lastFrame, handleRequestAnalysis]);

  const handleLinkClick = useCallback((item: DetectedItem, link: ProductLink) => {
    void link;
    setPrefs(recordClick(item));
  }, []);

  const personalizedItems: DetectedItem[] = useMemo(() => {
    if (!analysis) return [];
    return personalizeRanking(analysis, prefs);
  }, [analysis, prefs]);

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    analysisHook.reset();
    setLastFrame(null);
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-6 flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-300">{APP_NAME}</span>
        <Link
          href="/catalog"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-white/25 hover:bg-white/10"
        >
          🗂️ Catálogo
        </Link>
      </nav>

      <Header appName={APP_NAME} />

      <ModeToggle mode={mode} onChange={switchMode} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        {/* Left: player / uploader */}
        <section>
          {mode === "video" ? (
            <VideoProviderAnalyzer
              onRequestAnalysis={handleRequestAnalysis}
              analyzing={loading}
            />
          ) : (
            <ImageAnalyzer
              onRequestAnalysis={handleRequestAnalysis}
              analyzing={loading}
              onReset={analysisHook.reset}
            />
          )}

          {history.length > 0 && (
            <HistoryStrip
              history={history}
              onClear={handleClearHistory}
              onSelect={(entry) =>
                entry.frameDataUrl &&
                handleRequestAnalysis(entry.frameDataUrl, metaFromHistory(entry))
              }
            />
          )}
        </section>

        {/* Right: results */}
        <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <div className="h-full animate-panel-in">
            <ProductResultsPanel
              loading={loading}
              error={error}
              warning={warning}
              analysis={analysis}
              items={personalizedItems}
              frameDataUrl={frameDataUrl}
              mock={mock}
              persisted={persisted}
              savedCount={savedItems.length}
              videoId={analyzedVideoId}
              onLinkClick={handleLinkClick}
              onReanalyze={handleReanalyze}
              canReanalyze={Boolean(lastFrame)}
            />
          </div>
        </div>
      </div>

      <Footer appName={APP_NAME} />
    </main>
  );
}

function Header({ appName }: { appName: string }) {
  return (
    <header className="text-center">
      <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        Shopping visual con IA
      </div>
      <h1 className="bg-gradient-to-br from-white via-zinc-200 to-zinc-500 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
        {appName}
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
        Analiza vídeos de cualquier plataforma o imágenes estáticas y descubre al instante
        los productos que aparecen, con enlaces a Amazon España y tiendas verificadas.
      </p>
    </header>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="mt-8 flex justify-center">
      <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
        {(
          [
            ["video", "📺 Analizar vídeo"],
            ["image", "🖼️ Analizar imagen"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={
              "rounded-lg px-4 py-2 text-sm font-medium transition " +
              (mode === value
                ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/25"
                : "text-zinc-400 hover:text-zinc-200")
            }
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryStrip({
  history,
  onSelect,
  onClear,
}: {
  history: HistoryEntry[];
  onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Últimos frames analizados
        </h3>
        <button
          onClick={onClear}
          className="text-xs text-zinc-500 transition hover:text-rose-300"
        >
          Limpiar
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {history.map((entry) => (
          <button
            key={entry.id}
            onClick={() => onSelect(entry)}
            disabled={!entry.frameDataUrl}
            className="group relative w-32 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40 text-left transition hover:border-indigo-400/40 disabled:opacity-60"
          >
            <div className="aspect-video w-full">
              {entry.frameDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.frameDataUrl}
                  alt="frame"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-zinc-600">—</div>
              )}
            </div>
            <div className="px-2 py-1.5">
              <p className="truncate text-[11px] font-medium text-zinc-300">
                {entry.analysis.items.length} objeto{entry.analysis.items.length === 1 ? "" : "s"}
              </p>
              <p className="text-[10px] text-zinc-500">
                {entry.videoKey.startsWith("img:")
                  ? "imagen"
                  : formatTimestamp(entry.timestampSeconds)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Footer({ appName }: { appName: string }) {
  return (
    <footer className="mt-12 border-t border-white/10 pt-6 text-center text-xs text-zinc-600">
      <p>
        {appName} · MVP de shopping visual. Los enlaces son búsquedas en marketplaces y
        tiendas verificadas — no scrapeamos precios ni inventamos marcas.
      </p>
    </footer>
  );
}
