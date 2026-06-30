/**
 * Client-side frame capture helpers. We downscale to a max width to save
 * bandwidth and API tokens, and encode to JPEG at quality 0.82.
 */

export const MAX_FRAME_WIDTH = 1280;
export const JPEG_QUALITY = 0.82;

type Source = HTMLVideoElement;

/**
 * Draw the current frame of a <video> element onto a canvas, downscaled,
 * and return a JPEG data URL. Returns null if the source has no frame yet.
 */
export function captureFrameDataUrl(
  video: Source,
  maxWidth = MAX_FRAME_WIDTH,
  quality = JPEG_QUALITY
): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const scale = w > maxWidth ? maxWidth / w : 1;
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, targetW, targetH);

  try {
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    // Tainted canvas (e.g. cross-origin) — cannot read pixels.
    return null;
  }
}

/** Approximate byte size of a base64 data URL. */
export function dataUrlByteSize(dataUrl: string): number {
  const idx = dataUrl.indexOf(",");
  const b64 = idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
  return Math.floor((b64.length * 3) / 4);
}
