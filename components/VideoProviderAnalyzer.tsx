"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectVideoProvider,
  createUploadedVideoDetection,
  PROVIDER_LABELS,
} from "@/lib/video/detectVideoProvider";
import type { VideoProviderDetectionResult } from "@/lib/video/types";
import {
  useContinuousScreenAnalysis,
  type CapturePhase,
  type DebugEntry,
} from "@/hooks/useContinuousScreenAnalysis";
import { useAutoCaptureInterval } from "@/hooks/useAutoCaptureInterval";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { useVideoCaptureEngine, type EngineLogEvent } from "@/hooks/useVideoCaptureEngine";
import { captureFrameDataUrl } from "@/lib/frameCapture";
import { formatTimestamp } from "@/lib/utils";
import type { FrameMeta } from "@/lib/api/types";
import type { FrameSourceType } from "@/lib/catalog/types";
import type { DetectedItem } from "@/lib/types";
import VideoOverlay from "@/components/VideoOverlay";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_S = Number(
  process.env.NEXT_PUBLIC_AUTO_CAPTURE_INTERVAL_SECONDS ??
    process.env.NEXT_PUBLIC_DEFAULT_VIDEO_ANALYSIS_INTERVAL_SECONDS ??
    "3"
);

// ─── Types ────────────────────────────────────────────────────────────────────

type VideoInputMode = "url" | "upload";
type UploadedFile = { src: string; name: string };

type Props = {
  onRequestAnalysis: (dataUrl: string, meta: FrameMeta) => Promise<void> | void;
  analyzing: boolean;
  overlayItems?: DetectedItem[];
  onOverlayItemClick?: (item: DetectedItem) => void;
};

// ─── Phase display helpers ────────────────────────────────────────────────────

const PHASE_LABEL: Record<CapturePhase, string> = {
  idle: "No activa",
  requesting_permission: "Solicitando permiso…",
  capture_active: "Captura activa",
  capturing_frame: "Capturando frame…",
  analyzing_frame: "Analizando frame…",
  waiting_next_interval: "Esperando siguiente intervalo",
  skipped_similar_frame: "Frame saltado (escena similar)",
  skipped_busy: "Frame saltado (análisis en curso)",
  error: "Error",
  stopped: "Detenida",
};

