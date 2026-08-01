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
import {
  responseMatchesActiveSession,
  type AnalysisIdentity,
} from "@/lib/video/pauseAnalysis";

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
  /** Detalle técnico del error (mensaje crudo del proveedor), para un panel plegable. */
  errorDetail: string | null;
  warning: string | null;
  analysis: FrameAnalysis | null;
  mock: boolean;
  persisted: boolean;
  persistence: PersistenceStatus | null;
  videoId: string | null;
  savedItems: SavedCatalogItem[];
  frameDataUrl: string | null;
  timings: Record<string, number> | null;
  /** Sesión/frame exactos a los que pertenece `analysis`. */
  identity: AnalysisIdentity | null;
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
  errorDetail: null,
  warning: null,
  analysis: null,
  mock: false,
  persisted: false,
  persistence: null,
  videoId: null,
  savedItems: [],
  frameDataUrl: null,
  timings: null,
  identity: null,
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
      analysisSessionId?: string;
      requestedFrameId?: string;
      mediaTime?: number;
    }
  | { type: "error"; error: string; errorDetail?: string };

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
    mediaTime: meta?.mediaTime ?? meta?.timestampSeconds ?? 0,
    frameId: meta?.frameId,
    frameHash: meta?.frameHash,
    analysisSessionId: meta?.analysisSessionId,
    analysisTrigger: meta?.analysisTrigger,
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

  const cache = useRef(new Map<string, CachedResult>());
  const activeRequest = useRef<{
    identity: AnalysisIdentity | null;
    controller: AbortController;
    version: number;
  } | null>(null);
  const versionRef = useRef(0);

  const isActive = useCallback((identity: AnalysisIdentity | null, version: number) => {
    const active = activeRequest.current;
    if (!active || active.version !== version || active.controller.signal.aborted) return false;
    if (!identity) return active.identity === null;
    return responseMatchesActiveSession(identity, active.identity);
  }, []);

  const runClassic = useCallback(
    async (
      frameDataUrl: string,
      meta?: FrameMeta,
      config?: VideoAnalysisConfig,
      signal?: AbortSignal,
      identity: AnalysisIdentity | null = null,
      version = 0
    ): Promise<AnalyzeResult | null> => {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: buildRequestBody(frameDataUrl, meta, config),
      });
      const data = (await res.json()) as AnalyzeFrameApiResponse;
      if (!isActive(identity, version)) return null;
      if (!data.ok) {
        setState((s) => ({
          ...s,
          loading: false,
          streaming: false,
          error: data.error,
          errorDetail: data.errorDetail ?? null,
        }));
        return null;
      }
      if (
        identity &&
        !responseMatchesActiveSession(
          {
            sessionId: data.analysisSessionId ?? "",
            frameId: data.requestedFrameId ?? "",
            mediaTime: data.mediaTime ?? Number.NaN,
          },
          identity
        )
      ) {
        return null;
      }
      setState({
        loading: false,
        streaming: false,
        error: null,
        errorDetail: null,
        warning: data.warning ?? null,
        analysis: data.analysis,
        mock: data.mock,
        persisted: data.persisted,
        persistence: data.persistence ?? null,
        videoId: data.videoId,
        savedItems: data.items,
        frameDataUrl,
        timings: data.timings ?? null,
        identity,
      });
      return { analysis: data.analysis, savedItems: data.items, videoId: data.videoId };
    },
    [isActive]
  );

  const runStreaming = useCallback(
    async (
      frameDataUrl: string,
      meta?: FrameMeta,
      config?: VideoAnalysisConfig,
      signal?: AbortSignal,
      identity: AnalysisIdentity | null = null,
      version = 0
    ): Promise<AnalyzeResult | null> => {
      const res = await fetch(STREAM_ENDPOINT, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: buildRequestBody(frameDataUrl, meta, config),
      });
      if (!res.ok || !res.body) {
        // Endpoint no disponible o error temprano → intentar la vía clásica.
        return runClassic(frameDataUrl, meta, config, signal, identity, version);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalAnalysis: FrameAnalysis | null = null;
      let finalSavedItems: SavedCatalogItem[] = [];
      let finalVideoId: string | null = null;
      const partialItems: DetectedItem[] = [];

      const handle = (event: StreamEvent) => {
        if (!isActive(identity, version)) return;
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
            if (
              identity &&
              !responseMatchesActiveSession(
                {
                  sessionId: event.analysisSessionId ?? "",
                  frameId: event.requestedFrameId ?? "",
                  mediaTime: event.mediaTime ?? Number.NaN,
                },
                identity
              )
            ) {
              return;
            }
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
              identity,
            }));
            break;
          case "error":
            setState((s) => ({
              ...s,
              loading: false,
              streaming: false,
              error: event.error,
              errorDetail: event.errorDetail ?? null,
            }));
            break;
          default:
            break;
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (!isActive(identity, version)) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
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
      return isActive(identity, version) && finalAnalysis
        ? { analysis: finalAnalysis, savedItems: finalSavedItems, videoId: finalVideoId }
        : null;
    },
    [isActive, runClassic]
  );

  const analyze = useCallback(
    async (
      frameDataUrl: string,
      meta?: FrameMeta,
      config?: VideoAnalysisConfig,
      identity: AnalysisIdentity | null = null
    ): Promise<AnalyzeResult | null> => {
      // Toda captura nueva invalida el trabajo anterior. En una pausa esto es
      // obligatorio; en preanálisis evita que un frame viejo gane la carrera.
      activeRequest.current?.controller.abort();
      const controller = new AbortController();
      const version = ++versionRef.current;
      activeRequest.current = { identity, controller, version };
      const timeout = window.setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

      const cacheKey = meta?.cacheKey;
      if (cacheKey && cache.current.has(cacheKey)) {
        const cached = cache.current.get(cacheKey)!;
        window.clearTimeout(timeout);
        setState({
          ...initialState,
          analysis: cached.analysis,
          mock: cached.mock,
          persisted: cached.persisted,
          persistence: cached.persistence,
          videoId: cached.videoId,
          savedItems: cached.savedItems,
          frameDataUrl,
          identity,
        });
        return {
          analysis: cached.analysis,
          savedItems: cached.savedItems,
          videoId: cached.videoId,
        };
      }

      setState((s) => ({
        ...s,
        loading: true,
        streaming: false,
        error: null,
        warning: null,
        analysis: null,
        frameDataUrl,
        identity,
      }));

      const requestStartedAt = performance.now();
      console.debug("[pause2shop:analysis]", {
        requestStartedAt,
        analysisSessionId: identity?.sessionId ?? null,
        frameId: identity?.frameId ?? meta?.frameId ?? null,
        mediaTime: identity?.mediaTime ?? meta?.mediaTime ?? null,
      });

      try {
        const result = STREAMING_ENABLED
          ? await runStreaming(frameDataUrl, meta, config, controller.signal, identity, version)
          : await runClassic(frameDataUrl, meta, config, controller.signal, identity, version);
        if (result && cacheKey && isActive(identity, version)) {
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
        console.debug("[pause2shop:analysis]", {
          requestCompletedAt: performance.now(),
          durationMs: performance.now() - requestStartedAt,
          analysisSessionId: identity?.sessionId ?? null,
          frameId: identity?.frameId ?? meta?.frameId ?? null,
        });
        return result;
      } catch (err) {
        if (!isActive(identity, version)) return null;
        const isTimeout =
          err instanceof Error &&
          (err.name === "TimeoutError" || err.name === "AbortError");
        let message = "No se pudo analizar el contenido. Revisa la configuración de la API de OpenAI o inténtalo de nuevo.";
        let detail = err instanceof Error ? err.message : String(err);
        if (isTimeout) {
          message = "El análisis tardó demasiado y se canceló. Vuelve a intentarlo.";
          detail = err instanceof Error ? err.message : "timeout";
        }
        setState((s) => ({ ...s, loading: false, streaming: false, error: message, errorDetail: detail }));
        return null;
      } finally {
        window.clearTimeout(timeout);
        if (activeRequest.current?.version === version) activeRequest.current = null;
      }
    },
    [isActive, runClassic, runStreaming]
  );

  const cancel = useCallback((clearAnalysis = false) => {
    activeRequest.current?.controller.abort();
    activeRequest.current = null;
    versionRef.current++;
    setState((current) =>
      clearAnalysis
        ? initialState
        : { ...current, loading: false, streaming: false, error: null }
    );
  }, []);

  const reset = useCallback(() => {
    cancel(true);
  }, [cancel]);

  return { ...state, analyze, cancel, reset };
}
