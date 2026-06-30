"use client";

import { useCallback, useRef, useState } from "react";
import type { FrameAnalysis } from "@/lib/types";
import type {
  AnalyzeFrameApiResponse,
  FrameMeta,
  SavedCatalogItem,
} from "@/lib/api/types";

type CachedResult = {
  analysis: FrameAnalysis;
  savedItems: SavedCatalogItem[];
  videoId: string | null;
  persisted: boolean;
  mock: boolean;
};

export type AnalysisState = {
  loading: boolean;
  error: string | null;
  warning: string | null;
  analysis: FrameAnalysis | null;
  mock: boolean;
  persisted: boolean;
  videoId: string | null;
  savedItems: SavedCatalogItem[];
  frameDataUrl: string | null;
};

const MIN_INTERVAL_MS = 3000; // throttle: como máximo un análisis / 3s
const ENDPOINT = "/api/vision/analyze-frame";

const initialState: AnalysisState = {
  loading: false,
  error: null,
  warning: null,
  analysis: null,
  mock: false,
  persisted: false,
  videoId: null,
  savedItems: [],
  frameDataUrl: null,
};

/**
 * Envía un frame capturado (JPEG data URL) a /api/vision/analyze-frame.
 * El backend analiza, deduplica y guarda en el catálogo; aquí cacheamos por
 * cacheKey (videoKey + segundo) y aplicamos throttle.
 */
export function useFrameAnalysis() {
  const [state, setState] = useState<AnalysisState>(initialState);

  const inFlight = useRef(false);
  const lastCallAt = useRef(0);
  const cache = useRef(new Map<string, CachedResult>());

  const analyze = useCallback(
    async (
      frameDataUrl: string,
      meta?: FrameMeta
    ): Promise<FrameAnalysis | null> => {
      if (inFlight.current) return null;

      const cacheKey = meta?.cacheKey;
      if (cacheKey && cache.current.has(cacheKey)) {
        const cached = cache.current.get(cacheKey)!;
        setState({
          ...initialState,
          analysis: cached.analysis,
          mock: cached.mock,
          persisted: cached.persisted,
          videoId: cached.videoId,
          savedItems: cached.savedItems,
          frameDataUrl,
        });
        return cached.analysis;
      }

      const now = Date.now();
      if (now - lastCallAt.current < MIN_INTERVAL_MS) {
        setState((s) => ({
          ...s,
          error: "Espera un momento antes de analizar otro frame.",
        }));
        return null;
      }

      inFlight.current = true;
      lastCallAt.current = now;
      setState((s) => ({
        ...s,
        loading: true,
        error: null,
        warning: null,
        frameDataUrl,
      }));

      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: frameDataUrl,
            sourceType: meta?.sourceType,
            videoKey: meta?.videoKey,
            videoUrl: meta?.videoUrl,
            videoTitle: meta?.videoTitle,
            timestampSeconds: meta?.timestampSeconds ?? 0,
          }),
        });
        const data = (await res.json()) as AnalyzeFrameApiResponse;

        if (!data.ok) {
          setState((s) => ({ ...s, loading: false, error: data.error }));
          return null;
        }

        if (cacheKey) {
          cache.current.set(cacheKey, {
            analysis: data.analysis,
            savedItems: data.items,
            videoId: data.videoId,
            persisted: data.persisted,
            mock: data.mock,
          });
        }
        setState({
          loading: false,
          error: null,
          warning: data.warning ?? null,
          analysis: data.analysis,
          mock: data.mock,
          persisted: data.persisted,
          videoId: data.videoId,
          savedItems: data.items,
          frameDataUrl,
        });
        return data.analysis;
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Error de red.",
        }));
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    []
  );

  const reset = useCallback(() => setState(initialState), []);

  return { ...state, analyze, reset };
}
