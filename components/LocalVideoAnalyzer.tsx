"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { captureFrameDataUrl } from "@/lib/frameCapture";
import type { FrameMeta } from "@/lib/api/types";

type Props = {
  onRequestAnalysis: (dataUrl: string, meta: FrameMeta) => void;
  analyzing: boolean;
};

export default function LocalVideoAnalyzer({ onRequestAnalysis, analyzing }: Props) {
  const t = useTranslations("studio.videoAnalyzer");
  const tLocal = useTranslations("studio.localVideo");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const lastAnalyzedRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (src) URL.revokeObjectURL(src);
    setSrc(URL.createObjectURL(file));
    setFileName(file.name);
    lastAnalyzedRef.current = null;
  };

  const analyzeCurrent = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const rounded = Math.round(video.currentTime);
    if (lastAnalyzedRef.current === rounded) return;
    const dataUrl = captureFrameDataUrl(video);
    if (!dataUrl) return;
    lastAnalyzedRef.current = rounded;
    const videoKey = `local:${fileName ?? "video"}`;
    onRequestAnalysis(dataUrl, {
      sourceType: "uploaded",
      videoKey,
      videoTitle: fileName ?? tLocal("defaultTitle"),
      timestampSeconds: rounded,
      cacheKey: `${videoKey}:${rounded}`,
    });
  }, [fileName, onRequestAnalysis, tLocal]);

  const handlePause = useCallback(() => {
    if (!autoAnalyze) return;
    analyzeCurrent();
  }, [autoAnalyze, analyzeCurrent]);

  return (
    <div className="space-y-4">
      {!src ? (
        <label className="flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.03] text-center transition hover:border-brand-bright/40 hover:bg-white/[0.05]">
          <div className="text-3xl">🎬</div>
          <div>
            <p className="text-sm font-medium text-ink">
              {tLocal("uploadHint")}
            </p>
            <p className="text-xs text-ink-subtle">
              {tLocal("uploadSubHint")}
            </p>
          </div>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            onChange={handleFile}
            className="hidden"
          />
        </label>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-line bg-black shadow-2xl shadow-black/50">
          <video
            ref={videoRef}
            src={src}
            controls
            playsInline
            onPause={handlePause}
            className="aspect-video w-full"
          />
          {analyzing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
              <div className="flex items-center gap-3 rounded-full border border-line-strong bg-black/70 px-5 py-2.5 text-sm font-medium text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-bright" />
                {t("analyzingFrameOverlay")}
              </div>
            </div>
          )}
        </div>
      )}

      {src && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white/[0.03] p-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
            <span className="relative inline-flex">
              <input
                type="checkbox"
                checked={autoAnalyze}
                onChange={(e) => setAutoAnalyze(e.target.checked)}
                className="peer sr-only"
              />
              <span className="h-6 w-11 rounded-full bg-white/10 transition peer-checked:bg-brand" />
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
            </span>
            {t("analyzeOnPause")}
          </label>

          <div className="ml-auto flex gap-2">
            <button
              onClick={() => {
                lastAnalyzedRef.current = null;
                analyzeCurrent();
              }}
              disabled={analyzing}
              className="rounded-lg bg-gradient-to-br from-brand to-magenta px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {t("analyzeFrameNow")}
            </button>
            <label className="cursor-pointer rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:bg-white/10">
              {t("changeVideo")}
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/*"
                onChange={handleFile}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
