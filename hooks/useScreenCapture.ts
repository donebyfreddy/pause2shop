"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureFrameDataUrl } from "@/lib/frameCapture";

export type CaptureStatus =
  | "idle"
  | "active"
  | "denied"
  | "needs-selection"
  | "error";

export type UseScreenCapture = {
  status: CaptureStatus;
  isActive: boolean;
  error: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  captureFrame: () => string | null;
};

/**
 * Wraps getDisplayMedia. The MediaStream is painted into a hidden <video>
 * (videoRef) that the caller must render so frames can be drawn to canvas.
 */
export function useScreenCapture(): UseScreenCapture {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const stopCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
  }, []);

  const startCapture = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      setStatus("error");
      setError("Tu navegador no soporta la captura de pantalla.");
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

      // Detect when the user stops sharing via the browser UI.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopCapture();
      });

      setStatus("active");
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
        setError("Permiso de captura denegado.");
      } else {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Error al iniciar la captura.");
      }
    }
  }, [stopCapture]);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      setStatus((s) => (s === "active" ? "needs-selection" : s));
      return null;
    }
    return captureFrameDataUrl(video);
  }, []);

  useEffect(() => stopCapture, [stopCapture]);

  return {
    status,
    isActive: status === "active",
    error,
    videoRef,
    startCapture,
    stopCapture,
    captureFrame,
  };
}
