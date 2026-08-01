"use client";

import ResumeVideoButton from "./ResumeVideoButton";

function preciseTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

export default function PausedFrameToolbar({
  mediaTime,
  onResume,
}: {
  mediaTime: number;
  onResume: () => void;
}) {
  return (
    <div
      className="absolute left-3 top-3 z-50 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-black/80 p-2 text-white shadow-xl backdrop-blur-md"
      data-testid="paused-frame-toolbar"
    >
      <ResumeVideoButton onResume={onResume} compact />
      <span className="px-1 text-[11px] font-medium text-white/70">
        Frame pausado · {preciseTimestamp(mediaTime)}
      </span>
      <span className="hidden text-[10px] text-white/45 sm:inline">Espacio o K</span>
    </div>
  );
}
