"use client";

import { motion } from "motion/react";
import type { DetectedItem } from "@/lib/types";

type Props = {
  dataUrl: string | null;
  label?: string;
  /** Si se pasan items con bounding_box, se dibujan sobre la preview. */
  items?: DetectedItem[];
};

/** Preview del último frame capturado, con las cajas de detección superpuestas. */
export default function FramePreview({
  dataUrl,
  label = "Frame analizado",
  items = [],
}: Props) {
  if (!dataUrl) return null;
  const boxed = items.filter((i) => i.bounding_box);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-black/50">
      <div className="relative w-full">
        {/* Frame en data URL: <img> plano evita pasar base64 por el optimizador. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt={label} className="h-auto w-full" />

        {boxed.map((item, idx) => {
          const b = item.bounding_box!;
          return (
            <motion.div
              key={`${item.name}-${idx}`}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: idx * 0.06, ease: "easeOut" }}
              className="pointer-events-none absolute rounded-md border-2 border-accent/85 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.width * 100}%`,
                height: `${b.height * 100}%`,
              }}
            >
              <span className="absolute -top-5 left-0 max-w-[16rem] truncate rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-canvas">
                {idx + 1} · {item.name}
              </span>
            </motion.div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[11px] text-ink-subtle">
        <span className="size-1.5 rounded-full bg-accent" />
        {label}
        {boxed.length > 0 && (
          <span className="text-ink-faint">
            · {boxed.length} objeto{boxed.length === 1 ? "" : "s"} localizado
            {boxed.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
