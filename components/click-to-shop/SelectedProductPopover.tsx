"use client";

import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import type { DetectedItem } from "@/lib/types";

export default function SelectedProductPopover({
  item,
  style,
}: {
  item: DetectedItem;
  style: CSSProperties;
}) {
  return (
    <div
      role="status"
      style={style}
      className="pointer-events-none absolute z-40 hidden items-center gap-2 rounded-full border border-brand/40 bg-black/90 px-3 py-1.5 text-[11px] font-medium text-white shadow-xl sm:flex"
    >
      <span className="max-w-40 truncate">{item.name}</span>
      <ArrowRight className="size-3 text-brand-bright" aria-hidden />
      <span className="text-brand-bright">Catálogo</span>
    </div>
  );
}
