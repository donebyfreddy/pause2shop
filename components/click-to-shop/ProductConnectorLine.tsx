"use client";

import type { CSSProperties } from "react";

export default function ProductConnectorLine({
  x,
  y,
  width,
}: {
  x: number;
  y: number;
  width: number;
}) {
  return (
    <span
      aria-hidden
      style={{ left: x, top: y, width } as CSSProperties}
      className="pointer-events-none absolute z-10 hidden h-px bg-gradient-to-r from-brand-bright/80 to-brand-bright/10 xl:block"
    />
  );
}
