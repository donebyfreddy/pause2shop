"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bucle por FRAME RENDERIZADO del vídeo vía requestVideoFrameCallback
 * (fallback a requestAnimationFrame en navegadores sin soporte).
 *
 * Cada frame presentado pasa por `onFrame` (tracking/scheduler local, barato);
 * la detección remota la decide el capture engine con sus umbrales. El estado
 * (contador/fps) se publica como máximo 2 veces/s para no re-renderizar la UI
 * 30-60 veces por segundo.
 *
 * "Procesar cada frame" ≠ llamar a OpenAI/Lens por frame: aquí solo corre el
 * pipeline local; las llamadas externas siguen gobernadas por diff+intervalos.
 */

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export type FrameLoopStats = {
  /** Frames renderizados que han pasado por el pipeline local. */
  processedFrameCount: number;
  /** FPS aproximados del bucle local. */
  fps: number;
  /** true si el navegador soporta requestVideoFrameCallback. */
  usingVideoFrameCallback: boolean;
};

type Options = {
  enabled: boolean;
  getVideoElement: () => HTMLVideoElement | null;
  /** Se ejecuta por cada frame presentado. Debe ser barato (<1ms típico). */
  onFrame: () => void;
};

export function useVideoFrameLoop({ enabled, getVideoElement, onFrame }: Options): FrameLoopStats {
  const [stats, setStats] = useState<FrameLoopStats>({
    processedFrameCount: 0,
    fps: 0,
    usingVideoFrameCallback: true,
  });

  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const getVideoRef = useRef(getVideoElement);
  useEffect(() => {
    getVideoRef.current = getVideoElement;
  }, [getVideoElement]);

  const loop = useCallback((signal: { stopped: boolean }) => {
    let frames = 0;
    let windowFrames = 0;
    let windowStart = performance.now();
    let usingRVFC = true;

    const publish = () => {
      const now = performance.now();
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        const fps = Math.round((windowFrames / elapsed) * 1000);
        windowFrames = 0;
        windowStart = now;
        setStats({
          processedFrameCount: frames,
          fps,
          usingVideoFrameCallback: usingRVFC,
        });
      }
    };

    const tick = () => {
      if (signal.stopped) return;
      const video = getVideoRef.current() as VideoWithRVFC | null;
      // PATRÓN OBLIGATORIO: el siguiente callback se registra SIEMPRE en
      // finally — ninguna excepción del cuerpo puede matar el loop, y el
      // loop sobrevive a pausas (se re-arma y espera el siguiente frame).
      try {
        if (video && !video.paused && !video.ended && video.videoWidth > 0) {
          frames++;
          windowFrames++;
          try {
            onFrameRef.current();
          } catch {
            // El pipeline local nunca debe tumbar el bucle de frames.
          }
          publish();
        }
      } finally {
        if (!signal.stopped) {
          if (video && typeof video.requestVideoFrameCallback === "function") {
            usingRVFC = true;
            video.requestVideoFrameCallback(tick);
          } else {
            usingRVFC = false;
            requestAnimationFrame(tick);
          }
        }
      }
    };

    tick();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const signal = { stopped: false };
    loop(signal);
    return () => {
      signal.stopped = true;
    };
  }, [enabled, loop]);

  return stats;
}
