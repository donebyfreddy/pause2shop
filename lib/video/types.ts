export type VideoProvider =
  | "youtube"
  | "dailymotion"
  | "vimeo"
  | "direct_mp4"
  | "hls"
  | "uploaded_video"
  | "unknown";

export type VideoSourceType = "external_iframe" | "direct_video" | "uploaded_video";

export type PreferredCaptureMode =
  | "screen_capture"
  | "direct_canvas"
  | "server_ingestion"
  | "unsupported";

export type VideoProviderDetectionResult = {
  provider: VideoProvider;
  sourceType: VideoSourceType;
  originalUrl: string;
  normalizedUrl: string;
  videoId?: string;
  embedUrl?: string;
  canEmbed: boolean;
  /** @deprecated Alias of canCaptureFrameDirectly. Kept for backward compat. */
  canCaptureFrame: boolean;
  canCaptureFrameDirectly: boolean;
  requiresScreenCapture: boolean;
  preferredCaptureMode: PreferredCaptureMode;
  reason?: string;
};

export interface VideoProviderAdapter {
  provider: VideoProvider;
  detect(url: string): VideoProviderDetectionResult | null;
  canEmbed: boolean;
  canCaptureFrame: boolean;
}
