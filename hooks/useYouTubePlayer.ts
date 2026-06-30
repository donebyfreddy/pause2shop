"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { YT_STATE } from "@/lib/youtube";

/* Minimal typings for the YouTube IFrame API surface we use. */
type YTPlayer = {
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

type YTPlayerEvent = { data: number; target: YTPlayer };

type YTNamespace = {
  Player: new (
    el: HTMLElement | string,
    opts: {
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: YTPlayerEvent) => void;
      };
    }
  ) => YTPlayer;
  PlayerState: Record<string, number>;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

export type PlayerStatus = "idle" | "loading" | "ready" | "error";

export type UseYouTubePlayer = {
  status: PlayerStatus;
  playerState: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  getCurrentTime: () => number;
};

/**
 * Mounts a YouTube player into containerRef for the given videoId and reports
 * state changes. `onPaused` fires with the current time when the user pauses.
 */
export function useYouTubePlayer(
  videoId: string | null,
  onPaused?: (currentTime: number) => void
): UseYouTubePlayer {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const onPausedRef = useRef(onPaused);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [playerState, setPlayerState] = useState<number>(YT_STATE.UNSTARTED);

  useEffect(() => {
    onPausedRef.current = onPaused;
  }, [onPaused]);

  useEffect(() => {
    if (!videoId || !containerRef.current) return;
    let cancelled = false;
    setStatus("loading");

    // Mount point that the API will replace with an iframe.
    const mount = document.createElement("div");
    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(mount);

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        playerRef.current = new YT.Player(mount, {
          videoId,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
          },
          events: {
            onReady: () => !cancelled && setStatus("ready"),
            onStateChange: (e) => {
              if (cancelled) return;
              setPlayerState(e.data);
              if (e.data === YT_STATE.PAUSED) {
                onPausedRef.current?.(e.target.getCurrentTime());
              }
            },
          },
        });
      })
      .catch(() => !cancelled && setStatus("error"));

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [videoId]);

  const getCurrentTime = useCallback(() => {
    try {
      return playerRef.current?.getCurrentTime() ?? 0;
    } catch {
      return 0;
    }
  }, []);

  return { status, playerState, containerRef, getCurrentTime };
}
