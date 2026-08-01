"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
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
import { useVideoFrameLoop } from "@/hooks/useVideoFrameLoop";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { useVideoCaptureEngine, type EngineLogEvent } from "@/hooks/useVideoCaptureEngine";
import { captureFrameDataUrl } from "@/lib/frameCapture";
import { formatTimestamp, itemKey } from "@/lib/utils";
import type { FrameMeta } from "@/lib/api/types";
import type { FrameSourceType } from "@/lib/catalog/types";
import type { DetectedItem } from "@/lib/types";
import VideoOverlay from "@/components/VideoOverlay";
import { IS_PRESENTATION } from "@/lib/presentation";
import PausedFrameExperience from "@/components/click-to-shop/PausedFrameExperience";
import {
  ExactPausedFrameCapture,
  blobToDataUrl,
  type PauseCaptureDebug,
  type PresentedVideoFrame,
} from "@/lib/video/exactPausedFrameCapture";
import {
  EMPTY_PAUSE_METRICS,
  nearestAnalyzedFrame,
  responseMatchesActiveSession,
  type AnalysisIdentity,
  type AnalyzedVideoFrame,
  type PausePerformanceMetrics,
} from "@/lib/video/pauseAnalysis";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_S = Number(
  process.env.NEXT_PUBLIC_AUTO_CAPTURE_INTERVAL_SECONDS ??
    process.env.NEXT_PUBLIC_DEFAULT_VIDEO_ANALYSIS_INTERVAL_SECONDS ??
    "3"
);

/**
 * Flujo de URLs (YouTube/Vimeo/MP4 remoto) desactivado para la demo: la UI
 * solo muestra "Subir vídeo". El código queda intacto para una fase futura.
 */
const ENABLE_VIDEO_URLS = process.env.NEXT_PUBLIC_ENABLE_VIDEO_URLS === "true";

/** Auto-análisis al reproducir (por defecto activado). */
const VIDEO_AUTO_ANALYSIS = process.env.NEXT_PUBLIC_VIDEO_AUTO_ANALYSIS !== "false";
const VIDEO_PREANALYSIS_ENABLED =
  process.env.NEXT_PUBLIC_VIDEO_PREANALYSIS_ENABLED !== "false";
const VIDEO_PREANALYSIS_FPS = Math.max(
  0.1,
  Number(process.env.NEXT_PUBLIC_VIDEO_PREANALYSIS_FPS ?? "1")
);

/** Tick local del scheduler (rápido y barato; el análisis remoto lo decide el engine). */
const FRAME_CHECK_INTERVAL_MS = Number(
  process.env.NEXT_PUBLIC_VIDEO_FRAME_CHECK_INTERVAL_MS ??
    String(Math.round(1000 / VIDEO_PREANALYSIS_FPS))
);

// ─── Types ────────────────────────────────────────────────────────────────────

type VideoInputMode = "url" | "upload";
type UploadedFile = { src: string; name: string };

export type VideoAnalysisStats = {
  /** Personas visibles en el último análisis (solo como referencia espacial). */
  persons: number;
  /** Objetos actualmente seguidos por el tracker. */
  trackedObjects: number;
  /** Productos únicos acumulados en la sesión. */
  uniqueProducts: number;
  /** Productos con match comercial. */
  matchedProducts: number;
};

type Props = {
  onRequestAnalysis: (
    dataUrl: string,
    meta: FrameMeta,
    identity?: AnalysisIdentity | null
  ) => Promise<void> | void;
  analyzing: boolean;
  overlayItems?: DetectedItem[];
  onOverlayItemClick?: (item: DetectedItem) => void;
  /**
   * Objeto resaltado, sincronizado con la tarjeta del panel de resultados.
   * En vídeo faltaba: el recuadro se podía clicar pero nunca se resaltaba.
   */
  selectedKey?: string | null;
  /** Contadores en vivo para la línea de estado no bloqueante. */
  analysisStats?: VideoAnalysisStats;
  analysisIdentity?: AnalysisIdentity | null;
  preanalyzedFrames?: AnalyzedVideoFrame[];
  onPauseStart?: () => void;
  onPausedFrameChange?: (context: PausedFrameContext | null) => void;
  onDetectionSelect?: (item: DetectedItem, context: PausedFrameContext) => void;
  onMetricsChange?: (metrics: PausePerformanceMetrics) => void;
  selectedItemDetails?: DetectedItem | null;
};

export type PausedFrameContext = {
  dataUrl: string;
  meta: FrameMeta;
  identity: AnalysisIdentity;
  pauseStartedAt: number;
};

// ─── Phase display helpers ────────────────────────────────────────────────────

/** Claves de mensajes (namespace studio.videoAnalyzer.phase) por fase de captura. */
const PHASE_LABEL_KEY = {
  idle: "phase.idle",
  requesting_permission: "phase.requestingPermission",
  capture_active: "phase.captureActive",
  capturing_frame: "phase.capturingFrame",
  analyzing_frame: "phase.analyzingFrame",
  waiting_next_interval: "phase.waitingNextInterval",
  skipped_similar_frame: "phase.skippedSimilarFrame",
  skipped_busy: "phase.skippedBusy",
  error: "phase.error",
  stopped: "phase.stopped",
} as const satisfies Record<CapturePhase, string>;

