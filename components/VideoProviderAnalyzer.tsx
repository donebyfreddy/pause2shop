"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectVideoProvider, PROVIDER_LABELS } from "@/lib/video/detectVideoProvider";
import type { VideoProviderDetectionResult } from "@/lib/video/types";
import { useScreenCapture, type CaptureStatus } from "@/hooks/useScreenCapture";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { captureFrameDataUrl } from "@/lib/frameCapture";
import { formatTimestamp } from "@/lib/utils";
import type { FrameMeta } from "@/lib/api/types";

type Props = {
  onRequestAnalysis: (dataUrl: string, meta: FrameMeta) => void;
  analyzing: boolean;
};

const CAPTURE_HINTS: Record<CaptureStatus, { label: string; tone: string }> = {
  idle: { label: "Captura no activa", tone: "text-zinc-400" },
  active: { label: "Captura activa", tone: "text-emerald-400" },
  denied: { label: "Permiso denegado", tone: "text-rose-400" },
  "needs-selection": { label: "Selecciona esta pestaña o ventana", tone: "text-amber-400" },
  error: { label: "Error de captura", tone: "text-rose-400" },
};

export default function VideoProviderAnalyzer({ onRequestAnalysis, analyzing }: Props) {
  const [rawUrl, setRawUrl] = useState("");
  const [detection, setDetection] = useState<VideoProviderDetectionResult | null>(null);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const lastAnalyzedRef = useRef<number | null>(null);
  const directVideoRef = useRef<HTMLVideoElement | null>(null);

  // Screen capture (for iframe-based providers)
  const {
    status: captureStatus,
    isActive,
    error: captureError,
    videoRef: captureVideoRef,
    startCapture,
    stopCapture,
    captureFrame,
  } = useScreenCapture();

  // YouTube IFrame API (only used when provider === youtube)
  const handleYTPaused = useCallback(
    (currentTime: number) => {
      if (!autoAnalyze || !isActive || detection?.provider !== "youtube") return;
      window.setTimeout(() => doIframeCaptureAt(currentTime), 180);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoAnalyze, isActive, detection]
  );
  const { status: ytStatus, containerRef: ytContainerRef, getCurrentTime: ytGetCurrentTime } =
    useYouTubePlayer(
      detection?.provider === "youtube" ? (detection.videoId ?? "") : "",
      handleYTPaused
    );

  // Reset dedup when URL/detection changes
  useEffect(() => {
    lastAnalyzedRef.current = null;
  }, [detection]);

  function handleLoad() {
    if (!rawUrl.trim()) return;
    const result = detectVideoProvider(rawUrl.trim());
    setDetection(result);
    lastAnalyzedRef.current = null;
  }

  function buildMeta(timestampSeconds: number): FrameMeta {
    const d = detection!;
    return {
      sourceType: d.provider === "unknown" ? "external_url" : (d.provider as FrameMeta["sourceType"]),
      videoKey: `${d.provider}:${d.videoId ?? d.normalizedUrl}`,
      videoUrl: d.normalizedUrl,
      videoTitle: `${PROVIDER_LABELS[d.provider]} — ${d.normalizedUrl}`,
      timestampSeconds,
      cacheKey: `${d.provider}:${d.videoId ?? d.normalizedUrl}:${timestampSeconds}`,
      provider: d.provider,
      normalizedUrl: d.normalizedUrl,
      embedUrl: d.embedUrl,
      canEmbed: d.canEmbed,
      canCaptureFrame: d.canCaptureFrame,
    };
  }

  const doIframeCaptureAt = useCallback(
    (currentTime: number) => {
      if (!detection) return;
      const rounded = Math.round(currentTime);
      if (lastAnalyzedRef.current === rounded) return;
      const dataUrl = captureFrame();
      if (!dataUrl) return;
      lastAnalyzedRef.current = rounded;
      onRequestAnalysis(dataUrl, buildMeta(rounded));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [captureFrame, detection, onRequestAnalysis]
  );

  const doDirectCapture = useCallback(() => {
    const video = directVideoRef.current;
    if (!video || !detection) return;
    const rounded = Math.round(video.currentTime);
    if (lastAnalyzedRef.current === rounded) return;
    const dataUrl = captureFrameDataUrl(video);
    if (!dataUrl) return;
    lastAnalyzedRef.current = rounded;
    onRequestAnalysis(dataUrl, buildMeta(rounded));
  }, [detection, onRequestAnalysis]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDirectPause = useCallback(() => {
    if (!autoAnalyze) return;
    doDirectCapture();
  }, [autoAnalyze, doDirectCapture]);

  if (!detection) {
    return <UrlInputPanel rawUrl={rawUrl} onChangeUrl={setRawUrl} onLoad={handleLoad} />;
  }

  const { provider, canEmbed, canCaptureFrame, embedUrl, reason } = detection;

  return (
    <div className="space-y-4">
      {/* Detection badge */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
        <span className="font-medium text-zinc-200">
          Proveedor detectado:
        </span>
        <ProviderBadge provider={provider} />
        <span className={canEmbed ? "text-emerald-400" : "text-zinc-500"}>
          {canEmbed ? "Compatible para embed" : "No embeddable"}
        </span>
        <span className={canCaptureFrame ? "text-emerald-400" : "text-amber-300"}>
          · Captura: {canCaptureFrame ? "Directa" : "Requiere pantalla compartida"}
        </span>
        <button
          onClick={() => { setDetection(null); setRawUrl(""); }}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-200"
        >
          Cambiar URL
        </button>
      </div>

      {/* Player area */}
      {provider === "unknown" ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-rose-400/20 bg-rose-500/5 text-center">
          <span className="text-3xl">🚫</span>
          <p className="max-w-sm text-sm text-rose-200">{reason}</p>
        </div>
      ) : provider === "youtube" ? (
        <YouTubeEmbed
          containerRef={ytContainerRef}
          status={ytStatus}
          analyzing={analyzing}
        />
      ) : canEmbed && provider !== "direct_mp4" && provider !== "hls" ? (
        <IframeEmbed
          embedUrl={embedUrl!}
          providerLabel={PROVIDER_LABELS[provider]}
          analyzing={analyzing}
        />
      ) : (
        <DirectVideoPlayer
          src={detection.normalizedUrl}
          analyzing={analyzing}
          videoRef={directVideoRef}
          onPause={handleDirectPause}
        />
      )}

      {/* Hidden capture video for screen share */}
      <video ref={captureVideoRef} className="hidden" muted playsInline />

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

        {/* Screen capture status (iframe providers) */}
        {!canCaptureFrame && provider !== "unknown" && (
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className={`flex items-center gap-1.5 ${CAPTURE_HINTS[captureStatus].tone}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {CAPTURE_HINTS[captureStatus].label}
            </span>
          </div>
        )}

        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:ml-auto">
          {/* Direct capture providers */}
          {canCaptureFrame && provider !== "unknown" && (
            <button
              onClick={() => {
                lastAnalyzedRef.current = null;
                doDirectCapture();
              }}
              disabled={analyzing}
              className="rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              Analizar frame ahora
            </button>
          )}

          {/* Iframe providers: need screen capture */}
          {!canCaptureFrame && provider !== "unknown" && (
            <>
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
                  const t = provider === "youtube" ? ytGetCurrentTime() : 0;
                  doIframeCaptureAt(t);
                }}
                disabled={!isActive || analyzing}
                className="rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                Analizar captura de pantalla
              </button>
            </>
          )}
        </div>
      </div>

      {/* Iframe cross-origin notice */}
      {!canCaptureFrame && provider !== "unknown" && (
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
          <strong>{PROVIDER_LABELS[provider]}</strong> no permite leer frames directamente por restricciones cross-origin del navegador. Para analizar, activa la captura de pantalla y selecciona <strong>esta pestaña o ventana</strong>.
          {captureError && <span className="mt-1 block text-amber-300/80">{captureError}</span>}
        </div>
      )}

      {provider === "youtube" && (
        <p className="text-center text-[11px] text-zinc-600">
          Posición actual: {formatTimestamp(ytGetCurrentTime())}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UrlInputPanel({
  rawUrl,
  onChangeUrl,
  onLoad,
}: {
  rawUrl: string;
  onChangeUrl: (v: string) => void;
  onLoad: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
        <span className="text-4xl">📺</span>
        <p className="max-w-xs text-center text-sm text-zinc-400">
          Pega una URL de YouTube, Dailymotion, Vimeo, o un enlace directo .mp4 / .m3u8
        </p>
        <div className="flex w-full max-w-md flex-col gap-2 px-6">
          <input
            value={rawUrl}
            onChange={(e) => onChangeUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onLoad()}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-indigo-400/60 focus:bg-white/10"
          />
          <button
            onClick={onLoad}
            disabled={!rawUrl.trim()}
            className="rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            Cargar vídeo
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    youtube: "bg-red-500/15 text-red-300 border-red-500/30",
    dailymotion: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    vimeo: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    direct_mp4: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    hls: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    unknown: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  const label = PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colors[provider] ?? colors.unknown}`}>
      {label}
    </span>
  );
}

function YouTubeEmbed({
  containerRef,
  status,
  analyzing,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  status: string;
  analyzing: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
      <div className="aspect-video w-full">
        <div ref={containerRef} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
      </div>
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-zinc-300">
          Cargando reproductor…
        </div>
      )}
      {analyzing && <AnalyzingOverlay />}
    </div>
  );
}

function IframeEmbed({
  embedUrl,
  providerLabel,
  analyzing,
}: {
  embedUrl: string;
  providerLabel: string;
  analyzing: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
      <div className="aspect-video w-full">
        <iframe
          src={embedUrl}
          title={providerLabel}
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture"
          className="h-full w-full"
        />
      </div>
      {analyzing && <AnalyzingOverlay />}
    </div>
  );
}

function DirectVideoPlayer({
  src,
  analyzing,
  videoRef,
  onPause,
}: {
  src: string;
  analyzing: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onPause: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        onPause={onPause}
        className="aspect-video w-full"
        crossOrigin="anonymous"
      />
      {analyzing && <AnalyzingOverlay />}
    </div>
  );
}

function AnalyzingOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="flex items-center gap-3 rounded-full border border-white/20 bg-black/70 px-5 py-2.5 text-sm font-medium text-white">
        <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
        Analizando frame…
      </div>
    </div>
  );
}
