"use client";

import type { CSSProperties } from "react";
import type { DetectedItem } from "@/lib/types";

export type HotspotState =
  | "detected"
  | "matching_catalog"
  | "catalog_matched"
  | "unresolved"
  | "searching_external"
  | "external_matched";

const STATE_COLOR: Record<HotspotState, string> = {
  detected: "#a1a1aa",
  matching_catalog: "#a78bfa",
  catalog_matched: "#34d399",
  unresolved: "#fbbf24",
  searching_external: "#a78bfa",
  external_matched: "#22d3ee",
};

export function hotspotState(item: DetectedItem): HotspotState {
  if (item.external_loading) return "searching_external";
  if (item.detection_result?.external.status === "matched") return "external_matched";
  if (item.detection_result?.catalog.status === "matched") return "catalog_matched";
  if (item.matchingStatus === "searching" || item.matchingStatus === "pending") {
    return "matching_catalog";
  }
  if (
    item.matchingStatus === "no_match" ||
    item.matchingStatus === "similar_only" ||
    item.matchingStatus === "provider_error"
  ) {
    return "unresolved";
  }
  return "detected";
}

export default function ProductHotspot({
  item,
  style,
  selected,
  onSelect,
}: {
  item: DetectedItem;
  style: CSSProperties;
  selected: boolean;
  onSelect: () => void;
}) {
  const state = hotspotState(item);
  const color = STATE_COLOR[state];
  const label = `${item.name} · ${Math.round(item.confidence * 100)}%`;
  return (
    <button
      type="button"
      aria-label={`Seleccionar ${label}`}
      aria-pressed={selected}
      data-hotspot-state={state}
      onClick={onSelect}
      style={{ ...style, "--hotspot-color": color } as CSSProperties}
      className={
        "group absolute rounded-md border-2 border-[var(--hotspot-color)] bg-transparent text-left " +
        "transition-[transform,box-shadow,background-color] duration-150 hover:scale-[1.015] hover:bg-white/[0.04] " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white " +
        (selected ? "z-30 scale-[1.015] shadow-[0_0_0_2px_#fff,0_0_24px_var(--hotspot-color)]" : "z-20")
      }
    >
      <span
        className="absolute -top-7 left-0 inline-flex max-w-[220px] items-center gap-1.5 whitespace-nowrap rounded-md border border-white/15 bg-black/85 px-2 py-1 text-[11px] font-semibold text-white shadow-lg"
      >
        <span
          className="size-1.5 shrink-0 rounded-full bg-[var(--hotspot-color)]"
          aria-hidden
        />
        <span className="truncate">{label}</span>
      </span>
    </button>
  );
}
