"use client";

import { useCallback, useRef, useState } from "react";
import type { DetectedItem, FrameAnalysis, VideoAnalysisConfig } from "@/lib/types";
import { serializeConfig } from "@/lib/analysis/categories";
import type {
  AnalyzeFrameApiResponse,
  FrameMeta,
  PersistenceStatus,
  SavedCatalogItem,
} from "@/lib/api/types";

type CachedResult = {
  analysis: FrameAnalysis;
  savedItems: SavedCatalogItem[];
  videoId: string | null;
  persisted: boolean;
  persistence: PersistenceStatus | null;
  mock: boolean;
};

export type AnalysisState = {
  loading: boolean;
  /** true mientras llegan items por streaming (ya hay análisis parcial visible). */
  streaming: boolean;
  error: string | null;
  warning: string | null;
  analysis: FrameAnalysis | null;
  mock: boolean;
  persisted: boolean;
  persistence: PersistenceStatus | null;
  videoId: string | null;
  savedItems: SavedCatalogItem[];
  frameDataUrl: string | null;
  timings: Record<string, number> | null;
};

/**
 * Resultado de analyze(): además del análisis de visión, los items YA
 * persistidos en el catálogo (con su id), para que el matching visual pueda
 * asociar crop y recomendaciones a la fila correcta.
 */
export type AnalyzeResult = {
  analysis: FrameAnalysis;
  savedItems: SavedCatalogItem[];
  videoId: string | null;
};

const ENDPOINT = "/api/vision/analyze-frame";
const STREAM_ENDPOINT = "/api/vision/analyze-frame-stream";

/** Streaming activado por defecto: el primer objeto aparece en segundos. */
const STREAMING_ENABLED = process.env.NEXT_PUBLIC_STREAM_DETECTION !== "false";

// Timeout duro del análisis. Sin él, un request colgado deja `loading`
// activo e `inFlight` tomado para siempre → ningún frame más se analiza.
const ANALYZE_TIMEOUT_MS = 90_000;

const initialState: AnalysisState = {
  loading: false,
  streaming: false,
  error: null,
  warning: null,
  analysis: null,
  mock: false,
  persisted: false,
  persistence: null,
  videoId: null,
  savedItems: [],
  frameDataUrl: null,
  timings: null,
};

type StreamEvent =
  | { type: "start" }
  | { type: "item"; item: DetectedItem; index: number }
  | { type: "analysis"; analysis: FrameAnalysis; mock: boolean }
  | {
      type: "complete";
      mock: boolean;
      persisted: boolean;
      persistence?: PersistenceStatus;
      videoId: string | null;
      frameId: string | null;
      items: SavedCatalogItem[];
      warning?: string;
      timings?: Record<string, number>;
    }
  | { type: "error"; error: string };

function buildRequestBody(
  frameDataUrl: string,
  meta?: FrameMeta,
  config?: VideoAnalysisConfig
): string {
  return JSON.stringify({
    image: frameDataUrl,
    sourceType: meta?.sourceType,
    videoKey: meta?.videoKey,
    videoUrl: meta?.videoUrl,
    videoTitle: meta?.videoTitle,
    timestampSeconds: meta?.timestampSeconds ?? 0,
    analysisConfig: config ? serializeConfig(config) : undefined,
  });
}

/**
 * Envía un frame capturado (JPEG data URL) al backend. Por defecto usa el
 * endpoint de STREAMING: cada objeto detectado se pinta en cuanto el modelo
 * lo genera (time-to-first-item ~4-8s), y la persistencia llega al final.
 * Si el stream falla, cae automáticamente al endpoint clásico.
 */
