"use client";

import { useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Database, GitCompare, Globe, Route } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MatchingCapabilities } from "@/lib/matching/capabilities";
import { MATCHING_MODES } from "@/lib/matching/types";
import type { ProductMatchingMode } from "@/lib/types";
import { SectionLabel } from "@/components/ui";
import { cn } from "@/lib/ui/cn";

/**
 * Selector ÚNICO de "Fuente de coincidencias". Se monta en todas las
 * superficies de análisis (imagen, vídeo, frame pausado, demo) a través de
 * AnalysisConfigSelector: no hay una copia del JSX por página.
 *
 * La opción recomendada es `catalog_first` porque intenta resolver dentro del
 * catálogo propio y solo gasta una llamada externa cuando no encuentra una
 * coincidencia suficientemente fiable.
 */

const RECOMMENDED: ProductMatchingMode = "catalog_first";

const MODE_ICON: Record<ProductMatchingMode, LucideIcon> = {
  catalog_only: Database,
  external_only: Globe,
  catalog_first: Route,
  catalog_and_external: GitCompare,
};

/**
 * Claves i18n LITERALES (namespace studio.matchingSource). next-intl tipa las
 * claves, así que una plantilla `modes.${x}.label` no compila: se escriben
 * enteras para que un typo lo cace el compilador y no el usuario.
 */
const MODE_KEY = {
  catalog_only: {
    label: "modes.catalogOnly.label",
    description: "modes.catalogOnly.description",
    benefits: "modes.catalogOnly.benefits",
  },
  external_only: {
    label: "modes.externalOnly.label",
    description: "modes.externalOnly.description",
    benefits: "modes.externalOnly.benefits",
  },
  catalog_first: {
    label: "modes.catalogFirst.label",
    description: "modes.catalogFirst.description",
    benefits: "modes.catalogFirst.benefits",
  },
  catalog_and_external: {
    label: "modes.catalogAndExternal.label",
    description: "modes.catalogAndExternal.description",
    benefits: "modes.catalogAndExternal.benefits",
  },
} as const;

type Props = {
  value: ProductMatchingMode;
  onChange: (mode: ProductMatchingMode) => void;
  /** true cuando el análisis está en curso: no se puede cambiar de fuente. */
  locked?: boolean;
  /** Disponibilidad real de cada fuente; sin ella no se deshabilita nada. */
  capabilities?: MatchingCapabilities | null;
};

export default function MatchingSourceSelector({
  value,
  onChange,
  locked,
  capabilities,
}: Props) {
  const t = useTranslations("studio.matchingSource");
  const groupId = useId();
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  function availability(mode: ProductMatchingMode) {
    const info = capabilities?.modes?.[mode];
    // Sin datos de capacidades (aún cargando o endpoint caído) no bloqueamos.
    if (!info) return { available: true, reason: null as string | null };
    return info;
  }

  /**
   * Flechas para moverse dentro del grupo, como un radiogroup nativo.
   * Los deshabilitados se saltan: parar el foco en una opción que no se puede
   * elegir es una trampa para quien navega con teclado.
   */
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const total = MATCHING_MODES.length;
    for (let step = 1; step <= total; step++) {
      const next = (((index + delta * step) % total) + total) % total;
      const mode = MATCHING_MODES[next];
      if (locked || availability(mode).available) {
        buttonsRef.current[next]?.focus();
        if (!locked) onChange(mode);
        return;
      }
    }
  }

  return (
    <section aria-labelledby={groupId} className="mt-5">
      <SectionLabel id={groupId}>{t("title")}</SectionLabel>
      <p className="mt-1 text-xs text-ink-subtle">{t("subtitle")}</p>

      <div
        role="radiogroup"
        aria-labelledby={groupId}
        className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {MATCHING_MODES.map((mode, index) => {
          const active = value === mode;
          const { available, reason } = availability(mode);
          const disabled = locked || !available;
          const Icon = MODE_ICON[mode];
          const key = MODE_KEY[mode];
          const label = t(key.label);
          const description = t(key.description);
          const benefits = t(key.benefits);
          const recommended = mode === RECOMMENDED;

          return (
            <button
              key={mode}
              ref={(el) => {
                buttonsRef.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              // Un solo tab-stop por grupo: se entra con Tab y se elige con flechas.
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(mode)}
              onKeyDown={(e) => onKeyDown(e, index)}
              // El motivo real llega por title (tooltip) y por texto visible
              // abajo, para no depender solo del hover.
              title={!available && reason ? reason : description}
              className={cn(
                "group relative flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bright/70",
                disabled && "cursor-not-allowed opacity-45",
                active
                  ? "border-brand/50 bg-brand/12"
                  : "border-line bg-white/[0.02] hover:border-line-strong"
              )}
            >
              {/* Fila reservada en LAS CUATRO tarjetas (vacía en las demás):
                  así el badge no desplaza ni solapa el título, y las cuatro
                  mantienen exactamente la misma altura. */}
              <span className="flex h-4 items-center">
                {recommended && (
                  <span className="rounded-full border border-success/40 bg-success/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-success">
                    {t("recommended")}
                  </span>
                )}
              </span>

              <span className="flex w-full items-start gap-2">
                <Icon
                  className={cn(
                    "mt-px size-4 shrink-0",
                    active ? "text-brand-bright" : "text-ink-faint"
                  )}
                  aria-hidden
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[13px] font-semibold leading-tight",
                    active ? "text-ink" : "text-ink-muted"
                  )}
                >
                  {label}
                </span>
              </span>

              <span className="text-[10px] leading-snug text-ink-subtle">
                {description}
              </span>

              {available ? (
                <span className="mt-auto pt-1 text-[10px] leading-snug text-ink-faint">
                  {benefits}
                </span>
              ) : (
                <span className="mt-auto pt-1 text-[10px] leading-snug text-warning">
                  {reason}
                </span>
              )}

              {active && (
                <motion.span
                  layoutId="matching-source-active"
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-bright"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