const PHASE_COLOR: Record<CapturePhase, string> = {
  idle: "text-ink-subtle",
  requesting_permission: "text-warning",
  capture_active: "text-success",
  capturing_frame: "text-info",
  analyzing_frame: "text-brand-bright",
  waiting_next_interval: "text-success",
  skipped_similar_frame: "text-ink-muted",
  skipped_busy: "text-ink-muted",
  error: "text-danger",
  stopped: "text-ink-subtle",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function VideoProviderAnalyzer({
  onRequestAnalysis,
  analyzing,
  overlayItems = [],
  onOverlayItemClick,
  selectedKey = null,
  analysisStats,
  analysisIdentity = null,
  preanalyzedFrames = [],
  onPauseStart,
  onPausedFrameChange,
  onDetectionSelect,
  onMetricsChange,
  selectedItemDetails = null,
}: Props) {
  const t = useTranslations("studio.videoAnalyzer");
  const format = useFormatter();
  // --- Video source state ---
  const [videoInputMode, setVideoInputMode] = useState<VideoInputMode>(
    ENABLE_VIDEO_URLS ? "url" : "upload"
  );
  const [rawUrl, setRawUrl] = useState("");
  const [detection, setDetection] = useState<VideoProviderDetectionResult | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // --- Analysis controls ---
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  // Auto-captura ON por defecto: subir vídeo + play = análisis automático.
  const [autoCaptureMode, setAutoCaptureMode] = useState(VIDEO_AUTO_ANALYSIS);
  const [intervalSeconds, setIntervalSeconds] = useState(DEFAULT_INTERVAL_S);
  const [showDebug, setShowDebug] = useState(false);
  const [pauseHint, setPauseHint] = useState<string | null>(null);

  // Pause dedup ref for direct video
  const lastPausedTimestampRef = useRef<number | null>(null);
  const directVideoRef = useRef<HTMLVideoElement | null>(null);
  const exactCaptureRef = useRef<ExactPausedFrameCapture | null>(null);
  const pauseCaptureAbortRef = useRef<AbortController | null>(null);
  const activePauseRef = useRef<PausedFrameContext | null>(null);
  const lastPresentedFrameRef = useRef<PresentedVideoFrame | null>(null);
  const [pausedFrame, setPausedFrame] = useState<PausedFrameContext | null>(null);
  const [pausedDetections, setPausedDetections] = useState<DetectedItem[]>([]);
  const [pauseMetrics, setPauseMetrics] = useState<PausePerformanceMetrics>(
    EMPTY_PAUSE_METRICS
  );

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
          cacheKey: withCache
            ? `${videoKey}:${timestampSeconds.toFixed(3)}`
            : `${videoKey}:${timestampSeconds.toFixed(3)}:${Date.now()}`,
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
        cacheKey: withCache ? `${videoKey}:${timestampSeconds.toFixed(3)}` : undefined,
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
      if (detection?.provider !== "youtube") return;
      if (!streamActive) {
        // Antes: pausar sin captura activa no hacía NADA (silencio total).
        // Ahora avisamos para que el usuario sepa qué le falta.
        setPauseHint(t("pauseHintNoCapture"));
        return;
      }
      setPauseHint(null);
      if (!autoAnalyze) return;
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

  useEffect(() => {
    ytGetCurrentTimeRef.current = ytGetCurrentTime;
  }, [ytGetCurrentTime]);

  // ── Direct canvas capture engine (MP4 / HLS / uploaded) ───────────────────

  const getDirectVideoElement = useCallback(
    () => directVideoRef.current,
    []
  );

  const onDirectCapture = useCallback(
    (dataUrl: string) => {
      if (!detection) return;
      const ts =
        lastPresentedFrameRef.current?.mediaTime ??
        directVideoRef.current?.currentTime ??
        0;
      const frameId = crypto.randomUUID();
      const sessionId = `preanalysis:${crypto.randomUUID()}`;
      const identity = { sessionId, frameId, mediaTime: ts };
      void onRequestAnalysis(
        dataUrl,
        {
          ...buildMeta(ts, true),
          mediaTime: ts,
          frameId,
          analysisSessionId: sessionId,
          analysisTrigger: "preanalysis",
        },
        identity
      );
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

  // Bucle por FRAME RENDERIZADO (requestVideoFrameCallback): cada frame del
  // vídeo pasa por el pipeline local; el scheduler del engine (diff de escena
  // + min/max interval) se evalúa como mucho cada FRAME_CHECK_INTERVAL_MS —
  // el diff dibuja un thumbnail y no hace falta pagarlo 60 veces/s.
  const lastSchedulerTickRef = useRef(0);
  const frameLoop = useVideoFrameLoop({
    enabled:
      VIDEO_PREANALYSIS_ENABLED &&
      autoCaptureMode &&
      !!(detection?.canCaptureFrameDirectly),
    getVideoElement: getDirectVideoElement,
    onFrame: (frame) => {
      lastPresentedFrameRef.current = {
        mediaTime: frame.mediaTime,
        presentedAt: frame.now,
        presentedFrames: frame.presentedFrames,
        width: frame.width,
        height: frame.height,
      };
      const now = performance.now();
      if (now - lastSchedulerTickRef.current < FRAME_CHECK_INTERVAL_MS) return;
      lastSchedulerTickRef.current = now;
      directEngine.captureAuto();
    },
  });

  const publishPauseMetrics = useCallback(
    (next: PausePerformanceMetrics) => {
      setPauseMetrics(next);
      onMetricsChange?.(next);
    },
    [onMetricsChange]
  );

  const logPauseCapture = useCallback(
    (debug: PauseCaptureDebug, identity: AnalysisIdentity) => {
      const payload = { ...debug, analysisSessionId: identity.sessionId };
      console.debug("[pause2shop:pause-frame]", payload);
      addDirectLog({
        id: 0,
        ts: new Date().toLocaleTimeString("es-ES", { hour12: false }),
        type: "success",
        msg: `pause t=${debug.pauseEventCurrentTime.toFixed(3)} · presented=${debug.presentedFrameMediaTime?.toFixed(3) ?? "—"} · captured=${debug.capturedFrameTimestamp.toFixed(3)} · ${debug.captureStrategy}`,
      });
    },
    [addDirectLog]
  );

  // Pause handler exacto: no pasa por el guard `analyzing` del preanálisis.
  const handleDirectPause = useCallback(async () => {
    if (!autoAnalyze || !detection) return;
    const video = directVideoRef.current;
    if (!video) return;
    const pauseStartedAt = performance.now();
    const requestedTime = video.currentTime;
    pauseCaptureAbortRef.current?.abort();
    const abortController = new AbortController();
    pauseCaptureAbortRef.current = abortController;
    onPauseStart?.();
    setPausedDetections([]);
    setPauseHint(null);

    try {
      if (!exactCaptureRef.current) {
        exactCaptureRef.current = new ExactPausedFrameCapture(video);
        exactCaptureRef.current.start();
      }
      const sessionId = crypto.randomUUID();
      const { frame, debug } = await exactCaptureRef.current.capture({
        videoId: buildMeta(requestedTime).videoKey,
        requestedTime,
        pauseEventCurrentTime: requestedTime,
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) return;
      const dataUrl = await blobToDataUrl(frame.blob);
      const identity: AnalysisIdentity = {
        sessionId,
        frameId: frame.frameId,
        mediaTime: frame.mediaTime,
      };
      const meta: FrameMeta = {
        ...buildMeta(frame.mediaTime, true),
        timestampSeconds: frame.mediaTime,
        mediaTime: frame.mediaTime,
        frameId: frame.frameId,
        frameHash: frame.hash,
        analysisSessionId: sessionId,
        analysisTrigger: "pause",
        cacheKey: `${frame.videoId}:${frame.hash}:${frame.mediaTime.toFixed(3)}`,
      };
      const context = { dataUrl, meta, identity, pauseStartedAt };
      activePauseRef.current = context;
      setPausedFrame(context);
      onPausedFrameChange?.(context);

      const nearest = nearestAnalyzedFrame(
        preanalyzedFrames,
        frame.videoId,
        frame.mediaTime
      );
      const capturedAt = performance.now();
      const metrics: PausePerformanceMetrics = {
        ...EMPTY_PAUSE_METRICS,
        pauseToCaptureMs: capturedAt - pauseStartedAt,
        captureToDetectionMs: nearest ? capturedAt - pauseStartedAt : null,
        detectionCacheHit: Boolean(nearest),
      };
      if (nearest) setPausedDetections(nearest.detections);
      publishPauseMetrics(metrics);
      logPauseCapture(debug, identity);

      // Una caché cercana se pinta ya, pero el frame exacto se valida siempre
      // que exceda la tolerancia estricta de captura (80 ms).
      const exactCache = nearest && Math.abs(nearest.mediaTime - frame.mediaTime) <= 0.08;
      if (!exactCache) {
        await onRequestAnalysis(dataUrl, meta, identity);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      addDirectLog({
        id: 0,
        ts: new Date().toLocaleTimeString("es-ES", { hour12: false }),
        type: "error",
        msg: error instanceof Error ? error.message : "Error de captura exacta",
      });
    }
  }, [
    autoAnalyze,
    detection,
    buildMeta,
    preanalyzedFrames,
    onPauseStart,
    onPausedFrameChange,
    onRequestAnalysis,
    publishPauseMetrics,
    logPauseCapture,
    addDirectLog,
  ]);

  useEffect(() => {
    if (!selectedItemDetails) return;
    const id = window.setTimeout(() => {
      setPausedDetections((current) =>
        current.map((item) =>
          itemKey(item) === itemKey(selectedItemDetails) ? selectedItemDetails : item
        )
      );
    }, 0);
    return () => window.clearTimeout(id);
  }, [selectedItemDetails]);

  const handleDirectPlay = useCallback(() => {
    pauseCaptureAbortRef.current?.abort();
    activePauseRef.current = null;
    setPausedFrame(null);
    setPausedDetections([]);
    onPausedFrameChange?.(null);
  }, [onPausedFrameChange]);

  const handleDirectLoadedMetadata = useCallback((video: HTMLVideoElement) => {
    exactCaptureRef.current?.stop();
    exactCaptureRef.current = new ExactPausedFrameCapture(video);
    exactCaptureRef.current.start();
  }, []);

  // SEEK: al avanzar/retroceder se analiza INMEDIATAMENTE la nueva posición
  // (sin esperar al intervalo) y se resetea solo el diff de escena — el
  // catálogo acumulado de la sesión se conserva.
  const handleDirectSeeked = useCallback(() => {
    if (!detection) return;
    directEngine.resetDiff();
    const video = directVideoRef.current;
    // Si el seek termina pausado, `handleDirectPause` hará la captura exacta.
    if (video && !video.paused && (autoCaptureMode || autoAnalyze)) {
      directEngine.captureNow();
    }
  }, [detection, directEngine, autoCaptureMode, autoAnalyze]);

  // ── Reset on source change ─────────────────────────────────────────────────

  useEffect(() => {
    lastPausedTimestampRef.current = null;
    directEngine.resetDiff();
    pauseCaptureAbortRef.current?.abort();
    exactCaptureRef.current?.stop();
    exactCaptureRef.current = null;
    activePauseRef.current = null;
    // Diferido para no encadenar un render síncrono dentro del efecto.
    const id = setTimeout(() => {
      setPausedFrame(null);
      setPausedDetections([]);
      setDirectLogs([]);
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection]);

  // Solo una respuesta anclada a la sesión de pausa activa sustituye las
  // cajas cacheadas. Las actualizaciones de matching se fusionan por clave.
  useEffect(() => {
    const active = activePauseRef.current;
    if (!active) return;
    const id = window.setTimeout(() => {
      if (
        analysisIdentity &&
        responseMatchesActiveSession(analysisIdentity, active.identity) &&
        (overlayItems.length > 0 || !analyzing)
      ) {
        setPausedDetections(overlayItems);
        const next = {
          ...pauseMetrics,
          captureToDetectionMs:
            pauseMetrics.captureToDetectionMs ?? performance.now() - active.pauseStartedAt,
          totalMs: performance.now() - active.pauseStartedAt,
        };
        publishPauseMetrics(next);
        return;
      }
      if (pausedDetections.length > 0 && overlayItems.length > 0) {
        const updates = new Map(overlayItems.map((item) => [itemKey(item), item]));
        setPausedDetections((current) =>
          current.map((item) => updates.get(itemKey(item)) ?? item)
        );
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [
    analysisIdentity,
    analyzing,
    overlayItems,
    pauseMetrics,
    pausedDetections.length,
    publishPauseMetrics,
  ]);

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
    // Vídeo subido: el análisis arranca solo al pulsar play.
    setAutoCaptureMode(VIDEO_AUTO_ANALYSIS);
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
    ? t("tooltipActivateFirst")
    : analyzing || capturePhase === "analyzing_frame"
      ? t("tooltipAlreadyAnalyzing")
      : undefined;

  // "hace Xs" se calcula dentro de CaptureStatusBar con su propio tick para
  // no llamar Date.now() durante el render de este componente.

  // Combined debug log for the panel
  const combinedLog: DebugEntry[] =
    requiresScreenCapture ? screenLog : directLogs;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Tab selector — solo si el flujo de URLs está habilitado */}
      {ENABLE_VIDEO_URLS && (
        <div className="flex rounded-xl border border-line bg-white/[0.03] p-1">
          <TabButton active={videoInputMode === "url"} onClick={() => switchTab("url")}>
            {t("tabs.pasteLink")}
          </TabButton>
          <TabButton active={videoInputMode === "upload"} onClick={() => switchTab("upload")}>
            {t("tabs.uploadVideo")}
          </TabButton>
        </div>
      )}

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
          {/* Barra de estado de la fuente */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-sm">
            {provider === "uploaded_video" ? (
              <span className="text-ink">
                🎬 <span className="font-medium">{uploadedFile?.name ?? t("uploadedVideoDefaultName")}</span>
                <span className="ml-2 text-xs text-success">
                  {t("uploadedReadyNote")}
                </span>
              </span>
            ) : (
              <>
                <span className="font-medium text-ink">{t("providerDetectedLabel")}</span>
                <ProviderBadge provider={provider!} />
                <span className={canEmbed ? "text-success" : "text-ink-subtle"}>
                  {canEmbed ? t("embedCompatible") : t("notEmbeddable")}
                </span>
                {requiresScreenCapture && (
                  <span className="text-warning">{t("requiresScreenShare")}</span>
                )}
              </>
            )}
            <button
              onClick={() => {
                setDetection(null);
                setRawUrl("");
                setAutoCaptureMode(VIDEO_AUTO_ANALYSIS);
                if (uploadedFile) { URL.revokeObjectURL(uploadedFile.src); setUploadedFile(null); }
              }}
              className="ml-auto text-xs text-ink-subtle hover:text-ink"
            >
              {provider === "uploaded_video" ? t("changeVideo") : t("changeUrl")}
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
              lastFrameAt={lastFrameAt}
              intervalSeconds={intervalSeconds}
            />
          )}

          {/* YouTube warning */}
          {provider === "youtube" && !streamActive && (
            <div className="rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">
              <strong className="block mb-1">{t("youtubeWarning.title")}</strong>
              {t("youtubeWarning.body")}
              <ol className="mt-1.5 list-decimal list-inside space-y-0.5 text-warning/90">
                <li>{t.rich("youtubeWarning.step1", { b: (chunks) => <strong>{chunks}</strong> })}</li>
                <li>{t.rich("youtubeWarning.step2", { b: (chunks) => <strong>{chunks}</strong> })}</li>
                <li>{t("youtubeWarning.step3")}</li>
              </ol>
              <p className="mt-2 text-warning/70">
                {t.rich("youtubeWarning.footer", { b: (chunks) => <strong>{chunks}</strong> })}
              </p>
            </div>
          )}

          {/* Aviso al pausar sin captura activa (antes fallaba en silencio) */}
          {pauseHint && !streamActive && (
            <div className="rounded-xl border border-info/25 bg-info/10 px-4 py-3 text-xs leading-relaxed text-info">
              ⏸ {pauseHint}
            </div>
          )}

          {/* Other iframe providers */}
          {requiresScreenCapture && provider !== "youtube" && !streamActive && (
            <div className="rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning">
              {t.rich("crossOriginWarning", {
                provider: PROVIDER_LABELS[provider!],
                b: (chunks) => <strong>{chunks}</strong>,
              })}
              {captureError && <span className="mt-1 block text-danger">{captureError}</span>}
            </div>
          )}

          {/* Confirmación de captura directa: solo con el flujo de URLs activo
              (para vídeo subido es el comportamiento normal, no un tecnicismo) */}
          {ENABLE_VIDEO_URLS &&
            provider !== "uploaded_video" &&
            preferredCaptureMode === "direct_canvas" &&
            provider !== "unknown" && (
              <div className="rounded-xl border border-success/20 bg-success/10 px-4 py-2.5 text-xs text-success">
                <strong>{t("directCaptureActive")}</strong>{" "}
                {reason ?? t("directCaptureDefaultReason")}
              </div>
            )}

          {/* Player area */}
          {provider === "unknown" ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-danger/20 bg-danger/5 text-center">
              <span className="text-3xl">🚫</span>
              <p className="max-w-sm text-sm text-danger">{reason}</p>
              <p className="text-xs text-ink-subtle">
                {t.rich("unknownProviderHint", { b: (chunks) => <strong>{chunks}</strong> })}
              </p>
            </div>
          ) : provider === "youtube" ? (
            <YouTubeEmbed
              containerRef={ytContainerRef}
              status={ytStatus}
              analyzing={analyzing}
              overlayItems={overlayItems}
              onOverlayItemClick={onOverlayItemClick}
              selectedKey={selectedKey}
            />
          ) : canEmbed && !canCaptureFrame ? (
            <IframeEmbed
              embedUrl={embedUrl!}
              providerLabel={PROVIDER_LABELS[provider!]}
              analyzing={analyzing}
              overlayItems={overlayItems}
              onOverlayItemClick={onOverlayItemClick}
              selectedKey={selectedKey}
            />
          ) : (
            <DirectVideoPlayer
              src={directVideoSrc}
              analyzing={analyzing}
              videoRef={directVideoRef}
              onPause={handleDirectPause}
              onPlay={handleDirectPlay}
              onSeeked={handleDirectSeeked}
              onLoadedMetadata={handleDirectLoadedMetadata}
              pausedFrame={pausedFrame}
              pausedDetections={pausedDetections}
              detectionCacheHit={pauseMetrics.detectionCacheHit}
              onDetectionSelect={(item) => {
                const context = activePauseRef.current;
                if (!context) return;
                onOverlayItemClick?.(item);
                onDetectionSelect?.(item, context);
              }}
              selectedKey={selectedKey}
            />
          )}

          {/* Hidden video for screen stream */}
          <video ref={captureVideoRef} className="hidden" muted playsInline />

          {/* Controls — modo directo (vídeo subido/MP4): auto-análisis por
              defecto; el botón manual queda relegado a un menú técnico. */}
          {provider !== "unknown" && preferredCaptureMode === "direct_canvas" && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white/[0.03] p-4">
              <button
                onClick={() => setAutoCaptureMode((v) => !v)}
                className={
                  autoCaptureMode
                    ? "rounded-lg border border-line bg-white/5 px-4 py-2 text-xs font-semibold text-ink transition hover:bg-white/10"
                    : "rounded-lg bg-gradient-to-br from-success to-accent px-4 py-2 text-xs font-semibold text-white transition hover:brightness-110"
                }
              >
                {autoCaptureMode ? t("stopAnalysis") : t("resumeAnalysis")}
              </button>
              <span className="text-xs text-ink-muted">
                {autoCaptureMode
                  ? analyzing
                    ? t("detectingObjectsInline")
                    : t("analyzingRealtime")
                  : t("analysisPaused")}
              </span>
              <details className="ml-auto text-xs">
                <summary className="cursor-pointer select-none text-ink-subtle transition hover:text-ink-muted">
                  {t("technicalOptions")}
                </summary>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
                    <Toggle checked={autoAnalyze} onChange={setAutoAnalyze} />
                    {t("analyzeOnPause")}
                  </label>
                  <button
                    onClick={() => directEngine.captureNow()}
                    disabled={analyzing}
                    className="rounded-lg border border-line bg-white/5 px-3 py-1.5 font-medium text-ink transition hover:bg-white/10 disabled:opacity-40"
                  >
                    {t("forceAnalyzeFrame")}
                  </button>
                </div>
              </details>
            </div>
          )}

          {/* Controls — modo captura de pantalla (solo con URLs habilitadas) */}
          {provider !== "unknown" && requiresScreenCapture && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white/[0.03] p-4">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
                <Toggle checked={autoAnalyze} onChange={setAutoAnalyze} />
                {t("analyzeOnPause")}
              </label>

              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
                <Toggle checked={autoCaptureMode} onChange={setAutoCaptureMode} color="emerald" />
                <span>
                  {t("autoCapture")}
                  {autoCaptureMode && (
                    <span className="ml-1 text-xs text-success">
                      {t("autoCaptureInterval", { seconds: intervalSeconds })}
                    </span>
                  )}
                </span>
              </label>

              {autoCaptureMode && (
                <select
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                  className="rounded-lg border border-line bg-white/5 px-2 py-1 text-xs text-ink outline-none"
                >
                  {[2, 3, 5, 10, 15, 30].map((s) => (
                    <option key={s} value={s}>{s}s</option>
                  ))}
                </select>
              )}

              {/* Action buttons */}
              <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:ml-auto">
                {requiresScreenCapture && (
                  <>
                    {!streamActive ? (
                      <button
                        onClick={startCapture}
                        disabled={capturePhase === "requesting_permission"}
                        className="rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-40"
                      >
                        {capturePhase === "requesting_permission"
                          ? t("phase.requestingPermission")
                          : t("activateScreenCapture")}
                      </button>
                    ) : (
                      <button
                        onClick={stopCapture}
                        className="rounded-lg border border-line bg-transparent px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:bg-white/10"
                      >
                        {t("stopCapture")}
                      </button>
                    )}

                    <div className="relative group">
                      <button
                        onClick={() => void captureAndAnalyzeNow()}
                        disabled={analyzeNowDisabled}
                        className="rounded-lg bg-gradient-to-br from-brand to-magenta px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                      >
                        {t("analyzeScreenshot")}
                      </button>
                      {analyzeNowTooltip && (
                        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-canvas-raised px-3 py-1.5 text-[11px] text-ink-muted opacity-0 transition group-hover:opacity-100">
                          {analyzeNowTooltip}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Indicador de análisis continuo NO bloqueante con contadores en vivo */}
          {(isLooping || (autoCaptureMode && preferredCaptureMode === "direct_canvas")) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-success/20 bg-success/10 px-4 py-2.5 text-xs text-success">
              <span className="flex items-center gap-2 font-medium">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                {t("realtimeIndicator")}
              </span>
              {preferredCaptureMode === "direct_canvas" ? (
                <span className="text-success/80">
                  {t("frameCounter", { count: format.number(frameLoop.processedFrameCount) })}
                  {frameLoop.fps > 0 && ` ${t("fpsSuffix", { fps: frameLoop.fps })}`}
                  {analysisStats && (
                    <>
                      {analysisStats.persons > 0 &&
                        ` · ${t("statsPersons", { count: analysisStats.persons })}`}
                      {" · "}
                      {t("statsTracked", { count: analysisStats.trackedObjects })}
                      {" · "}
                      {t("statsUnique", { count: analysisStats.uniqueProducts })}
                      {analysisStats.matchedProducts > 0 &&
                        ` · ${t("statsMatched", { count: analysisStats.matchedProducts })}`}
                    </>
                  )}
                </span>
              ) : (
                <span className="text-success/80">
                  {t("intervalOnlyNewFrames", { seconds: intervalSeconds })}
                </span>
              )}
            </div>
          )}

          {provider === "youtube" && streamActive && (
            <p className="text-center text-[11px] text-ink-faint">
              {t("currentPosition", { timestamp: formatTimestamp(ytGetCurrentTime()) })}
            </p>
          )}

          {/* Debug panel (oculto en modo presentación) */}
          {!IS_PRESENTATION && (
          <DebugPanel
            visible={showDebug}
            onToggle={() => setShowDebug((v) => !v)}
            entries={combinedLog}
            onClear={requiresScreenCapture ? clearScreenLog : () => setDirectLogs([])}
            frameCount={requiresScreenCapture ? frameCount : 0}
            analyzedCount={requiresScreenCapture ? analyzedCount : 0}
            skippedCount={requiresScreenCapture ? skippedCount : 0}
          />
          )}
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
          ? "bg-gradient-to-br from-brand to-magenta text-white shadow-lg shadow-brand/20"
          : "text-ink-muted hover:text-ink")
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
      ? "peer-checked:bg-success"
      : "peer-checked:bg-brand"
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
  const t = useTranslations("studio.videoAnalyzer");
  const tStudio = useTranslations("studio");
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line bg-white/[0.02]">
      <span className="text-4xl">📺</span>
      <div className="text-center">
        <p className="text-sm font-medium text-ink">{t("urlPanel.title")}</p>
        <p className="mt-1 text-xs text-ink-subtle">
          {t("urlPanel.subtitle")}
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-2 px-6">
        <input
          value={rawUrl}
          onChange={(e) => onChangeUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onLoad()}
          placeholder="https://www.youtube.com/watch?v=..."
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-brand-bright/60 focus:bg-white/10"
        />
        <button
          onClick={onLoad}
          disabled={!rawUrl.trim()}
          className="rounded-xl bg-gradient-to-br from-brand to-magenta py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {tStudio("urlInput.submit")}
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
  const t = useTranslations("studio.videoAnalyzer");
  const tStudio = useTranslations("studio");
  return (
    <label
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={
        "flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed text-center transition " +
        (isDragging
          ? "border-brand-bright/60 bg-brand/10 scale-[1.01]"
          : "border-white/15 bg-white/[0.03] hover:border-brand-bright/40 hover:bg-white/[0.05]")
      }
    >
      <span className="text-4xl">{isDragging ? "⬇️" : "🎬"}</span>
      <div>
        <p className="text-sm font-medium text-ink">
          {isDragging ? t("upload.dropHint") : t("upload.uploadHint")}
        </p>
        <p className="mt-1 text-xs text-ink-subtle">
          {t("upload.formatsHint")}
        </p>
      </div>
      <span className="rounded-xl border border-line bg-white/5 px-4 py-2 text-xs font-medium text-ink-muted transition hover:bg-white/10">
        {tStudio("selectFile")}
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
    youtube: "bg-danger/15 text-danger border-danger/30",
    dailymotion: "bg-info/15 text-info border-info/30",
    vimeo: "bg-info/15 text-info border-info/30",
    direct_mp4: "bg-success/15 text-success border-success/30",
    hls: "bg-brand/15 text-brand-bright border-brand/30",
    uploaded_video: "bg-accent/15 text-accent border-accent/30",
    unknown: "bg-ink-subtle/15 text-ink-muted border-ink-subtle/30",
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
  lastFrameAt,
  intervalSeconds,
}: {
  phase: CapturePhase;
  streamActive: boolean;
  isLooping: boolean;
  frameCount: number;
  analyzedCount: number;
  skippedCount: number;
  lastFrameAt: number | null;
  intervalSeconds: number;
}) {
  // Tick local de 1s para refrescar el "hace Xs" sin usar Date.now() en el
  // render del componente padre.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (lastFrameAt == null) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastFrameAt]);
  const secondsAgo =
    lastFrameAt != null ? Math.max(0, Math.round((nowTick - lastFrameAt) / 1000)) : null;
  const dot =
    ["capture_active", "waiting_next_interval", "analyzing_frame", "capturing_frame"].includes(phase)
      ? "animate-pulse"
      : "";
  const t = useTranslations("studio.videoAnalyzer");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-line bg-white/[0.03] px-4 py-2.5 text-xs">
      <span className={`flex items-center gap-1.5 font-medium ${PHASE_COLOR[phase]}`}>
        <span className={`h-1.5 w-1.5 rounded-full bg-current ${dot}`} />
        {t(PHASE_LABEL_KEY[phase])}
      </span>
      {streamActive && (
        <>
          {secondsAgo !== null && (
            <span className="text-ink-subtle">{t("status.lastFrame", { seconds: secondsAgo })}</span>
          )}
          {isLooping && (
            <span className="text-ink-subtle">{t("status.intervalLabel", { seconds: intervalSeconds })}</span>
          )}
          {frameCount > 0 && (
            <span className="text-ink-subtle">
              {t("status.captured")} <span className="text-ink-muted">{frameCount}</span>
              {" · "}{t("status.analyzed")} <span className="text-success">{analyzedCount}</span>
              {skippedCount > 0 && (
                <>{" · "}{t("status.skipped")} <span className="text-ink-muted">{skippedCount}</span></>
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
  const t = useTranslations("studio.videoAnalyzer");
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] text-xs">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-ink-muted hover:text-ink"
      >
        <span className="font-medium">
          {t("debugTitle")}
          {entries.length > 0 && (
            <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-ink-muted">
              {entries.length}
            </span>
          )}
        </span>
        <span className="text-ink-faint">{visible ? "▲" : "▼"}</span>
      </button>

      {visible && (
        <div className="border-t border-line">
          {frameCount > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-2 text-ink-subtle">
              <span>
                {t("debugFramesSummary", { frameCount, analyzedCount, skippedCount })}
              </span>
              {entries.length > 0 && (
                <button onClick={onClear} className="text-ink-faint transition hover:text-ink-muted">
                  {t("debugClear")}
                </button>
              )}
            </div>
          )}
          <div className="max-h-52 overflow-y-auto px-4 pb-3 font-mono">
            {entries.length === 0 ? (
              <p className="py-2 text-ink-faint">{t("debugNoEvents")}</p>
            ) : (
              entries.map((entry, i) => (
                <div key={i} className="py-[3px] leading-tight">
                  <span className="text-ink-faint">
                    {new Date(entry.time).toLocaleTimeString("es", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>{" "}
                  <span
                    className={
                      entry.msg.includes("error") || entry.msg.includes("Error")
                        ? "text-danger"
                        : entry.msg.includes("saltado") || entry.msg.includes("forzado")
                          ? "text-warning"
                          : entry.msg.includes("✓") || entry.msg.includes("activ") || entry.msg.includes("capturado")
                            ? "text-success"
                            : "text-ink-muted"
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
  selectedKey,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  status: string;
  analyzing: boolean;
  overlayItems: DetectedItem[];
  onOverlayItemClick?: (item: DetectedItem) => void;
  selectedKey?: string | null;
}) {
  const t = useTranslations("studio.videoAnalyzer");
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-black shadow-2xl shadow-black/50">
      <div className="aspect-video w-full">
        <div ref={containerRef} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />
      </div>
      <VideoOverlay items={overlayItems} onItemClick={onOverlayItemClick} selectedKey={selectedKey} />
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-ink-muted">
          {t("loadingPlayer")}
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
  selectedKey,
}: {
  embedUrl: string;
  providerLabel: string;
  analyzing: boolean;
  overlayItems: DetectedItem[];
  onOverlayItemClick?: (item: DetectedItem) => void;
  selectedKey?: string | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-black shadow-2xl shadow-black/50">
      <div className="aspect-video w-full">
        <iframe
          src={embedUrl}
          title={providerLabel}
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture"
          className="h-full w-full"
        />
      </div>
      <VideoOverlay items={overlayItems} onItemClick={onOverlayItemClick} selectedKey={selectedKey} />
      {analyzing && <AnalyzingOverlay />}
    </div>
  );
}

function DirectVideoPlayer({
  src,
  analyzing,
  videoRef,
  onPause,
  onPlay,
  onSeeked,
  onLoadedMetadata,
  pausedFrame,
  pausedDetections,
  detectionCacheHit,
  onDetectionSelect,
  selectedKey,
}: {
  src: string;
  analyzing: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onPause: () => void;
  onPlay: () => void;
  onSeeked?: () => void;
  onLoadedMetadata: (video: HTMLVideoElement) => void;
  pausedFrame: PausedFrameContext | null;
  pausedDetections: DetectedItem[];
  detectionCacheHit: boolean;
  onDetectionSelect: (item: DetectedItem) => void;
  selectedKey?: string | null;
}) {
  // Relación de aspecto REAL del vídeo (letterboxing correcto en el overlay).
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  return (
    <PausedFrameExperience
      frozenFrameUrl={pausedFrame?.dataUrl ?? null}
      mediaTime={pausedFrame?.identity.mediaTime ?? null}
      mediaAspect={videoAspect}
      detections={pausedDetections}
      detecting={analyzing}
      cacheHit={detectionCacheHit}
      selectedKey={selectedKey}
      onSelect={onDetectionSelect}
    >
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        onPause={onPause}
        onPlay={onPlay}
        onSeeked={onSeeked}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight);
          onLoadedMetadata(v);
        }}
        crossOrigin="anonymous"
        className="aspect-video w-full object-contain"
      />
      {analyzing && !pausedFrame ? <AnalyzingOverlay /> : null}
    </PausedFrameExperience>
  );
}

/**
 * Indicador de detección en curso NO bloqueante: una píldora compacta en la
 * esquina. El vídeo sigue visible y reproduciéndose — nunca se oscurece ni se
 * desenfoca la escena durante el análisis.
 */
function AnalyzingOverlay() {
  const t = useTranslations("studio.videoAnalyzer");
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20">
      <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-bright" />
        {t("detectingObjectsOverlay")}
      </div>
    </div>
  );
}
