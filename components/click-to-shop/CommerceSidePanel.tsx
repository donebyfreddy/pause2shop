"use client";

import { MousePointer2, Timer, X } from "lucide-react";
import type { DetectedItem } from "@/lib/types";
import type { PausePerformanceMetrics } from "@/lib/video/pauseAnalysis";
import DetectionResultCard from "@/components/matching/DetectionResultCard";

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="rounded-md border border-line bg-black/15 px-2 py-1">
      {label} <strong className="text-ink">{value == null ? "—" : `${Math.round(value)} ms`}</strong>
    </span>
  );
}

export default function CommerceSidePanel({
  selectedItem,
  frameDataUrl,
  paused,
  metrics,
  debug,
  onClose,
  onSearchExternal,
}: {
  selectedItem: DetectedItem | null;
  frameDataUrl: string | null;
  paused: boolean;
  metrics: PausePerformanceMetrics;
  debug: boolean;
  onClose: () => void;
  onSearchExternal: (detectionId: string) => void;
}) {
  const content = selectedItem ? (
    <DetectionResultCard
      item={selectedItem}
      detection={selectedItem.detection_result ?? null}
      frameUrl={frameDataUrl}
      loading={
        !selectedItem.detection_result &&
        (selectedItem.matchingStatus === "searching" ||
          selectedItem.matchingStatus === "pending")
      }
      externalLoading={selectedItem.external_loading}
      failureDetail={selectedItem.matching_debug?.detail}
      matchingStatus={selectedItem.matchingStatus}
      matchingPhase={selectedItem.matching_phase}
      matchingStartedAt={selectedItem.matching_started_at}
      selected
      onSearchExternal={onSearchExternal}
    />
  ) : (
    <div className="flex min-h-60 flex-col items-center justify-center px-8 text-center">
      <span className="grid size-11 place-items-center rounded-full border border-brand/30 bg-brand/10 text-brand-bright">
        <MousePointer2 className="size-5" aria-hidden />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-ink">
        {paused ? "Selecciona un producto del frame" : "Pausa el vídeo para comprar el look"}
      </h3>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-subtle">
        {paused
          ? "Buscando automáticamente en catálogo e Internet. Puedes elegir otra caja cuando quieras."
          : "Preparamos las detecciones mientras se reproduce para mostrarlas al instante."}
      </p>
    </div>
  );

  return (
    <aside
      aria-label="Productos del frame"
      data-testid="commerce-side-panel"
      className={
        "panel flex h-full flex-col overflow-hidden " +
        (selectedItem
          ? "fixed inset-x-2 bottom-2 z-50 max-h-[68vh] shadow-2xl xl:static xl:max-h-none"
          : "")
      }
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-bright">
            Click-to-shop
          </p>
          <h2 className="mt-1 text-sm font-semibold text-ink">
            {selectedItem?.name ?? "Productos del frame"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            Catálogo e Internet · búsqueda paralela automática
          </p>
        </div>
        {selectedItem ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel de producto"
            className="rounded-lg border border-line p-1.5 text-ink-muted hover:bg-white/5 hover:text-ink xl:hidden"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{content}</div>
      {debug ? (
        <details open className="border-t border-line px-4 py-3 text-[10px] text-ink-subtle">
          <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-ink-muted">
            <Timer className="size-3" aria-hidden /> Telemetría de latencia
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5 font-mono">
            <Metric label="pause→capture" value={metrics.pauseToCaptureMs} />
            <Metric label="capture→boxes" value={metrics.captureToDetectionMs} />
            <Metric label="crop" value={metrics.cropMs} />
            <Metric label="embedding" value={metrics.embeddingMs} />
            <Metric label="vector" value={metrics.vectorSearchMs} />
            <Metric label="ranking" value={metrics.rankingMs} />
            <Metric label="catalog first" value={metrics.catalogFirstResultMs} />
            <Metric label="total" value={metrics.totalMs} />
            <span className="rounded-md border border-line bg-black/15 px-2 py-1">
              cache <strong className="text-ink">{metrics.detectionCacheHit ? "hit" : "miss"}</strong>
            </span>
          </div>
        </details>
      ) : null}
    </aside>
  );
}
