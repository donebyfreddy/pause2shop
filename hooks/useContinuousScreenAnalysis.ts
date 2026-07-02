"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureFrameDataUrl } from "@/lib/frameCapture";

// ─── Configurable constants (overridable via env) ───────────────────────────

const DIFF_W = 64;
const DIFF_H = 36;
const DEFAULT_THRESHOLD =
  Number(process.env.NEXT_PUBLIC_FRAME_DIFF_THRESHOLD) || 0.08;
const DEFAULT_FORCE_EVERY_N =
  Number(process.env.NEXT_PUBLIC_FORCE_ANALYZE_EVERY_N_FRAMES) || 5;
const DEFAULT_TIMEOUT_MS =
  Number(process.env.NEXT_PUBLIC_FRAME_ANALYSIS_TIMEOUT_MS) || 20_000;
const MAX_FRAME_SEND_WIDTH = 1024;
const SEND_JPEG_QUALITY = 0.7;
const MAX_LOG_ENTRIES = 80;

// ─── Types ───────────────────────────────────────────────────────────────────

export type CapturePhase =
  | "idle"
  | "requesting_permission"
  | "capture_active"
  | "capturing_frame"
  | "analyzing_frame"
  | "waiting_next_interval"
  | "skipped_similar_frame"
  | "skipped_busy"
  | "error"
  | "stopped";

export type DebugEntry = {
  time: number;
  msg: string;
};

type HookState = {
  phase: CapturePhase;
  error: string | null;
  frameCount: number;
  analyzedCount: number;
  skippedCount: number;
  lastFrameAt: number | null;
  debugLog: DebugEntry[];
};

export type UseContinuousScreenAnalysis = HookState & {
  /** True when a MediaStream is active (capture started). */
  streamActive: boolean;
  /** True when the auto-capture loop is running. */
  isLooping: boolean;
  captureVideoRef: React.RefObject<HTMLVideoElement | null>;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  /** Capture + analyze a single frame immediately (for the manual button). */
  captureAndAnalyzeNow: () => Promise<void>;
  clearLog: () => void;
};

type Options = {
  /** Whether the continuous loop should be running. */
  loopEnabled: boolean;
  /** Milliseconds between captures. */
  intervalMs: number;
  frameDiffThreshold?: number;
  forceAnalyzeEveryN?: number;
  analysisTimeoutMs?: number;
  /**
   * Called with a JPEG data URL for each frame that passes diff+concurrency
   * checks. Await it — the loop will not fire the next tick until it resolves.
   */
  onAnalyze: (dataUrl: string) => Promise<void>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function captureSmallFrame(video: HTMLVideoElement): ImageData | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.createElement("canvas");
  canvas.width = DIFF_W;
  canvas.height = DIFF_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, DIFF_W, DIFF_H);
  try {
    return ctx.getImageData(0, 0, DIFF_W, DIFF_H);
  } catch {
    // Cross-origin canvas taint — can't read pixels.
    return null;
  }
}

function computeFrameDiff(a: ImageData | null, b: ImageData | null): number {
  if (!a || !b || a.data.length !== b.data.length) return 1.0;
  let sum = 0;
  const len = b.data.length;
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs(b.data[i] - a.data[i]) / 255;
    const dg = Math.abs(b.data[i + 1] - a.data[i + 1]) / 255;
    const db = Math.abs(b.data[i + 2] - a.data[i + 2]) / 255;
    sum += (dr + dg + db) / 3;
  }
  return sum / (len / 4);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

const INITIAL_STATE: HookState = {
  phase: "idle",
  error: null,
  frameCount: 0,
  analyzedCount: 0,
  skippedCount: 0,
  lastFrameAt: null,
  debugLog: [],
};

