"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useScreenCapture, type CaptureStatus } from "@/hooks/useScreenCapture";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { formatTimestamp } from "@/lib/utils";
import type { FrameMeta } from "@/lib/api/types";

type Props = {
  videoId: string;
  onRequestAnalysis: (dataUrl: string, meta: FrameMeta) => void;
  analyzing: boolean;
};

const CAPTURE_HINTS: Record<CaptureStatus, { label: string; tone: string }> = {
  idle: { label: "Captura no activa", tone: "text-zinc-400" },
  active: { label: "Captura activa", tone: "text-emerald-400" },
  denied: { label: "Permiso denegado", tone: "text-rose-400" },
  "needs-selection": {
    label: "Selecciona esta pestaña o ventana",
    tone: "text-amber-400",
  },
  error: { label: "Error de captura", tone: "text-rose-400" },
};

export default function YouTubeAnalyzer({
  videoId,
  onRequestAnalysis,
  analyzing,
}: Props) {
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const lastAnalyzedRef = useRef<number | null>(null);

  const {
    status: captureStatus,
    isActive,
    error: captureError,
    videoRef,
    startCapture,
    stopCapture,
    captureFrame,
  } = useScreenCapture();

  const doAnalyze = useCallback(
    (currentTime: number) => {
      const rounded = Math.round(currentTime);
      if (lastAnalyzedRef.current === rounded) return; // same frame → skip
      const dataUrl = captureFrame();
      if (!dataUrl) return;
      lastAnalyzedRef.current = rounded;
      onRequestAnalysis(dataUrl, {
        sourceType: "youtube",
        videoKey: `yt:${videoId}`,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        timestampSeconds: rounded,
        cacheKey: `${videoId}:${rounded}`,
      });
    },
    [captureFrame, onRequestAnalysis, videoId]
  );

  // useYouTubePlayer always invokes the latest version of this callback, so a
  // fresh closure each render keeps autoAnalyze/isActive current with no refs.
  const handlePaused = useCallback(
    (currentTime: number) => {
      if (!autoAnalyze || !isActive) return;
      // Brief delay so the captured tab reflects the paused frame.
      window.setTimeout(() => doAnalyze(currentTime), 180);
    },
    [autoAnalyze, isActive, doAnalyze]
  );

  const { status, containerRef, getCurrentTime } = useYouTubePlayer(
    videoId,
    handlePaused
  );

  // Reset dedupe when the video changes.
  useEffect(() => {
    lastAnalyzedRef.current = null;
  }, [videoId]);

  const captureHint = CAPTURE_HINTS[captureStatus];

  return (
    <div className="space-y-4">
      {/* Player */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
        <div className="aspect-video w-full">
          <div ref={containerRef} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
        </div>

        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-zinc-300">
            Cargando reproductor…
          </div>
        )}

        {analyzing && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <div className="flex items-center gap-3 rounded-full border border-white/20 bg-black/70 px-5 py-2.5 text-sm font-medium text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
              Analizando frame…
            </div>
          </div>
        )}
      </div>

      {/* Hidden video that holds the screen-capture MediaStream */}
      <video ref={videoRef} className="hidden" muted playsInline />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-200">
          <span className="relative inline-flex">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={(e) => setAutoAnalyze(e.target.checked)}
              className="peer sr-only"
            />
            <span className="h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-indigo-500" />
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
          </span>
          Analizar al pausar
        </label>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={`flex items-center gap-1.5 ${captureHint.tone}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {captureHint.label}
          </span>
        </div>

        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {!isActive ? (
            <button
              onClick={startCapture}
              className="rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              Activar captura de pantalla
            </button>
          ) : (
            <button
              onClick={stopCapture}
              className="rounded-lg border border-white/10 bg-transparent px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/10"
            >
              Detener captura
            </button>
          )}

          <button
            onClick={() => {
              lastAnalyzedRef.current = null;
              doAnalyze(getCurrentTime());
            }}
            disabled={!isActive || analyzing}
            className="rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Analizar este frame ahora
          </button>
        </div>
      </div>

      {!isActive && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
          Para analizar vídeos de YouTube necesito permiso de captura de pantalla. Esto
          es necesario porque YouTube no permite leer frames directamente desde el
          iframe. Al activarla, selecciona <strong>esta pestaña o ventana</strong>.
          {captureError && <span className="block mt-1 text-amber-300/80">{captureError}</span>}
        </div>
      )}

      <p className="text-center text-[11px] text-zinc-600">
        Posición actual: {formatTimestamp(getCurrentTime())}
      </p>
    </div>
  );
}
