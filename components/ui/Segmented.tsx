"use client";

import { motion } from "motion/react";
import { useId } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";

/**
 * Control segmentado con indicador animado (layoutId compartido). Sustituye a
 * los grupos de botones que se pintaban a mano: un solo componente para las
 * pestañas del estudio, los filtros del admin y los toggles de vista.
 */

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Contador opcional a la derecha (nº de resultados, jobs…). */
  count?: number;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ariaLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  // layoutId debe ser único por instancia: si dos controles compartieran id,
  // el indicador "volaría" de uno a otro.
  const layoutId = useId();

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-line bg-surface-2/70 p-1",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors",
              size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-[13px]",
              active ? "text-white" : "text-ink-subtle hover:text-ink"
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-linear-to-b from-brand-bright to-brand shadow-[0_6px_18px_-8px_rgba(109,94,252,0.9)]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {Icon && <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />}
              {option.label}
              {option.count != null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] tabular-nums",
                    active ? "bg-white/20 text-white" : "bg-white/[0.06] text-ink-subtle"
                  )}
                >
                  {option.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
