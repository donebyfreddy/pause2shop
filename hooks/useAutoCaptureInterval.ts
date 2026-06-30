"use client";

import { useEffect, useRef } from "react";

type Options = {
  /** Whether the interval is active. */
  enabled: boolean;
  /** Milliseconds between captures. */
  intervalMs: number;
  /** Called on each interval tick. Must be stable or wrapped in useCallback. */
  onCapture: () => void;
};

/**
 * Fires onCapture every intervalMs milliseconds while enabled.
 * The callback ref is updated on every render so callers don't need
 * to worry about stale closures.
 */
export function useAutoCaptureInterval({ enabled, intervalMs, onCapture }: Options) {
  const callbackRef = useRef(onCapture);
  callbackRef.current = onCapture;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