const PHASE_COLOR: Record<CapturePhase, string> = {
  idle: "text-zinc-500",
  requesting_permission: "text-amber-400",
  capture_active: "text-emerald-400",
  capturing_frame: "text-sky-400",
  analyzing_frame: "text-indigo-400",
  waiting_next_interval: "text-emerald-400",
  skipped_similar_frame: "text-zinc-400",
  skipped_busy: "text-zinc-400",
  error: "text-rose-400",
  stopped: "text-zinc-500",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function VideoProviderAnalyzer({
  onRequestAnalysis,
  analyzing,
  overlayItems = [],
  onOverlayItemClick,
}: Props) {
  // --- Video source state ---
  const [videoInputMode, setVideoInputMode] = useState<VideoInputMode>("url");
  const [rawUrl, setRawUrl] = useState("");
  const [detection, setDetection] = useState<VideoProviderDetectionResult | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // --- Analysis controls ---
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [autoCaptureMode, setAutoCaptureMode] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(DEFAULT_INTERVAL_S);
  const [showDebug, setShowDebug] = useState(false);

  // Pause dedup ref for direct video
  const lastPausedTimestampRef = useRef<number | null>(null);
  const directVideoRef = useRef<HTMLVideoElement | null>(null);

  // Direct-canvas engine logs (merged into the debug panel)
  const [directLogs, setDirectLogs] = useState<DebugEntry[]>([]);
  const addDirectLog = useCallback((ev: EngineLogEvent) => {
    setDirectLogs((prev) => [{ time: Date.now(), msg: ev.msg }, ...prev].slice(0, 80));
  }, []);

  // ── buildMeta ──────────────────────────────────────────────────────────────

  const buildMeta = useCallback(
    (timestampSeconds: number, withCache = false): FrameMeta => {
      const d = detection!;

      if (d.provider === "uploaded_video") {
        const videoKey = `local:${d.originalUrl}`;
        return {
          sourceType: "uploaded" as FrameSourceType,
          videoKey,
          videoTitle: d.originalUrl,
          timestampSeconds,
          cacheKey: withCache ? `${videoKey}:${timestampSeconds}` : `${videoKey}:${timestampSeconds}:${Date.now()}`,
          provider: "uploaded_video",
          normalizedUrl: uploadedFile?.src ?? d.normalizedUrl,
          canEmbed: false,
          canCaptureFrame: true,
        };
      }

      const videoKey = `${d.provider}:${d.videoId ?? d.normalizedUrl}`;
      return {
        sourceType:
          d.provider === "unknown"
            ? "external_url"
            : (d.provider as FrameSourceType),
        videoKey,
        videoUrl: d.normalizedUrl,
        videoTitle: `${PROVIDER_LABELS[d.provider]} — ${d.normalizedUrl}`,
        timestampSeconds,
        cacheKey: withCache ? `${videoKey}:${timestampSeconds}` : undefined,
        provider: d.provider,
        normalizedUrl: d.normalizedUrl,
        embedUrl: d.embedUrl,
        canEmbed: d.canEmbed,
        canCaptureFrame: d.canCaptureFrame,
      };
    },
    [detection, uploadedFile]
  );

  // Stable ref for ytGetCurrentTime
  const ytGetCurrentTimeRef = useRef<() => number>(() => 0);

  // ── Screen capture hook (for YouTube / Dailymotion / Vimeo) ───────────────

  const screenAnalyzeCallback = useCallback(
    async (dataUrl: string) => {
      if (!detection) return;
      const t = detection.provider === "youtube" ? ytGetCurrentTimeRef.current() : 0;
      await onRequestAnalysis(dataUrl, buildMeta(t, false));
    },
    [detection, buildMeta, onRequestAnalysis]
  );

  const {
    phase: capturePhase,
    streamActive,
    isLooping,
    error: captureError,
    frameCount,
    analyzedCount,
    skippedCount,
    lastFrameAt,
    debugLog: screenLog,
    captureVideoRef,
    startCapture,
    stopCapture,
    captureAndAnalyzeNow,
    clearLog: clearScreenLog,
  } = useContinuousScreenAnalysis({
    loopEnabled: autoCaptureMode && !!(detection?.requiresScreenCapture),
    intervalMs: intervalSeconds * 1000,
    onAnalyze: screenAnalyzeCallback,
  });

  // ── YouTube player ─────────────────────────────────────────────────────────

  const handleYTPaused = useCallback(
    (currentTime: number) => {
      if (!autoAnalyze || !streamActive || detection?.provider !== "youtube") return;
      globalThis.setTimeout(() => {
        if (!detection) return;
        const rounded = Math.round(currentTime);
        if (lastPausedTimestampRef.current === rounded) return;
        const dataUrl = captureFrameDataUrl(captureVideoRef.current!, 1024, 0.7);
        if (!dataUrl) return;
        lastPausedTimestampRef.current = rounded;
        void onRequestAnalysis(dataUrl, buildMeta(rounded, true));
      }, 180);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoAnalyze, streamActive, detection, buildMeta, onRequestAnalysis]
  );

  const {
    status: ytStatus,
    containerRef: ytContainerRef,
    getCurrentTime: ytGetCurrentTime,
  } = useYouTubePlayer(
    detection?.provider === "youtube" ? (detection.videoId ?? "") : "",
    handleYTPaused
  );

  ytGetCurrentTimeRef.current = ytGetCurrentTime;

  // ── Direct canvas capture engine (MP4 / HLS / uploaded) ───────────────────

  const getDirectVideoElement = useCallback(
    () => directVideoRef.current,
    []
  );

  const onDirectCapture = useCallback(
    (dataUrl: string) => {
      if (!detection) return;
      const ts = Math.round(directVideoRef.current?.currentTime ?? 0);
      void onRequestAnalysis(dataUrl, buildMeta(ts, true));
    },
    [detection, buildMeta, onRequestAnalysis]
  );

  const directEngine = useVideoCaptureEngine({
    captureMode: "direct_canvas",
    getVideoElement: getDirectVideoElement,
    analyzing,
    onCapture: onDirectCapture,
    onLog: addDirectLog,
  });

  // Auto-capture for direct canvas mode
  useAutoCaptureInterval({
    enabled: autoCaptureMode && !analyzing && !!(detection?.canCaptureFrameDirectly),
    intervalMs: intervalSeconds * 1000,
    onCapture: directEngine.captureAuto,
  });

  // Pause handler for direct video
  const handleDirectPause = useCallback(() => {
    if (!autoAnalyze || !detection) return;
    directEngine.captureNow();
  }, [autoAnalyze, detection, directEngine]);

  // ── Reset on source change ─────────────────────────────────────────────────

  useEffect(() => {
    lastPausedTimestampRef.current = null;
    directEngine.resetDiff();
    setDirectLogs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection]);

  // Revoke objectURL on unmount / file change
  useEffect(() => {
    return () => {
      if (uploadedFile) URL.revokeObjectURL(uploadedFile.src);
    };
  }, [uploadedFile]);

  // ── URL mode ───────────────────────────────────────────────────────────────

  function handleLoadUrl() {
    if (!rawUrl.trim()) return;
    const result = detectVideoProvider(rawUrl.trim());
    setDetection(result);
    setAutoCaptureMode(false);
  }

  // ── Upload mode ────────────────────────────────────────────────────────────

  function handleFile(file: File) {
    if (!file.type.startsWith("video/")) return;
    if (uploadedFile) URL.revokeObjectURL(uploadedFile.src);
    const src = URL.createObjectURL(file);
    const uploaded: UploadedFile = { src, name: file.name };
    setUploadedFile(uploaded);
    setDetection(createUploadedVideoDetection(file.name));
    setAutoCaptureMode(false);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  // ── Tab switch ─────────────────────────────────────────────────────────────

  function switchTab(tab: VideoInputMode) {
    if (tab === videoInputMode) return;
    setVideoInputMode(tab);
    setDetection(null);
    setRawUrl("");
    setAutoCaptureMode(false);
    if (uploadedFile) {
      URL.revokeObjectURL(uploadedFile.src);
      setUploadedFile(null);
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const { provider, canEmbed, canCaptureFrame, requiresScreenCapture, preferredCaptureMode, embedUrl, reason } =
    detection ?? {
      provider: undefined,
      canEmbed: false,
      canCaptureFrame: false,
      requiresScreenCapture: false,
      preferredCaptureMode: "unsupported" as const,
      embedUrl: undefined,
      reason: undefined,
    };

  const directVideoSrc =
    detection?.provider === "uploaded_video"
      ? (uploadedFile?.src ?? "")
      : (detection?.normalizedUrl ?? "");

  const analyzeNowDisabled = !streamActive || analyzing || capturePhase === "analyzing_frame";
  const analyzeNowTooltip = !streamActive
    ? "Activa la captura de pantalla primero"
    : analyzing || capturePhase === "analyzing_frame"
      ? "Ya hay un análisis en curso"
      : undefined;

  const secondsAgo =
    lastFrameAt != null ? Math.round((Date.now() - lastFrameAt) / 1000) : null;

  // Combined debug log for the panel
  const combinedLog: DebugEntry[] =
    requiresScreenCapture ? screenLog : directLogs;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Tab selector */}
      <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
        <TabButton active={videoInputMode === "url"} onClick={() => switchTab("url")}>
          🔗 Pegar link
        </TabButton>
        <TabButton active={videoInputMode === "upload"} onClick={() => switchTab("upload")}>
          📁 Subir vídeo
        </TabButton>
      </div>

      {/* Content: input or player */}
      {!detection ? (
        videoInputMode === "url" ? (
          <UrlInputPanel rawUrl={rawUrl} onChangeUrl={setRawUrl} onLoad={handleLoadUrl} />
        ) : (
          <UploadDropZone
            isDragging={isDragging}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onFileChange={handleFileInputChange}
          />
        )
      ) : (
        <>
          {/* Detection badge */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
            <span className="font-medium text-zinc-200">Proveedor detectado:</span>
            <ProviderBadge provider={provider!} />
            <span className={canEmbed ? "text-emerald-400" : "text-zinc-500"}>
              {canEmbed ? "Embed compatible" : "No embeddable"}
            </span>
            {preferredCaptureMode === "direct_canvas" ? (
              <span className="text-emerald-400">
                · Captura directa — sin compartir pantalla
              </span>
            ) : requiresScreenCapture ? (
              <span className="text-amber-300">
                · Requiere pantalla compartida
              </span>
            ) : null}
            {preferredCaptureMode === "direct_canvas" && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                canvas directo
              </span>
            )}
            <button
              onClick={() => {
                setDetection(null);
                setRawUrl("");
                setAutoCaptureMode(false);
                if (uploadedFile) { URL.revokeObjectURL(uploadedFile.src); setUploadedFile(null); }
              }}
              className="ml-auto text-xs text-zinc-500 hover:text-zinc-200"
            >
              {provider === "uploaded_video" ? "Cambiar vídeo" : "Cambiar URL"}
            </button>
          </div>

          {/* Screen capture status bar (only for iframe providers) */}
          {requiresScreenCapture && (
            <CaptureStatusBar
              phase={capturePhase}
              streamActive={streamActive}
              isLooping={isLooping}
              frameCount={frameCount}
              analyzedCount={analyzedCount}
              skippedCount={skippedCount}
              secondsAgo={secondsAgo}
              intervalSeconds={intervalSeconds}
            />
          )}

          {/* YouTube warning */}
          {provider === "youtube" && !streamActive && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
              <strong className="block mb-1">YouTube requiere captura de pantalla</strong>
              El navegador bloquea la lectura directa de frames del iframe por restricciones
              cross-origin. Para analizar:
              <ol className="mt-1.5 list-decimal list-inside space-y-0.5 text-amber-200/90">
                <li>Pulsa <strong>Activar captura de pantalla</strong> abajo</li>
                <li>Selecciona <strong>Esta pestaña</strong> (no toda la pantalla)</li>
                <li>Activa auto-captura y reproduce el vídeo</li>
              </ol>
              <p className="mt-2 text-amber-300/70">
                Si quieres evitar compartir pantalla, sube un MP4 con el tab{" "}
                <strong>Subir vídeo</strong>.
              </p>
            </div>
          )}

          {/* Other iframe providers */}
          {requiresScreenCapture && provider !== "youtube" && !streamActive && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
              <strong>{PROVIDER_LABELS[provider!]}</strong> no permite leer frames directamente
              (restricción cross-origin). Activa la captura de pantalla y selecciona{" "}
              <strong>esta pestaña</strong>.
              {captureError && <span className="mt-1 block text-rose-300">{captureError}</span>}
            </div>
          )}

          {/* Direct canvas confirmation */}
          {preferredCaptureMode === "direct_canvas" && provider !== "unknown" && (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
              <strong>Captura directa activa.</strong>{" "}
              {reason ?? "No necesitas compartir pantalla para analizar este vídeo."}
            </div>
          )}

          {/* Player area */}
          {provider === "unknown" ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-rose-400/20 bg-rose-500/5 text-center">
              <span className="text-3xl">🚫</span>
              <p className="max-w-sm text-sm text-rose-200">{reason}</p>
              <p className="text-xs text-zinc-500">
                Cambia al tab <strong>Subir vídeo</strong> o usa una URL .mp4/.m3u8.
              </p>
            </div>
          ) : provider === "youtube" ? (
            <YouTubeEmbed
              containerRef={ytContainerRef}
              status={ytStatus}
              analyzing={analyzing}
              overlayItems={overlayItems}
              onOverlayItemClick={onOverlayItemClick}
            />
          ) : canEmbed && !canCaptureFrame ? (
            <IframeEmbed
              embedUrl={embedUrl!}
              providerLabel={PROVIDER_LABELS[provider!]}
              analyzing={analyzing}
              overlayItems={overlayItems}
              onOverlayItemClick={onOverlayItemClick}
            />
          ) : (
            <DirectVideoPlayer
              src={directVideoSrc}
              analyzing={analyzing}
              videoRef={directVideoRef}
              onPause={handleDirectPause}
              overlayItems={overlayItems}
              onOverlayItemClick={onOverlayItemClick}
            />
          )}

          {/* Hidden video for screen stream */}
          <video ref={captureVideoRef} className="hidden" muted playsInline />

          {/* Controls */}
          {provider !== "unknown" && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-200">
                <Toggle checked={autoAnalyze} onChange={setAutoAnalyze} />
                Analizar al pausar
              </label>

              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-200">
                <Toggle checked={autoCaptureMode} onChange={setAutoCaptureMode} color="emerald" />
                <span>
                  Auto-captura
                  {autoCaptureMode && (
                    <span className="ml-1 text-xs text-emerald-400">cada {intervalSeconds}s</span>
                  )}
                </span>
              </label>

              {autoCaptureMode && (
                <select
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-zinc-200 outline-none"
                >
                  {[2, 3, 5, 10, 15, 30].map((s) => (
                    <option key={s} value={s}>{s}s</option>
                  ))}
                </select>
              )}

              {/* Action buttons */}
              <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:ml-auto">
                {/* Direct canvas mode */}
                {preferredCaptureMode === "direct_canvas" && (
                  <button
                    onClick={() => directEngine.captureNow()}
                    disabled={analyzing}
                    title={analyzing ? "Ya hay un análisis en curso" : undefined}
                    className="rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                  >
                    {analyzing ? "Analizando…" : "Analizar frame actual"}
                  </button>
                )}

                {/* Screen capture mode */}
                {requiresScreenCapture && (
                  <>
                    {!streamActive ? (
                      <button
                        onClick={startCapture}
                        disabled={capturePhase === "requesting_permission"}
                        className="rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-40"
                      >
                        {capturePhase === "requesting_permission"
                          ? "Solicitando permiso…"
                          : "Activar captura de pantalla"}
                      </button>
                    ) : (
                      <button
                        onClick={stopCapture}
                        className="rounded-lg border border-white/10 bg-transparent px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/10"
                      >
                        Detener captura
                      </button>
                    )}

                    <div className="relative group">
                      <button
                        onClick={() => void captureAndAnalyzeNow()}
                        disabled={analyzeNowDisabled}
                        className="rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                      >
                        Analizar captura de pantalla
                      </button>
                      {analyzeNowTooltip && (
                        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-[11px] text-zinc-300 opacity-0 transition group-hover:opacity-100">
                          {analyzeNowTooltip}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Auto-capture running indicator */}
          {(isLooping || (autoCaptureMode && preferredCaptureMode === "direct_canvas")) && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Auto-captura activa — capturando cada {intervalSeconds}s · solo frames nuevos
            </div>
          )}

          {provider === "youtube" && streamActive && (
            <p className="text-center text-[11px] text-zinc-600">
              Posición actual: {formatTimestamp(ytGetCurrentTime())}
            </p>
          )}

          {/* Debug panel */}
          <DebugPanel
            visible={showDebug}
            onToggle={() => setShowDebug((v) => !v)}
            entries={combinedLog}
            onClear={requiresScreenCapture ? clearScreenLog : () => setDirectLogs([])}
            frameCount={requiresScreenCapture ? frameCount : 0}
            analyzedCount={requiresScreenCapture ? analyzedCount : 0}
            skippedCount={requiresScreenCapture ? skippedCount : 0}
          />
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition " +
        (active
          ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/20"
          : "text-zinc-400 hover:text-zinc-200")
      }
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  color = "indigo",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  color?: "indigo" | "emerald";
}) {
  const bg = checked
    ? color === "emerald"
      ? "peer-checked:bg-emerald-500"
      : "peer-checked:bg-indigo-500"
    : "";
  return (
    <span className="relative inline-flex">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className={`h-6 w-11 rounded-full bg-white/10 transition ${bg}`} />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
    </span>
  );
}

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
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
      <span className="text-4xl">📺</span>
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-200">Pega una URL de vídeo</p>
        <p className="mt-1 text-xs text-zinc-500">
          YouTube · Dailymotion · Vimeo · enlace directo .mp4 / .m3u8
        </p>
      </div>
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
  );
}

function UploadDropZone({
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
}: {
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={
        "flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed text-center transition " +
        (isDragging
          ? "border-indigo-400/60 bg-indigo-500/10 scale-[1.01]"
          : "border-white/15 bg-white/[0.03] hover:border-indigo-400/40 hover:bg-white/[0.05]")
      }
    >
      <span className="text-4xl">{isDragging ? "⬇️" : "🎬"}</span>
      <div>
        <p className="text-sm font-medium text-zinc-200">
          {isDragging ? "Suelta el vídeo aquí" : "Sube o arrastra un vídeo"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          MP4, WebM, MOV · captura directa sin compartir pantalla
        </p>
      </div>
      <span className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/10">
        Seleccionar archivo
      </span>
      <input
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/*"
        onChange={onFileChange}
        className="hidden"
      />
    </label>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    youtube: "bg-red-500/15 text-red-300 border-red-500/30",
    dailymotion: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    vimeo: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    direct_mp4: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    hls: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    uploaded_video: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    unknown: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  const label = PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colors[provider] ?? colors.unknown}`}>
      {label}
    </span>
  );
}

function CaptureStatusBar({
  phase,
  streamActive,
  isLooping,
  frameCount,
  analyzedCount,
  skippedCount,
  secondsAgo,
  intervalSeconds,
}: {
  phase: CapturePhase;
  streamActive: boolean;
  isLooping: boolean;
  frameCount: number;
  analyzedCount: number;
  skippedCount: number;
  secondsAgo: number | null;
  intervalSeconds: number;
}) {
  const dot =
    ["capture_active", "waiting_next_interval", "analyzing_frame", "capturing_frame"].includes(phase)
      ? "animate-pulse"
      : "";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs">
      <span className={`flex items-center gap-1.5 font-medium ${PHASE_COLOR[phase]}`}>
        <span className={`h-1.5 w-1.5 rounded-full bg-current ${dot}`} />
        {PHASE_LABEL[phase]}
      </span>
      {streamActive && (
        <>
          {secondsAgo !== null && (
            <span className="text-zinc-500">Último frame: hace {secondsAgo}s</span>
          )}
          {isLooping && (
            <span className="text-zinc-500">Intervalo: {intervalSeconds}s</span>
          )}
          {frameCount > 0 && (
            <span className="text-zinc-500">
              Capturados: <span className="text-zinc-300">{frameCount}</span>
              {" · "}Analizados: <span className="text-emerald-400">{analyzedCount}</span>
              {skippedCount > 0 && (
                <>{" · "}Saltados: <span className="text-zinc-400">{skippedCount}</span></>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function DebugPanel({
  visible,
  onToggle,
  entries,
  onClear,
  frameCount,
  analyzedCount,
  skippedCount,
}: {
  visible: boolean;
  onToggle: () => void;
  entries: DebugEntry[];
  onClear: () => void;
  frameCount: number;
  analyzedCount: number;
  skippedCount: number;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] text-xs">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-zinc-400 hover:text-zinc-200"
      >
        <span className="font-medium">
          Debug captura
          {entries.length > 0 && (
            <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {entries.length}
            </span>
          )}
        </span>
        <span className="text-zinc-600">{visible ? "▲" : "▼"}</span>
      </button>

      {visible && (
        <div className="border-t border-white/10">
          {frameCount > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-2 text-zinc-500">
              <span>
                Frames: {frameCount} · Analizados: {analyzedCount} · Saltados: {skippedCount}
              </span>
              {entries.length > 0 && (
                <button onClick={onClear} className="text-zinc-600 transition hover:text-zinc-400">
                  Limpiar
                </button>
              )}
            </div>
          )}
          <div className="max-h-52 overflow-y-auto px-4 pb-3 font-mono">
            {entries.length === 0 ? (
              <p className="py-2 text-zinc-600">Sin eventos todavía.</p>
            ) : (
              entries.map((entry, i) => (
                <div key={i} className="py-[3px] leading-tight">
                  <span className="text-zinc-600">
                    {new Date(entry.time).toLocaleTimeString("es", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>{" "}
                  <span
                    className={
                      entry.msg.includes("error") || entry.msg.includes("Error")
                        ? "text-rose-400"
                        : entry.msg.includes("saltado") || entry.msg.includes("forzado")
                          ? "text-amber-400"
                          : entry.msg.includes("✓") || entry.msg.includes("activ") || entry.msg.includes("capturado")
                            ? "text-emerald-400"
                            : "text-zinc-300"
                    }
                  >
                    {entry.msg}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function YouTubeEmbed({
  containerRef,
  status,
  analyzing,
  overlayItems,
  onOverlayItemClick,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  status: string;
  analyzing: boolean;
  overlayItems: DetectedItem[];
  onOverlayItemClick?: (item: DetectedItem) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
      <div className="aspect-video w-full">
        <div ref={containerRef} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
      </div>
      <VideoOverlay items={overlayItems} onItemClick={onOverlayItemClick} />
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
  overlayItems,
  onOverlayItemClick,
}: {
  embedUrl: string;
  providerLabel: string;
  analyzing: boolean;
  overlayItems: DetectedItem[];
  onOverlayItemClick?: (item: DetectedItem) => void;
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
      <VideoOverlay items={overlayItems} onItemClick={onOverlayItemClick} />
      {analyzing && <AnalyzingOverlay />}
    </div>
  );
}

function DirectVideoPlayer({
  src,
  analyzing,
  videoRef,
  onPause,
  overlayItems,
  onOverlayItemClick,
}: {
  src: string;
  analyzing: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onPause: () => void;
  overlayItems: DetectedItem[];
  onOverlayItemClick?: (item: DetectedItem) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        onPause={onPause}
        crossOrigin="anonymous"
        className="aspect-video w-full"
      />
      <VideoOverlay items={overlayItems} onItemClick={onOverlayItemClick} />
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
