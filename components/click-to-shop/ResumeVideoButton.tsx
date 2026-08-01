"use client";

import { Play } from "lucide-react";

export default function ResumeVideoButton({
  onResume,
  compact = false,
}: {
  onResume: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onResume}
      data-testid="resume-video-button"
      className={
        compact
          ? "inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:scale-[1.02] hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bright motion-reduce:hover:scale-100"
          : "inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-black shadow-lg transition hover:scale-[1.02] hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bright motion-reduce:hover:scale-100"
      }
      aria-label="Reanudar vídeo"
    >
      <Play className={compact ? "size-3" : "size-4"} fill="currentColor" aria-hidden />
      Reanudar vídeo
    </button>
  );
}
