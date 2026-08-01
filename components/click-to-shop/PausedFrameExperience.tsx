"use client";

import type { ReactNode } from "react";
import { Check, MousePointer2, ScanLine } from "lucide-react";
import type { DetectedItem } from "@/lib/types";
import ClickableDetectionOverlay from "./ClickableDetectionOverlay";

function preciseTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

export default function PausedFrameExperience({
  children,
  frozenFrameUrl,
  mediaTime,
  mediaAspect,
  detections,
  detecting,
  cacheHit,
  selectedKey,
  onSelect,
}: {
  children: ReactNode;
  frozenFrameUrl: string | null;
  mediaTime: number | null;
  mediaAspect?: number | null;
  detections: DetectedItem[];
  detecting: boolean;
  cacheHit: boolean;
  selectedKey?: string | null;
  onSelect: (item: DetectedItem) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-black shadow-2xl shadow-black/50">
      {children}
      {frozenFrameUrl ? (
        // El origen es un data URL efímero del frame exacto; next/image no
        // puede optimizarlo y añadiría latencia a la congelación.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frozenFrameUrl}
          alt="Frame exacto congelado al pausar"
          className="pointer-events-none absolute inset-0 z-10 size-full object-contain"
          data-testid="paused-frame-image"
        />
      ) : null}
      {frozenFrameUrl && detections.length > 0 ? (
        <ClickableDetectionOverlay
          items={detections}
          mediaAspect={mediaAspect}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ) : null}

      {frozenFrameUrl ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-12 z-40 flex flex-wrap items-end justify-between gap-2">
          <div className="rounded-xl border border-white/15 bg-black/80 px-3 py-2 text-white shadow-lg backdrop-blur-md">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Check className="size-3.5 text-success" aria-hidden />
              Frame capturado · {preciseTimestamp(mediaTime ?? 0)}
              {cacheHit ? <span className="text-success">· caché</span> : null}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/70">
              {detections.length > 0 ? (
                <>
                  <MousePointer2 className="size-3" aria-hidden />
                  {detections.length} productos detectados · Haz clic en un objeto
                </>
              ) : (
                <>
                  <ScanLine className="size-3 animate-pulse" aria-hidden />
                  {detecting ? "Detectando productos en este frame…" : "Sin objetos comprables"}
                </>
              )}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
