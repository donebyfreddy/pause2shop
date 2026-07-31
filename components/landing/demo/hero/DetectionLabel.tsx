"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { ACCENT_CLASSES, type HeroDemoAccent } from "@/lib/landing/heroDemo";

/**
 * Etiqueta de una detección: nombre del objeto y confianza.
 *
 * Va anclada arriba a la izquierda de la caja salvo que la caja empiece muy
 * arriba, en cuyo caso baja al interior — una etiqueta cortada por el borde
 * superior del frame es el defecto clásico de estos overlays.
 */
export function DetectionLabel({
  label,
  confidence,
  accent,
  active,
  below,
}: {
  readonly label: string;
  readonly confidence: number;
  readonly accent: HeroDemoAccent;
  readonly active: boolean;
  /** Colocar la etiqueta DENTRO de la caja, por falta de sitio arriba. */
  readonly below: boolean;
}) {
  const tone = ACCENT_CLASSES[accent];

  return (
    <motion.span
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
      className={cn(
        "absolute left-0 z-10 flex max-w-[90%] items-center gap-1.5 rounded-md px-1.5 py-0.5",
        "text-[9px] font-semibold whitespace-nowrap shadow-lg sm:text-[10px]",
        below ? "top-1" : "-top-[22px]",
        tone.bg,
        // Texto oscuro sobre los tres acentos: los tres son colores claros y
        // saturados, así que el contraste se consigue con tinta oscura.
        "text-canvas",
        active && tone.glow
      )}
    >
      <span className="truncate">{label}</span>
      <span className="tabular-nums opacity-75">
        {Math.round(confidence * 100)}%
      </span>
    </motion.span>
  );
}
