import type { VideoProvider, VideoProviderAdapter, VideoProviderDetectionResult } from "./types";

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

const youtubeAdapter: VideoProviderAdapter = {
  provider: "youtube",
  canEmbed: true,
  canCaptureFrame: false,
  detect(url) {
    try {
      const u = new URL(url);
      let videoId: string | undefined;

      if (u.hostname === "youtu.be") {
        videoId = u.pathname.slice(1).split(/[?#]/)[0] || undefined;
      } else if (
        u.hostname === "www.youtube.com" ||
        u.hostname === "youtube.com" ||
        u.hostname === "m.youtube.com"
      ) {
        if (u.pathname === "/watch") {
          videoId = u.searchParams.get("v") ?? undefined;
        } else if (u.pathname.startsWith("/embed/")) {
          videoId = u.pathname.split("/embed/")[1]?.split(/[?#]/)[0] || undefined;
        } else if (u.pathname.startsWith("/shorts/")) {
          videoId = u.pathname.split("/shorts/")[1]?.split(/[?#]/)[0] || undefined;
        }
      }

      if (!videoId) return null;

      const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const embedUrl = `https://www.youtube.com/embed/${videoId}`;

      return {
        provider: "youtube",
        originalUrl: url,
        normalizedUrl,
        videoId,
        embedUrl,
        canEmbed: true,
        canCaptureFrame: false,
        reason:
          "YouTube detectado. Se puede reproducir mediante iframe. La captura directa de frame requiere compartir pantalla por restricciones cross-origin.",
      };
    } catch {
      return null;
    }
  },
};

const dailymotionAdapter: VideoProviderAdapter = {
  provider: "dailymotion",
  canEmbed: true,
  canCaptureFrame: false,
  detect(url) {
    try {
      const u = new URL(url);
      let videoId: string | undefined;

      if (u.hostname === "dai.ly") {
        videoId = u.pathname.slice(1).split(/[?#]/)[0] || undefined;
      } else if (
        u.hostname === "www.dailymotion.com" ||
        u.hostname === "dailymotion.com"
      ) {
        if (u.pathname.startsWith("/video/")) {
          videoId = u.pathname.split("/video/")[1]?.split(/[?#_]/)[0] || undefined;
        } else if (u.pathname.startsWith("/embed/video/")) {
          videoId = u.pathname.split("/embed/video/")[1]?.split(/[?#_]/)[0] || undefined;
        }
      }

      if (!videoId) return null;

      const normalizedUrl = `https://www.dailymotion.com/video/${videoId}`;
      const embedUrl = `https://www.dailymotion.com/embed/video/${videoId}`;

      return {
        provider: "dailymotion",
        originalUrl: url,
        normalizedUrl,
        videoId,
        embedUrl,
        canEmbed: true,
        canCaptureFrame: false,
        reason:
          "Dailymotion detectado. Se puede reproducir mediante iframe. La captura directa de frame puede estar bloqueada por restricciones cross-origin del navegador. Usa captura de pantalla autorizada para analizar frames.",
      };
    } catch {
      return null;
    }
  },
};

const vimeoAdapter: VideoProviderAdapter = {
  provider: "vimeo",
  canEmbed: true,
  canCaptureFrame: false,
  detect(url) {
    try {
      const u = new URL(url);
      let videoId: string | undefined;

      if (
        u.hostname === "vimeo.com" ||
        u.hostname === "www.vimeo.com"
      ) {
        const match = u.pathname.match(/^\/(\d+)/);
        videoId = match?.[1] || undefined;
      } else if (u.hostname === "player.vimeo.com") {
        const match = u.pathname.match(/^\/video\/(\d+)/);
        videoId = match?.[1] || undefined;
      }

      if (!videoId) return null;

      const normalizedUrl = `https://vimeo.com/${videoId}`;
      const embedUrl = `https://player.vimeo.com/video/${videoId}`;

      return {
        provider: "vimeo",
        originalUrl: url,
        normalizedUrl,
        videoId,
        embedUrl,
        canEmbed: true,
        canCaptureFrame: false,
        reason:
          "Vimeo detectado. Se puede reproducir mediante iframe. La captura directa de frame puede estar bloqueada por restricciones cross-origin. Usa captura de pantalla autorizada para analizar frames.",
      };
    } catch {
      return null;
    }
  },
};

const directMp4Adapter: VideoProviderAdapter = {
  provider: "direct_mp4",
  canEmbed: true,
  canCaptureFrame: true,
  detect(url) {
    try {
      const u = new URL(url);
      const pathLower = u.pathname.toLowerCase();
      const isMp4 = pathLower.endsWith(".mp4") || pathLower.includes(".mp4?") || pathLower.includes(".mp4&");
      if (!isMp4) return null;

      return {
        provider: "direct_mp4",
        originalUrl: url,
        normalizedUrl: url,
        embedUrl: url,
        canEmbed: true,
        canCaptureFrame: true,
        reason:
          "Vídeo MP4 directo detectado. Se puede reproducir y capturar frames directamente (si el servidor permite CORS).",
      };
    } catch {
      return null;
    }
  },
};

const hlsAdapter: VideoProviderAdapter = {
  provider: "hls",
  canEmbed: true,
  canCaptureFrame: true,
  detect(url) {
    try {
      const u = new URL(url);
      const pathLower = u.pathname.toLowerCase();
      const isHls = pathLower.endsWith(".m3u8") || pathLower.includes(".m3u8?") || pathLower.includes(".m3u8&");
      if (!isHls) return null;

      return {
        provider: "hls",
        originalUrl: url,
        normalizedUrl: url,
        embedUrl: url,
        canEmbed: true,
        canCaptureFrame: true,
        reason:
          "Stream HLS detectado. Compatible con reproductor nativo. La captura de frames es posible si el servidor permite CORS.",
      };
    } catch {
      return null;
    }
  },
};

const unknownAdapter: VideoProviderAdapter = {
  provider: "unknown",
  canEmbed: false,
  canCaptureFrame: false,
  detect(url) {
    return {
      provider: "unknown",
      originalUrl: url,
      normalizedUrl: url,
      canEmbed: false,
      canCaptureFrame: false,
      reason:
        "Proveedor no reconocido. No se puede reproducir ni capturar frames automáticamente. Prueba con un link de YouTube, Dailymotion, Vimeo, o una URL directa .mp4 o .m3u8.",
    };
  },
};

// Orden de detección: de más específico a más genérico.
const ADAPTERS: VideoProviderAdapter[] = [
  youtubeAdapter,
  dailymotionAdapter,
  vimeoAdapter,
  directMp4Adapter,
  hlsAdapter,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detecta el proveedor de un link de vídeo y devuelve metadatos normalizados.
 * Nunca lanza — devuelve `unknown` para URLs no reconocidas.
 */
export function detectVideoProvider(url: string): VideoProviderDetectionResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return {
      provider: "unknown",
      originalUrl: url,
      normalizedUrl: url,
      canEmbed: false,
      canCaptureFrame: false,
      reason: "URL vacía.",
    };
  }

  for (const adapter of ADAPTERS) {
    const result = adapter.detect(trimmed);
    if (result) return result;
  }

  return unknownAdapter.detect(trimmed)!;
}

export const PROVIDER_LABELS: Record<VideoProvider, string> = {
  youtube: "YouTube",
  dailymotion: "Dailymotion",
  vimeo: "Vimeo",
  direct_mp4: "MP4 directo",
  hls: "HLS / Stream",
  unknown: "Desconocido",
};

export const PROVIDER_CAN_EMBED: Record<VideoProvider, boolean> = {
  youtube: true,
  dailymotion: true,
  vimeo: true,
  direct_mp4: true,
  hls: true,
  unknown: false,
};

export const PROVIDER_CAN_CAPTURE: Record<VideoProvider, boolean> = {
  youtube: false,
  dailymotion: false,
  vimeo: false,
  direct_mp4: true,
  hls: true,
  unknown: false,
};
