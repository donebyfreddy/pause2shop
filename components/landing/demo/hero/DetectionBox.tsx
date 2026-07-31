"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import {
  ACCENT_CLASSES,
  type HeroDemoAccent,
  type RelativeBoundingBox,
} from "@/lib/landing/heroDemo";
import { DetectionLabel } from "./DetectionLabel";

/**
 * Una caja de detección: recuadro, esquinas de mira y etiqueta.
 *
 * Es un `<button>` de verdad, no un div con `onClick`: la sincronía caja ↔
 * tarjeta tiene que funcionar con teclado, y `aria-pressed` es lo que anuncia
 * cuál está seleccionada. Con un div habría que reinventar foco, Enter y
 * Space, y normalmente se reinventan mal.
 */
export function DetectionBox({
  bbox,
  accent,
  label,
  confidence,
  active,
  ariaLabel,
  onSelect,
  onHover,
  delay,
}: {
  readonly bbox: RelativeBoundingBox;
  readonly accent: HeroDemoAccent;
  readonly label: string;
  readonly confidence: number;
  readonly active: boolean;
  readonly ariaLabel: string;
  readonly onSelect: () => void;
  readonly onHover: () => void;
  readonly delay: number;
}) {
  const tone = ACCENT_CLASSES[accent];

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
      transition={{ duration: 0.28, delay, ease: [0.22, 0.61, 0.36, 1] }}
      style={{
        left: `${bbox.x}%`,
        top: `${bbox.y}%`,
        width: `${bbox.width}%`,
        height: `${bbox.height}%`,
      }}
      onClick={onSelect}
      onMouseEnter={onHover}
      onFocus={onHover}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        "group absolute cursor-pointer rounded-lg border-2 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        tone.border,
        active ? cn("bg-white/[0.06]", tone.glow) : "border-opacity-70 bg-white/[0.02]"
      )}
    >
      {/* Esquinas: leen como mira de cámara y no como el borde de una caja. */}
      {["-top-px -left-px", "-top-px -right-px", "-bottom-px -left-px", "-bottom-px -right-px"].map(
        (pos) => (
          <span
            key={pos}
            aria-hidden
            className={cn("absolute size-1.5 rounded-[2px] sm:size-2", pos, tone.dot)}
          />
        )
      )}

      <DetectionLabel
        label={label}
        confidence={confidence}
        accent={accent}
        active={active}
        // Sin sitio arriba: la etiqueta se metería fuera del frame.
        below={bbox.y < 8}
      />
    </motion.button>
  );
}
