"use client";

import { useCallback, useRef } from "react";
import { captureFrameDataUrl } from "@/lib/frameCapture";
import { computeFrameDiffFromVideo } from "@/lib/video/frameDiff";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaptureEngineMode = "screen_capture" | "direct_canvas";

export type EngineLogType = "info" | "warn" | "error" | "success";

export type EngineLogEvent = {
  id: number;
  ts: string;
  type: EngineLogType;
  msg: string;
};

// ---------------------------------------------------------------------------
// Constants (overridable via env vars)
// ---------------------------------------------------------------------------

const FRAME_DIFF_THRESHOLD = Number(
  process.env.NEXT_PUBLIC_FRAME_DIFF_THRESHOLD ?? "0.08",
);
const FORCE_EVERY_N = Number(
  process.env.NEXT_PUBLIC_FORCE_ANALYZE_EVERY_N_FRAMES ?? "5",
);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type Options = {
  captureMode: CaptureEngineMode;
  /**
   * Returns the active video element to capture from.
   * For screen_capture: the hidden video playing the screen stream.
   * For direct_canvas: the visible video element the user is watching.
   * Using a getter (not a ref) so it always reads the current DOM state.
   */
  getVideoElement: () => HTMLVideoElement | null;
  /** Whether the analysis API call is currently in-flight. */
  analyzing: boolean;
  /** Called when a frame passes all checks and is ready for analysis. */
  onCapture: (dataUrl: string) => void;
  /** Called with each debug event for the log panel. */
  onLog: (event: EngineLogEvent) => void;
};

export type VideoCaptureEngine = {
  /**
   * Respects the diff threshold and skips similar/paused frames.
   * Use for automatic interval-based capture.
   */
  captureAuto: () => void;
  /**
   * Always captures the current frame, ignoring the diff threshold.
   * Use for manual triggers and pause events.
   */
  captureNow: () => void;
  /** Resets diff state and frame counter. Call when changing video source. */
  resetDiff: () => void;
};

/**
 * Unified frame capture engine that supports both screen_capture (getDisplayMedia)
 * and direct_canvas (HTML video element) modes.
 *
 * Handles:
 * - Frame diff to skip visually identical frames
 * - Force-analyze every N frames to prevent indefinite skipping
 * - "Analyzing in-flight" guard to prevent concurrent API calls
 * - CORS/tainted-canvas detection with clear error logging
 */
export function useVideoCaptureEngine({
  captureMode,
  getVideoElement,
  analyzing,
  onCapture,
  onLog,
}: Options): VideoCaptureEngine {
  const prevPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const frameCountRef = useRef(0);
  const logIdRef = useRef(0);

  const log = useCallback(
    (type: EngineLogType, msg: string) => {
      onLog({
        id: ++logIdRef.current,
        ts: new Date().toLocaleTimeString("es-ES", { hour12: false }),
        type,
        msg,
      });
    },
    [onLog],
  );

  const doCapture = useCallback(
    (force: boolean): void => {
      const video = getVideoElement();

      if (!video) {
        if (force) log("warn", "Sin elemento de vídeo — no se puede capturar");
        return;
      }

      if (analyzing) {
        log("info", "Frame saltado: análisis anterior en curso");
        return;
      }

      // For direct canvas: skip auto-capture when video is not playing.
      if (captureMode === "direct_canvas" && !force) {
        if (video.paused || video.ended) {
          return; // silent skip — video not playing, auto-capture has nothing to do
        }
      }

      if (!video.videoWidth) {
        if (force) log("warn", "Frame saltado: el vídeo aún no tiene datos");
        return;
      }

      // ----- Frame diff check -----
      frameCountRef.current++;
      const shouldForce = force || frameCountRef.current % FORCE_EVERY_N === 0;

      if (!shouldForce) {
        const diffResult = computeFrameDiffFromVideo(video, prevPixelsRef.current);
        if (diffResult) {
          prevPixelsRef.current = diffResult.pixels;
          if (diffResult.diff < FRAME_DIFF_THRESHOLD) {
            log(
              "info",
              `Frame saltado: escena similar (diff=${(diffResult.diff * 100).toFixed(1)}%)`,
            );
            return;
          }
        }
      } else {
        // Still update prevPixels on forced captures.
        const diffResult = computeFrameDiffFromVideo(video, prevPixelsRef.current);
        if (diffResult) prevPixelsRef.current = diffResult.pixels;
      }

      // ----- Capture -----
      const dataUrl = captureFrameDataUrl(video);
      if (!dataUrl) {
        log(
          "error",
          captureMode === "direct_canvas"
            ? "Error al capturar canvas (posible restricción CORS — prueba captura de pantalla)"
            : "Error al capturar frame del stream de pantalla",
        );
        return;
      }

      const src = captureMode === "screen_capture" ? "stream de pantalla" : "canvas directo";
      const tag = shouldForce && !force ? " (forzado)" : "";
      log("success", `Frame capturado desde ${src}${tag} — enviando a IA`);

      onCapture(dataUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [captureMode, getVideoElement, analyzing, onCapture, log],
  );

  const captureAuto = useCallback(() => doCapture(false), [doCapture]);
  const captureNow = useCallback(() => doCapture(true), [doCapture]);

  const resetDiff = useCallback(() => {
    prevPixelsRef.current = null;
    frameCountRef.current = 0;
  }, []);

  return { captureAuto, captureNow, resetDiff };
}
