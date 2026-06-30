"use client";

import { useCallback, useRef, useState } from "react";
import type { FrameMeta } from "@/lib/api/types";

type Props = {
  onRequestAnalysis: (dataUrl: string, meta: FrameMeta) => void;
  analyzing: boolean;
  onReset: () => void;
};

const ACCEPTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_MB = Number(process.env.NEXT_PUBLIC_MAX_IMAGE_UPLOAD_MB) || 10;
const MAX_BYTES = MAX_MB * 1024 * 1024;

type ImageState =
  | { phase: "idle" }
  | { phase: "dragging" }
  | { phase: "invalid"; error: string }
  | { phase: "ready"; dataUrl: string; fileName: string; sizeKb: number };

export default function ImageAnalyzer({ onRequestAnalysis, analyzing, onReset }: Props) {
  const [state, setState] = useState<ImageState>({ phase: "idle" });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [analyzed, setAnalyzed] = useState(false);

  const processFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setState({ phase: "invalid", error: `Formato no soportado: ${file.type || "desconocido"}. Usa JPG, PNG o WebP.` });
      return;
    }
    if (file.size === 0) {
      setState({ phase: "invalid", error: "El archivo está vacío." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setState({ phase: "invalid", error: `La imagen supera el límite de ${MAX_MB} MB.` });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl?.startsWith("data:image/")) {
        setState({ phase: "invalid", error: "No se pudo leer la imagen." });
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
  }, []);

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
              ? "border-indigo-400/60 bg-indigo-500/10 scale-[1.01]"
              : "border-white/15 bg-white/[0.03] hover:border-indigo-400/40 hover:bg-white/[0.05]")
          }
        >
          <span className="text-4xl">{state.phase === "dragging" ? "⬇️" : "🖼️"}</span>
          <div>
            <p className="text-sm font-medium text-zinc-200">
              {state.phase === "dragging" ? "Suelta la imagen aquí" : "Sube o arrastra una imagen"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              JPG, PNG, WebP — máx. {MAX_MB} MB
            </p>
          </div>
          <span className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/10">
            Seleccionar archivo
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
          <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {state.error}
          </div>
        )}
      </div>
    );
  }

  // Ready state: show preview + analyze button
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50">
        <div className="relative flex aspect-video w-full items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.dataUrl}
            alt="Preview"
            className="h-full w-full object-contain"
          />
          {analyzing && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
              <div className="flex items-center gap-3 rounded-full border border-white/20 bg-black/70 px-5 py-2.5 text-sm font-medium text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
                Analizando imagen…
              </div>
            </div>
          )}
          {analyzed && !analyzing && (
            <div className="absolute left-2 top-2 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
              Analizado ✓
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-zinc-200">{state.fileName}</p>
          <p className="text-xs text-zinc-500">{state.sizeKb} KB · imagen subida</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleAnalyze}
            disabled={analyzing || analyzed}
            className="rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {analyzed ? "Analizado ✓" : analyzing ? "Analizando…" : "Analizar imagen"}
          </button>
          {analyzed && (
            <button
              onClick={handleReset}
              className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/10"
            >
              Analizar otra imagen
            </button>
          )}
          {!analyzed && (
            <label className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/10">
              Cambiar imagen
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
