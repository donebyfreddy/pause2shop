"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Progreso del matching de un objeto.
 *
 * Sustituye al esqueleto estático anterior. El problema que resuelve no es
 * estético: un esqueleto que no cambia durante segundos es indistinguible de
 * una UI colgada, y el usuario no puede saber si merece la pena esperar. Aquí
 * se dice la ETAPA en curso y se cronometra desde que empezó.
 *
 * El cronómetro es tiempo real medido, no una barra falsa que avanza sola:
 * cuando la búsqueda tarda de más, el número lo delata en vez de disimularlo.
 */

const PHASE_KEY = {
  queued: "queued",
  cropping: "cropping",
  searching: "searching",
} as const;

export type MatchingPhase = keyof typeof PHASE_KEY;

/** Etapas en orden, para pintar cuántas se llevan. */
const ORDER: MatchingPhase[] = ["queued", "cropping", "searching"];

export function MatchingProgress({
  stage,
  phase,
  startedAt,
  className,
}: {
  readonly stage: "catalog" | "external";
  /** Etapa en curso. Sin ella se pinta solo el esqueleto. */
  readonly phase?: MatchingPhase;
  /** Marca de inicio (`Date.now()`), para el cronómetro. */
  readonly startedAt?: number;
  readonly className?: string;
}) {
  const t = useTranslations("studio.matching.progress");
  const isCatalog = stage === "catalog";

  // Un tick por décima: suficiente para que se vea vivo sin repintar de más.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : null;
  const stepIndex = phase ? ORDER.indexOf(phase) : -1;

  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        isCatalog
          ? "border-brand/25 bg-brand/[0.06]"
          : "border-accent/25 bg-accent/[0.05]",
        className
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p
          className={cn(
            "text-[11px] font-semibold",
            isCatalog ? "text-brand-bright" : "text-accent"
          )}
        >
          {phase ? t(PHASE_KEY[phase]) : t(isCatalog ? "catalog" : "external")}
        </p>
        {elapsedMs != null && (
          <span className="font-mono text-[10px] text-ink-faint tabular-nums">
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Etapas discretas: se ve cuál se ha completado y cuál está en curso.
          Es información real —el cliente sabe en qué paso está—, no una
          animación decorativa. */}
      {phase && (
        <div className="mb-2.5 flex gap-1" aria-hidden>
          {ORDER.map((p, i) => (
            <span
              key={p}
              className={cn(
                "h-0.5 flex-1 rounded-full transition-colors duration-300",
                i < stepIndex && (isCatalog ? "bg-brand-bright/70" : "bg-accent/70"),
                i === stepIndex &&
                  cn("animate-pulse", isCatalog ? "bg-brand-bright" : "bg-accent"),
                i > stepIndex && "bg-white/[0.08]"
              )}
            />
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <div className="size-16 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="min-w-0 flex-1 space-y-2 py-1">
          <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.04]" />
        </div>
      </div>
    </div>
  );
}

export default MatchingProgress;