export function useFrameAnalysis() {
  const [state, setState] = useState<AnalysisState>(initialState);

  const inFlight = useRef(false);
  const cache = useRef(new Map<string, CachedResult>());

  const runClassic = useCallback(
    async (
      frameDataUrl: string,
      meta?: FrameMeta,
      config?: VideoAnalysisConfig
    ): Promise<AnalyzeResult | null> => {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
        headers: { "Content-Type": "application/json" },
        body: buildRequestBody(frameDataUrl, meta, config),
      });
      const data = (await res.json()) as AnalyzeFrameApiResponse;
      if (!data.ok) {
        setState((s) => ({ ...s, loading: false, streaming: false, error: data.error }));
        return null;
      }
      setState({
        loading: false,
        streaming: false,
        error: null,
        warning: data.warning ?? null,
        analysis: data.analysis,
        mock: data.mock,
        persisted: data.persisted,
        persistence: data.persistence ?? null,
        videoId: data.videoId,
        savedItems: data.items,
        frameDataUrl,
        timings: data.timings ?? null,
      });
      return { analysis: data.analysis, savedItems: data.items, videoId: data.videoId };
    },
    []
  );

  const runStreaming = useCallback(
    async (
      frameDataUrl: string,
      meta?: FrameMeta,
      config?: VideoAnalysisConfig
    ): Promise<AnalyzeResult | null> => {
      const res = await fetch(STREAM_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
        headers: { "Content-Type": "application/json" },
        body: buildRequestBody(frameDataUrl, meta, config),
      });
      if (!res.ok || !res.body) {
        // Endpoint no disponible o error temprano → intentar la vía clásica.
        return runClassic(frameDataUrl, meta, config);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalAnalysis: FrameAnalysis | null = null;
      let finalSavedItems: SavedCatalogItem[] = [];
      let finalVideoId: string | null = null;
      const partialItems: DetectedItem[] = [];

      const handle = (event: StreamEvent) => {
        switch (event.type) {
          case "item":
            partialItems.push(event.item);
            setState((s) => ({
              ...s,
              streaming: true,
              analysis: {
                summary: s.analysis?.summary ?? "",
                style_vibe: s.analysis?.style_vibe ?? "",
                items: [...partialItems],
              },
            }));
            break;
          case "analysis":
            finalAnalysis = event.analysis;
            setState((s) => ({
              ...s,
              analysis: event.analysis,
              mock: event.mock,
            }));
            break;
          case "complete":
            finalSavedItems = event.items;
            finalVideoId = event.videoId;
            setState((s) => ({
              ...s,
              loading: false,
              streaming: false,
              warning: event.warning ?? null,
              persisted: event.persisted,
              persistence: event.persistence ?? null,
              videoId: event.videoId,
              savedItems: event.items,
              timings: event.timings ?? null,
            }));
            break;
          case "error":
            setState((s) => ({
              ...s,
              loading: false,
              streaming: false,
              error: event.error,
            }));
            break;
          default:
            break;
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handle(JSON.parse(line) as StreamEvent);
          } catch {
            // línea NDJSON corrupta: ignorar
          }
        }
      }
      return finalAnalysis
        ? { analysis: finalAnalysis, savedItems: finalSavedItems, videoId: finalVideoId }
        : null;
    },
    [runClassic]
  );

  const analyze = useCallback(
    async (
      frameDataUrl: string,
      meta?: FrameMeta,
      config?: VideoAnalysisConfig
    ): Promise<AnalyzeResult | null> => {
      if (inFlight.current) return null;

      const cacheKey = meta?.cacheKey;
      if (cacheKey && cache.current.has(cacheKey)) {
        const cached = cache.current.get(cacheKey)!;
        setState({
          ...initialState,
          analysis: cached.analysis,
          mock: cached.mock,
          persisted: cached.persisted,
          persistence: cached.persistence,
          videoId: cached.videoId,
          savedItems: cached.savedItems,
          frameDataUrl,
        });
        return {
          analysis: cached.analysis,
          savedItems: cached.savedItems,
          videoId: cached.videoId,
        };
      }

      inFlight.current = true;
      setState((s) => ({
        ...s,
        loading: true,
        streaming: false,
        error: null,
        warning: null,
        analysis: null,
        frameDataUrl,
      }));

      try {
        const result = STREAMING_ENABLED
          ? await runStreaming(frameDataUrl, meta, config)
          : await runClassic(frameDataUrl, meta, config);
        if (result && cacheKey) {
          // Cachea el resultado final con el estado ya asentado.
          setState((s) => {
            cache.current.set(cacheKey, {
              analysis: result.analysis,
              savedItems: result.savedItems,
              videoId: result.videoId,
              persisted: s.persisted,
              persistence: s.persistence,
              mock: s.mock,
            });
            return s;
          });
        }
        return result;
      } catch (err) {
        const isTimeout =
          err instanceof Error &&
          (err.name === "TimeoutError" || err.name === "AbortError");
        let message = err instanceof Error ? err.message : "Error de red.";
        if (isTimeout) {
          message = "El análisis tardó demasiado y se canceló. Vuelve a intentarlo.";
        }
        setState((s) => ({ ...s, loading: false, streaming: false, error: message }));
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [runClassic, runStreaming]
  );

  const reset = useCallback(() => setState(initialState), []);

  return { ...state, analyze, reset };
}
