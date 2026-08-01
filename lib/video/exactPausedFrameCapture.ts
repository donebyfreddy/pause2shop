import {
  PAUSED_FRAME_TIME_TOLERANCE_MS,
  type CapturedVideoFrame,
} from "./pauseAnalysis";

type VideoWithFrameCallbacks = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export type PresentedVideoFrame = {
  mediaTime: number;
  presentedAt: number;
  presentedFrames: number;
  width: number;
  height: number;
};

export type PauseCaptureDebug = {
  pauseEventCurrentTime: number;
  videoCurrentTime: number;
  presentedFrameMediaTime: number | null;
  capturedFrameTimestamp: number;
  frameId: string;
  captureStrategy: "presented_frame" | "hidden_exact_seek";
  deltaMs: number | null;
};

type CaptureOptions = {
  videoId: string;
  requestedTime: number;
  pauseEventCurrentTime: number;
  signal?: AbortSignal;
};

function abortError(): DOMException {
  return new DOMException("Captura cancelada", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function waitForEvent(
  target: EventTarget,
  event: string,
  signal?: AbortSignal,
  timeoutMs = 5_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = window.setTimeout(() => finish(new Error(`Timeout esperando ${event}`)), timeoutMs);
    const onEvent = () => finish();
    const onAbort = () => finish(abortError());
    const finish = (error?: unknown) => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    target.addEventListener(event, onEvent, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForPresentedFrame(
  video: VideoWithFrameCallbacks,
  signal?: AbortSignal
): Promise<PresentedVideoFrame> {
  throwIfAborted(signal);
  if (typeof video.requestVideoFrameCallback !== "function") {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cancelAnimationFrame(id);
        reject(abortError());
      };
      const id = requestAnimationFrame(() => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        resolve({
          mediaTime: video.currentTime,
          presentedAt: performance.now(),
          presentedFrames: 0,
          width: video.videoWidth,
          height: video.videoHeight,
        });
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    let handle = 0;
    const onAbort = () => {
      video.cancelVideoFrameCallback?.(handle);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    handle = video.requestVideoFrameCallback!((now, metadata) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({
        mediaTime: metadata.mediaTime,
        presentedAt: now,
        presentedFrames: metadata.presentedFrames,
        width: metadata.width || video.videoWidth,
        height: metadata.height || video.videoHeight,
      });
    });
  });
}

async function canvasBlob(
  video: HTMLVideoElement
): Promise<{ blob: Blob; width: number; height: number }> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("El vídeo todavía no tiene un frame presentable");
  const scale = width > 1280 ? 1280 / width : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo crear el canvas de captura");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo codificar el frame"))),
      "image/jpeg",
      0.82
    );
  });
  return { blob, width: canvas.width, height: canvas.height };
}

async function sha256(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Registra el último frame realmente presentado y captura el frame de pausa.
 * Si `currentTime` y `metadata.mediaTime` difieren más de 80 ms, decodifica el
 * instante solicitado en un vídeo gemelo fuera de pantalla antes de dibujar.
 */
export class ExactPausedFrameCapture {
  private readonly visibleVideo: VideoWithFrameCallbacks;
  private lastPresentedFrame: PresentedVideoFrame | null = null;
  private callbackHandle: number | null = null;
  private stopped = false;

  constructor(video: HTMLVideoElement) {
    this.visibleVideo = video as VideoWithFrameCallbacks;
  }

  start() {
    this.stopped = false;
    const arm = () => {
      if (this.stopped) return;
      if (typeof this.visibleVideo.requestVideoFrameCallback !== "function") return;
      this.callbackHandle = this.visibleVideo.requestVideoFrameCallback((now, metadata) => {
        this.lastPresentedFrame = {
          mediaTime: metadata.mediaTime,
          presentedAt: now,
          presentedFrames: metadata.presentedFrames,
          width: metadata.width || this.visibleVideo.videoWidth,
          height: metadata.height || this.visibleVideo.videoHeight,
        };
        arm();
      });
    };
    arm();
  }

  stop() {
    this.stopped = true;
    if (this.callbackHandle != null) {
      this.visibleVideo.cancelVideoFrameCallback?.(this.callbackHandle);
      this.callbackHandle = null;
    }
  }

  getLastPresentedFrame(): PresentedVideoFrame | null {
    return this.lastPresentedFrame;
  }

  async capture(options: CaptureOptions): Promise<{
    frame: CapturedVideoFrame;
    debug: PauseCaptureDebug;
  }> {
    const { requestedTime, videoId, pauseEventCurrentTime, signal } = options;
    throwIfAborted(signal);
    const presented = this.lastPresentedFrame;
    const deltaMs = presented
      ? Math.abs(presented.mediaTime - requestedTime) * 1000
      : Number.POSITIVE_INFINITY;

    let source = this.visibleVideo;
    let mediaTime = presented?.mediaTime ?? requestedTime;
    let strategy: PauseCaptureDebug["captureStrategy"] = "presented_frame";
    let hiddenVideo: VideoWithFrameCallbacks | null = null;

    try {
      if (!presented || deltaMs > PAUSED_FRAME_TIME_TOLERANCE_MS) {
        strategy = "hidden_exact_seek";
        hiddenVideo = document.createElement("video") as VideoWithFrameCallbacks;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        hiddenVideo.preload = "auto";
        hiddenVideo.crossOrigin = this.visibleVideo.crossOrigin || "anonymous";
        hiddenVideo.style.cssText =
          "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
        document.body.appendChild(hiddenVideo);
        hiddenVideo.src = this.visibleVideo.currentSrc || this.visibleVideo.src;
        if (hiddenVideo.readyState < HTMLMediaElement.HAVE_METADATA) {
          await waitForEvent(hiddenVideo, "loadedmetadata", signal);
        }
        const presentedPromise = waitForPresentedFrame(hiddenVideo, signal);
        const seekedPromise = waitForEvent(hiddenVideo, "seeked", signal);
        hiddenVideo.currentTime = Math.min(
          Math.max(0, requestedTime),
          Number.isFinite(hiddenVideo.duration) ? hiddenVideo.duration : requestedTime
        );
        const [, exactPresented] = await Promise.all([seekedPromise, presentedPromise]);
        throwIfAborted(signal);
        source = hiddenVideo;
        mediaTime = exactPresented.mediaTime;
      }

      const { blob, width, height } = await canvasBlob(source);
      throwIfAborted(signal);
      const frameId = crypto.randomUUID();
      const frame: CapturedVideoFrame = {
        frameId,
        videoId,
        mediaTime,
        currentTime: requestedTime,
        capturedAt: Date.now(),
        width,
        height,
        blob,
        hash: await sha256(blob),
      };
      return {
        frame,
        debug: {
          pauseEventCurrentTime,
          videoCurrentTime: this.visibleVideo.currentTime,
          presentedFrameMediaTime: presented?.mediaTime ?? null,
          capturedFrameTimestamp: mediaTime,
          frameId,
          captureStrategy: strategy,
          deltaMs: Number.isFinite(deltaMs) ? deltaMs : null,
        },
      };
    } finally {
      if (hiddenVideo) {
        hiddenVideo.removeAttribute("src");
        hiddenVideo.load();
        hiddenVideo.remove();
      }
    }
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el frame"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}
