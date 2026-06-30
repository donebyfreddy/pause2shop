"use client";

/** Skeleton shown while a frame is being analyzed. */
export default function LoadingAnalysis() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Analizando frame">
      <div className="flex items-center gap-3 rounded-xl border border-indigo-400/20 bg-indigo-500/10 px-4 py-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-indigo-400" />
        </span>
        <span className="text-sm font-medium text-indigo-200">
          Analizando objetos comprables…
        </span>
      </div>

      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-white/10 bg-white/5 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="h-4 w-32 rounded bg-white/10" />
            <div className="h-5 w-12 rounded-full bg-white/10" />
          </div>
          <div className="mb-2 h-3 w-full rounded bg-white/10" />
          <div className="mb-4 h-3 w-2/3 rounded bg-white/10" />
          <div className="flex gap-2">
            <div className="h-8 w-24 rounded-lg bg-white/10" />
            <div className="h-8 w-24 rounded-lg bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}