export function useContinuousScreenAnalysis({
  loopEnabled,
  intervalMs,
  frameDiffThreshold = DEFAULT_THRESHOLD,
  forceAnalyzeEveryN = DEFAULT_FORCE_EVERY_N,
  analysisTimeoutMs = DEFAULT_TIMEOUT_MS,
  onAnalyze,
}: Options): UseContinuousScreenAnalysis {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<HookState>(INITIAL_STATE);
  const [streamActive, setStreamActive] = useState(false);

  // Always-fresh refs so the loop never closes over stale values.
  const onAnalyzeRef = useRef(onAnalyze);
  useEffect(() => { onAnalyzeRef.current = onAnalyze; });

  const intervalRef = useRef(intervalMs);
  useEffect(() => { intervalRef.current = intervalMs; });

  const thresholdRef = useRef(frameDiffThreshold);
  useEffect(() => { thresholdRef.current = frameDiffThreshold; });

  const forceNRef = useRef(forceAnalyzeEveryN);
  useEffect(() => { forceNRef.current = forceAnalyzeEveryN; });

  const timeoutRef = useRef(analysisTimeoutMs);
  useEffect(() => { timeoutRef.current = analysisTimeoutMs; });

  // ── Logging ──────────────────────────────────────────────────────────────

  const addLog = useCallback((msg: string) => {
    setState((prev) => ({
      ...prev,
      debugLog: [
        { time: Date.now(), msg },
        ...prev.debugLog.slice(0, MAX_LOG_ENTRIES - 1),
      ],
    }));
  }, []);

  const clearLog = useCallback(() => {
    setState((prev) => ({ ...prev, debugLog: [] }));
  }, []);

  // ── Stream management ────────────────────────────────────────────────────

  const stopCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreamActive(false);
    setState((prev) => ({
      ...INITIAL_STATE,
      debugLog: prev.debugLog,
    }));
    addLog("Captura detenida");
  }, [addLog]);

  const startCapture = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      phase: "requesting_permission",
      error: null,
    }));
    addLog("Solicitando permiso de pantalla compartida…");

    if (!navigator?.mediaDevices?.getDisplayMedia) {
      setState((prev) => ({
        ...prev,
        phase: "error",
        error: "Tu navegador no soporta captura de pantalla.",
      }));
      addLog("Error: navegador sin soporte getDisplayMedia");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopCapture();
      });

      setStreamActive(true);
      setState((prev) => ({
        ...prev,
        phase: "capture_active",
        error: null,
      }));
      addLog("Permiso concedido — captura activa");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const msg =
        name === "NotAllowedError" || name === "SecurityError"
          ? "Permiso de captura denegado. Activa la captura y selecciona esta pestaña."
          : err instanceof Error
            ? err.message
            : "Error al iniciar la captura.";
      setState((prev) => ({ ...prev, phase: "error", error: msg }));
      addLog(`Error de permiso: ${msg}`);
    }
  }, [stopCapture, addLog]);

  // ── Manual single-frame capture ──────────────────────────────────────────

  const captureAndAnalyzeNow = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      addLog("Sin stream — activa la captura primero");
      return;
    }
    const dataUrl = captureFrameDataUrl(video, MAX_FRAME_SEND_WIDTH, SEND_JPEG_QUALITY);
    if (!dataUrl) {
      addLog("No se pudo capturar el frame (canvas vacío)");
      return;
    }
    setState((prev) => ({
      ...prev,
      phase: "analyzing_frame",
      frameCount: prev.frameCount + 1,
      lastFrameAt: Date.now(),
    }));
    addLog("Frame manual enviado a IA");
    try {
      await Promise.race([
        onAnalyzeRef.current(dataUrl),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), timeoutRef.current)
        ),
      ]);
      setState((prev) => ({
        ...prev,
        phase: "capture_active",
        analyzedCount: prev.analyzedCount + 1,
      }));
      addLog("Frame manual analizado ✓");
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === "timeout";
      addLog(
        isTimeout
          ? `Frame manual: timeout (${timeoutRef.current / 1000}s)`
          : `Frame manual: error — ${err instanceof Error ? err.message : String(err)}`
      );
      setState((prev) => ({ ...prev, phase: "capture_active" }));
    }
  }, [addLog]);

  // ── Continuous capture loop ───────────────────────────────────────────────
  // The loop runs only when `loopEnabled && streamActive`.
  // It depends only on those two flags; all other values are read via refs
  // so the effect never needs to restart mid-loop.

  const isLooping = loopEnabled && streamActive;

  useEffect(() => {
    if (!loopEnabled || !streamActive) return;

    let cancelled = false;
    let skipCount = 0;
    let frameNumber = 0;
    let prevSmallFrame: ImageData | null = null;

    addLog(`Loop iniciado — intervalo ${intervalRef.current / 1000}s`);

    async function loop() {
      while (!cancelled) {
        // Wait for the configured interval.
        await sleep(intervalRef.current);
        if (cancelled) break;

        frameNumber++;
        const video = videoRef.current;
        if (!video || !streamRef.current) {
          addLog("Loop: sin stream, esperando…");
          continue;
        }

        // ── Frame diff ──────────────────────────────────────────────────
        setState((prev) => ({
          ...prev,
          phase: "capturing_frame",
          lastFrameAt: Date.now(),
        }));

        const smallFrame = captureSmallFrame(video);
        const diff = computeFrameDiff(prevSmallFrame, smallFrame);
        const forceAnalyze = skipCount >= forceNRef.current;

        if (diff < thresholdRef.current && !forceAnalyze) {
          skipCount++;
          setState((prev) => ({
            ...prev,
            phase: "skipped_similar_frame",
            skippedCount: prev.skippedCount + 1,
            frameCount: prev.frameCount + 1,
          }));
          addLog(
            `Frame #${frameNumber} saltado: diff ${diff.toFixed(3)} < ${thresholdRef.current}`
          );
          continue;
        }

        if (forceAnalyze && diff < thresholdRef.current) {
          addLog(
            `Frame #${frameNumber} forzado: ${skipCount} skips seguidos (diff ${diff.toFixed(3)})`
          );
        }

        skipCount = 0;
        prevSmallFrame = smallFrame;

        // ── Full frame capture ───────────────────────────────────────────
        const dataUrl = captureFrameDataUrl(
          video,
          MAX_FRAME_SEND_WIDTH,
          SEND_JPEG_QUALITY
        );
        if (!dataUrl) {
          addLog(`Frame #${frameNumber}: canvas vacío, skip`);
          continue;
        }

        // ── Send to AI ───────────────────────────────────────────────────
        setState((prev) => ({
          ...prev,
          phase: "analyzing_frame",
          frameCount: prev.frameCount + 1,
          lastFrameAt: Date.now(),
        }));
        addLog(`Frame #${frameNumber} enviado a IA`);

        try {
          await Promise.race([
            onAnalyzeRef.current(dataUrl),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("timeout")),
                timeoutRef.current
              )
            ),
          ]);
          if (!cancelled) {
            setState((prev) => ({
              ...prev,
              phase: "waiting_next_interval",
              analyzedCount: prev.analyzedCount + 1,
            }));
            addLog(`Frame #${frameNumber} analizado ✓`);
          }
        } catch (err) {
          if (cancelled) break;
          const isTimeout = err instanceof Error && err.message === "timeout";
          addLog(
            isTimeout
              ? `Frame #${frameNumber}: timeout (${timeoutRef.current / 1000}s) — continuando loop`
              : `Frame #${frameNumber}: error — ${err instanceof Error ? err.message : String(err)}`
          );
          setState((prev) => ({ ...prev, phase: "capture_active" }));
        }
      }
    }

    void loop();

    return () => {
      cancelled = true;
      addLog("Loop detenido");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopEnabled, streamActive]);

  // Cleanup on unmount.
  useEffect(() => stopCapture, [stopCapture]);

  return {
    ...state,
    streamActive,
    isLooping,
    captureVideoRef: videoRef,
    startCapture,
    stopCapture,
    captureAndAnalyzeNow,
    clearLog,
  };
}
