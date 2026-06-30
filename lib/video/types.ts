export type VideoProvider =
  | "youtube"
  | "dailymotion"
  | "vimeo"
  | "direct_mp4"
  | "hls"
  | "unknown";

export type VideoProviderDetectionResult = {
  provider: VideoProvider;
  originalUrl: string;
  normalizedUrl: string;
  videoId?: string;
  embedUrl?: string;
  canEmbed: boolean;
  canCaptureFrame: boolean;
  reason?: string;
};

export interface VideoProviderAdapter {
  provider: VideoProvider;
  detect(url: string): VideoProviderDetectionResult | null;
  canEmbed: boolean;
  canCaptureFrame: boolean;
}
