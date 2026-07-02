/**
 * Perceptual frame diff — compares a video element's current frame against
 * a previously stored pixel snapshot using a 32×18 thumbnail canvas.
 * All operations are synchronous; call only in the browser.
 */

const THUMB_W = 32;
const THUMB_H = 18;

let thumbCanvas: HTMLCanvasElement | null = null;
let thumbCtx: CanvasRenderingContext2D | null = null;

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (!thumbCanvas) {
    thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = THUMB_W;
    thumbCanvas.height = THUMB_H;
    thumbCtx = thumbCanvas.getContext("2d", { willReadFrequently: true });
  }
  return thumbCtx;
}

export type FrameDiffResult = {
  /** Perceptual difference: 0 = identical, 1 = completely different. */
  diff: number;
  /** Pixel snapshot of the current frame (store as prevPixels for next call). */
  pixels: Uint8ClampedArray;
};

/**
 * Draws the current frame of a video element onto a tiny canvas and computes
 * a mean absolute pixel difference against prevPixels.
 *
 * Returns null when the video has no frame data yet (videoWidth === 0) or
 * the canvas is tainted (cross-origin video without CORS headers).
 */
export function computeFrameDiffFromVideo(
  video: HTMLVideoElement,
  prevPixels: Uint8ClampedArray | null,
): FrameDiffResult | null {
  if (!video.videoWidth || !video.videoHeight) return null;

  const ctx = ensureCanvas();
  if (!ctx) return null;

  try {
    ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    const imageData = ctx.getImageData(0, 0, THUMB_W, THUMB_H);
    const pixels = imageData.data;

    if (!prevPixels || prevPixels.length !== pixels.length) {
      return { diff: 1, pixels: new Uint8ClampedArray(pixels) };
    }

    let total = 0;
    const len = pixels.length;
    for (let i = 0; i < len; i += 4) {
      total +=
        (Math.abs(pixels[i] - prevPixels[i]) +
          Math.abs(pixels[i + 1] - prevPixels[i + 1]) +
          Math.abs(pixels[i + 2] - prevPixels[i + 2])) /
        (3 * 255);
    }

    return {
      diff: total / (THUMB_W * THUMB_H),
      pixels: new Uint8ClampedArray(pixels),
    };
  } catch {
    // Canvas tainted (cross-origin without CORS) — treat as different frame.
    return null;
  }
}
