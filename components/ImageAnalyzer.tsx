"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FrameMeta } from "@/lib/api/types";
import type { DetectedItem } from "@/lib/types";
import DetectionOverlay from "@/components/DetectionOverlay";

type Props = {
  onRequestAnalysis: (dataUrl: string, meta: FrameMeta) => void;
  analyzing: boolean;
  onReset: () => void;
  /** Objetos detectados en la imagen actual, para pintar el overlay de hotspots. */
  items?: DetectedItem[];
  /** Item seleccionado en el panel lateral (resalta su hotspot). */
  selectedKey?: string | null;
  /** Clic en un hotspot del overlay: selecciona su card en el panel lateral. */
  onItemClick?: (item: DetectedItem) => void;
};

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_IMAGE_UPLOAD_MB) || 10;
const MAX_BYTES = MAX_MB * 1024 * 1024;

type ImageState =
  | { phase: "idle" }
  | { phase: "dragging" }
  | { phase: "invalid"; error: string }
  | { phase: "ready"; dataUrl: string; fileName: string; sizeKb: number };

export default function ImageAnalyzer({
  onRequestAnalysis,
  analyzing,
  onReset,
  items = [],
  selectedKey = null,
  onItemClick,
}: Props) {
  const t = useTranslations("studio.imageAnalyzer");
  const tStudio = useTranslations("studio");
  const [state, setState] = useState<ImageState>({ phase: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [imageAspect, setImageAspect] = useState<number | null>(null);

  const processFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setState({
        phase: "invalid",
        error: t("unsupportedFormat", { format: file.type || t("unknownFormat") }),
      });
      return;
    }
    if (file.size === 0) {
      setState({ phase: "invalid", error: t("emptyFile") });
      return;
    }
    if (file.size > MAX_BYTES) {
      setState({ phase: "invalid", error: t("tooLarge", { maxMb: MAX_MB }) });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl?.startsWith("data:image/")) {
        setState({ phase: "invalid", error: t("readError") });
        return;
      }
      setState({
        phase: "ready",
        dataUrl,
        fileName: file.name,
        sizeKb: Math.round(file.size / 1024),
      });
      setAnalyzed(false);
    };
    reader.readAsDataURL(file);
  }, [t]);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setState((s) => (s.phase === "dragging" ? { phase: "idle" } : s));
    handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setState({ phase: "dragging" });
  };

  const handleDragLeave = () => {
    setState((s) => (s.phase === "dragging" ? { phase: "idle" } : s));
  };

  const handleAnalyze = () => {
    if (state.phase !== "ready" || analyzing) return;
    const unique = `img:${state.fileName}:${Date.now()}`;
    onRequestAnalysis(state.dataUrl, {
      sourceType: "image_upload",
      videoKey: unique,
      videoTitle: state.fileName,
      timestampSeconds: 0,
      cacheKey: unique,
      provider: "image_upload",
      canEmbed: false,
      canCaptureFrame: false,
    });
    setAnalyzed(true);
  };

  const handleReset = () => {
    setState({ phase: "idle" });
    setAnalyzed(false);
    onReset();
    if (inputRef.current) inputRef.current.value = "";
  };

  // Clipboard paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
          }
          break;
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [processFile]);

  if (state.phase === "idle" || state.phase === "dragging" || state.phase === "invalid") {
    return (
      <div className="space-y-3">
        <label
          htmlFor="image-upload"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={
            "flex aspect-video w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed text-center transition " +
            (state.phase === "dragging"
              ? "border-brand-bright/60 bg-brand/10 scale-[1.01]"
              : "border-white/15 bg-white/[0.03] hover:border-brand-bright/40 hover:bg-white/[0.05]")
          }
        >
          <span className="text-4xl">{state.phase === "dragging" ? "⬇️" : "🖼️"}</span>
          <div>
            <p className="text-sm font-medium text-ink">
              {state.phase === "dragging" ? t("dropHere") : t("uploadPrompt")}
            </p>
            <p className="mt-1 text-xs text-ink-subtle">
              {t.rich("pasteHint", {
                maxMb: MAX_MB,
                kbd: (chunks) => (
                  <kbd className="rounded border border-line bg-white/5 px-1 py-0.5 font-mono text-[10px]">
                    {chunks}
                  </kbd>
                ),
              })}
            </p>
          </div>
          <span className="rounded-xl border border-line bg-white/5 px-4 py-2 text-xs font-medium text-ink-muted transition hover:bg-white/10">
            {tStudio("selectFile")}
          </span>
          <input
            id="image-upload"
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
        </label>

        {state.phase === "invalid" && (
          <div className="rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
            {state.error}
          </div>
        )}
      </div>
    );
  }

  // Ready state: show preview + analyze button
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-black shadow-2xl shadow-black/50">
        <div className="relative flex aspect-video w-full items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.dataUrl}
            alt={t("previewAlt")}
            className="h-full w-full object-contain"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setImageAspect(img.naturalWidth / img.naturalHeight);
              }
            }}
          />
          {analyzed && !analyzing && items.length > 0 && (
            <DetectionOverlay
              items={items}
              mediaAspect={imageAspect}
              selectedKey={selectedKey}
              onItemClick={onItemClick}
            />
          )}
          {analyzing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
              <div className="flex items-center gap-3 rounded-full border border-line-strong bg-black/70 px-5 py-2.5 text-sm font-medium text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-brand-bright" />
                {t("analyzingOverlay")}
              </div>
            </div>
          )}
          {analyzed && !analyzing && (
            <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full border border-success/30 bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
              {t("analyzedBadge")}
              {items.length > 0 && (
                <span className="rounded-full bg-success/20 px-1.5 text-success">
                  {items.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white/[0.03] p-4">
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-ink">{state.fileName}</p>
          <p className="text-xs text-ink-subtle">{t("fileInfo", { sizeKb: state.sizeKb })}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleAnalyze}
            disabled={analyzing || analyzed}
            className="rounded-lg bg-gradient-to-br from-brand to-magenta px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {analyzed
              ? t("analyzedBadge")
              : analyzing
                ? t("analyzingLabel")
                : tStudio("analysisType.image")}
          </button>
          {analyzed && (
            <button
              onClick={handleReset}
              className="rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:bg-white/10"
            >
              {t("analyzeAnother")}
            </button>
          )}
          {!analyzed && (
            <label className="cursor-pointer rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:bg-white/10">
              {t("changeImage")}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
              />
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
