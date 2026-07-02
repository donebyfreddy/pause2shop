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
        } else if (u.pathname.startsWith("/live/")) {
          videoId = u.pathname.split("/live/")[1]?.split(/[?#]/)[0] || undefined;
        }
      }

      if (!videoId) return null;

      const normalizedUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const embedUrl = `https://www.youtube.com/embed/${videoId}`;

      return {
        provider: "youtube",
        sourceType: "external_iframe",
        originalUrl: url,
        normalizedUrl,
        videoId,
        embedUrl,
        canEmbed: true,
        canCaptureFrame: false,
        canCaptureFrameDirectly: false,
        requiresScreenCapture: true,
        preferredCaptureMode: "screen_capture",
        reason:
          "YouTube detectado. Compatible para embed. Captura: requiere pantalla compartida (cross-origin).",
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
        sourceType: "external_iframe",
        originalUrl: url,
        normalizedUrl,
        videoId,
        embedUrl,
        canEmbed: true,
        canCaptureFrame: false,
        canCaptureFrameDirectly: false,
        requiresScreenCapture: true,
        preferredCaptureMode: "screen_capture",
        reason:
          "Dailymotion detectado. Compatible para embed. Captura: requiere pantalla compartida (cross-origin).",
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

      if (u.hostname === "vimeo.com" || u.hostname === "www.vimeo.com") {
        videoId = /^\/(\d+)/.exec(u.pathname)?.[1] || undefined;
      } else if (u.hostname === "player.vimeo.com") {
        videoId = /^\/video\/(\d+)/.exec(u.pathname)?.[1] || undefined;
      }

      if (!videoId) return null;

      const normalizedUrl = `https://vimeo.com/${videoId}`;
      const embedUrl = `https://player.vimeo.com/video/${videoId}`;

      return {
        provider: "vimeo",
        sourceType: "external_iframe",
        originalUrl: url,
        normalizedUrl,
        videoId,
        embedUrl,
        canEmbed: true,
        canCaptureFrame: false,
        canCaptureFrameDirectly: false,
        requiresScreenCapture: true,
        preferredCaptureMode: "screen_capture",
        reason:
          "Vimeo detectado. Compatible para embed. Captura: requiere pantalla compartida (cross-origin).",
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
      const isMp4 =
        pathLower.endsWith(".mp4") ||
        pathLower.includes(".mp4?") ||
        pathLower.includes(".mp4&");
      if (!isMp4) return null;

      return {
        provider: "direct_mp4",
        sourceType: "direct_video",
        originalUrl: url,
        normalizedUrl: url,
        embedUrl: url,
        canEmbed: true,
        canCaptureFrame: true,
        canCaptureFrameDirectly: true,
        requiresScreenCapture: false,
        preferredCaptureMode: "direct_canvas",
        reason:
          "MP4 directo detectado. Captura directa disponible (si el servidor permite CORS). No necesitas compartir pantalla.",
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
      const isHls =
        pathLower.endsWith(".m3u8") ||
        pathLower.includes(".m3u8?") ||
        pathLower.includes(".m3u8&");
      if (!isHls) return null;

      return {
        provider: "hls",
        sourceType: "direct_video",
        originalUrl: url,
        normalizedUrl: url,
        embedUrl: url,
        canEmbed: true,
        canCaptureFrame: true,
        canCaptureFrameDirectly: true,
        requiresScreenCapture: false,
        preferredCaptureMode: "direct_canvas",
        reason:
          "Stream HLS detectado. Captura directa disponible si el servidor permite CORS.",
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
      sourceType: "external_iframe",
      originalUrl: url,
      normalizedUrl: url,
      canEmbed: false,
      canCaptureFrame: false,
      canCaptureFrameDirectly: false,
      requiresScreenCapture: false,
      preferredCaptureMode: "unsupported",
      reason:
        "Proveedor no reconocido. Prueba con un link de YouTube, Dailymotion, Vimeo, o una URL directa .mp4 o .m3u8. También puedes subir un vídeo directamente.",
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
// Uploaded video synthetic detection
// ---------------------------------------------------------------------------

/**
 * Creates a synthetic VideoProviderDetectionResult for a locally uploaded video file.
 * This is not a URL — it uses an objectURL and direct canvas capture.
 */
export function createUploadedVideoDetection(fileName: string): VideoProviderDetectionResult {
  return {
    provider: "uploaded_video",
    sourceType: "uploaded_video",
    originalUrl: fileName,
    normalizedUrl: fileName,
    canEmbed: true,
    canCaptureFrame: true,
    canCaptureFrameDirectly: true,
    requiresScreenCapture: false,
    preferredCaptureMode: "direct_canvas",
    reason:
      "Vídeo subido. Captura directa disponible. No necesitas compartir pantalla.",
  };
}

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
      sourceType: "external_iframe",
      originalUrl: url,
      normalizedUrl: url,
      canEmbed: false,
      canCaptureFrame: false,
      canCaptureFrameDirectly: false,
      requiresScreenCapture: false,
      preferredCaptureMode: "unsupported",
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
  uploaded_video: "Vídeo subido",
  unknown: "Desconocido",
};

export const PROVIDER_CAN_EMBED: Record<VideoProvider, boolean> = {
  youtube: true,
  dailymotion: true,
  vimeo: true,
  direct_mp4: true,
  hls: true,
  uploaded_video: true,
  unknown: false,
};

export const PROVIDER_CAN_CAPTURE: Record<VideoProvider, boolean> = {
  youtube: false,
  dailymotion: false,
  vimeo: false,
  direct_mp4: true,
  hls: true,
  uploaded_video: true,
  unknown: false,
};
