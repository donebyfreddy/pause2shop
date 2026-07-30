"use client";

import { motion } from "motion/react";
import { Skeleton } from "@/components/ui";

/**
 * Estado de carga del análisis. Además del skeleton, muestra la etapa del
 * pipeline en la que estamos: es información real del sistema y evita la
 * sensación de "la app se ha quedado colgada" en los 2–3 s de detección.
 */

const STAGES = [
  "Capturando el frame",
  "Detectando objetos",
  "Recortando y deduplicando",
  "Buscando coincidencias",
] as const;

export default function LoadingAnalysis() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Analizando frame">
      <div className="overflow-hidden rounded-xl border border-brand/25 bg-brand/8 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex size-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-bright opacity-60" />
            <span className="relative size-2.5 rounded-full bg-brand-bright" />
          </span>
          <span className="text-[13px] font-medium text-brand-bright">
            Analizando el frame…
          </span>
        </div>

        <ul className="mt-3 space-y-1.5">
          {STAGES.map((stage, i) => (
            <motion.li
              key={stage}
              initial={{ opacity: 0.25 }}
              animate={{ opacity: [0.25, 1, 0.35] }}
              transition={{
                duration: 1.6,
                delay: i * 0.45,
                repeat: Infinity,
                repeatDelay: STAGES.length * 0.45 - 1.6,
              }}
              className="flex items-center gap-2 text-[11px] text-ink-muted"
            >
              <span aria-hidden className="size-1 rounded-full bg-current" />
              {stage}
            </motion.li>
          ))}
        </ul>

        <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-brand/15">
          <motion.div
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            className="h-full w-1/2 rounded-full bg-linear-to-r from-transparent via-brand-bright to-transparent"
          />
        </div>
      </div>

      {[0, 1, 2].map((i) => (
        <div key={i} className="panel p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="mb-2 h-2.5 w-full" />
          <Skeleton className="mb-4 h-2.5 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
