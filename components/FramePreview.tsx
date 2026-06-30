"use client";

type Props = {
  dataUrl: string | null;
  label?: string;
};

/** Small preview of the most recently captured frame. */
export default function FramePreview({ dataUrl, label = "Frame analizado" }: Props) {
  if (!dataUrl) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <div className="relative aspect-video w-full">
        {/* Data URL frame — a plain <img> avoids the Next image optimizer on base64. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt={label} className="h-full w-full object-cover" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {label}
      </div>
    </div>
  );
}
