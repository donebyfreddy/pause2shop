"use client";

import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import {
  Armchair,
  Car,
  Check,
  Flower2,
  Footprints,
  Gauge,
  Laptop,
  Layers,
  ShoppingBag,
  Shirt,
  Sparkles,
  Watch,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import type {
  AnalysisCategory,
  AnalysisIntensity,
  ProductMatchingMode,
  VideoAnalysisConfig,
} from "@/lib/types";
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS_ES,
  deriveAnalysisConfig,
} from "@/lib/analysis/categories";
import MatchingSourceSelector from "@/components/MatchingSourceSelector";
import { useMatchingCapabilities } from "@/hooks/useMatchingCapabilities";
import { Callout, SectionLabel } from "@/components/ui";
import { cn } from "@/lib/ui/cn";

/**
 * Bloque OBLIGATORIO antes de analizar: el usuario elige qué categorías detectar
 * y con qué intensidad. La selección se convierte en un VideoAnalysisConfig (con
 * `personCentric` derivado) que viaja al backend — no es estado decorativo, y
 * eso se refleja en la UI mostrando el modo derivado.
 */

const CATEGORY_ICONS: Record<AnalysisCategory, LucideIcon> = {
  clothing: Shirt,
  footwear: Footprints,
  watches_jewelry: Watch,
  bags_accessories: ShoppingBag,
  electronics: Laptop,
  vehicles: Car,
  furniture_home: Armchair,
  decoration: Flower2,
  all: Layers,
};

/** Icono por nivel de intensidad; label/hint se resuelven con i18n en el componente. */
const INTENSITY_ICON: Record<AnalysisIntensity, LucideIcon> = {
  fast: Zap,
  standard: Gauge,
  exhaustive: Sparkles,
};

/** Claves de mensajes (namespace studio.configSelector.intensity) por nivel. */
const INTENSITY_KEY = {
  fast: { label: "intensity.fast.label", hint: "intensity.fast.hint" },
  standard: { label: "intensity.standard.label", hint: "intensity.standard.hint" },
  exhaustive: { label: "intensity.exhaustive.label", hint: "intensity.exhaustive.hint" },
} as const;

type Props = {
  config: VideoAnalysisConfig;
  onChange: (config: VideoAnalysisConfig) => void;
  /** true cuando el análisis ya está en curso (bloquea cambios). */
  locked?: boolean;
  /** El pipeline fija catálogo primero, pero categorías/intensidad siguen editables. */
  matchingModeLocked?: boolean;
};

export default function AnalysisConfigSelector({
  config,
  onChange,
  locked,
  matchingModeLocked,
}: Props) {
  const t = useTranslations("studio.configSelector");
  const capabilities = useMatchingCapabilities();
  const selected = useMemo(() => new Set(config.categories), [config.categories]);
  const allSelected = selected.has("all");

  function setCategories(next: AnalysisCategory[]) {
    // La fuente de coincidencias se conserva al tocar categorías: es una
    // decisión independiente y perderla en cada clic sería desconcertante.
    onChange(
      deriveAnalysisConfig(next, config.analysisIntensity, {
        matchingMode: config.matchingMode,
      })
    );
  }

  function toggleCategory(cat: AnalysisCategory) {
    if (locked) return;
    if (cat === "all") {
      setCategories(allSelected ? ["clothing"] : ["all"]);
      return;
    }
    const next = new Set(selected);
    next.delete("all");
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    const arr = [...next] as AnalysisCategory[];
    // Nunca dejamos la selección vacía: sin categorías no habría nada que buscar.
    setCategories(arr.length ? arr : ["clothing"]);
  }

  function setIntensity(intensity: AnalysisIntensity) {
    if (locked) return;
    onChange(
      deriveAnalysisConfig(config.categories, intensity, {
        matchingMode: config.matchingMode,
      })
    );
  }

  function setMatchingMode(matchingMode: ProductMatchingMode) {
    if (locked) return;
    onChange(
      deriveAnalysisConfig(config.categories, config.analysisIntensity, {
        matchingMode,
      })
    );
  }

  const activeCount = allSelected ? ALL_CATEGORIES.length : selected.size;

  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {t("title")}
          </h3>
          <p className="mt-1 text-xs text-ink-subtle">
            {t("subtitle")}
          </p>
        </div>
        <span className="rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[11px] text-ink-muted tabular-nums">
          {t("activeCount", { count: activeCount })}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[...ALL_CATEGORIES, "all" as AnalysisCategory].map((cat) => {
          const active = cat === "all" ? allSelected : selected.has(cat);
          const Icon = CATEGORY_ICONS[cat];
          return (
            <button
              key={cat}
              type="button"
              disabled={locked}
              onClick={() => toggleCategory(cat)}
              aria-pressed={active}
              className={cn(
                "group relative inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-all duration-200 disabled:opacity-45",
                active
                  ? "border-brand/50 bg-brand/15 text-ink shadow-[0_0_0_1px_rgba(109,94,252,0.25),0_6px_18px_-10px_rgba(109,94,252,0.8)]"
                  : "border-line bg-white/[0.02] text-ink-subtle hover:border-line-strong hover:text-ink"
              )}
            >
              {active ? (
                <motion.span
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 26 }}
                  className="grid size-4 place-items-center rounded-full bg-brand-bright"
                >
                  <Check className="size-2.5 text-white" aria-hidden />
                </motion.span>
              ) : (
                <Icon className="size-4 text-ink-faint transition-colors group-hover:text-ink-muted" aria-hidden />
              )}
              {CATEGORY_LABELS_ES[cat]}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <SectionLabel>{t("intensityLabel")}</SectionLabel>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {(Object.keys(INTENSITY_ICON) as AnalysisIntensity[]).map((intensity) => {
            const active = config.analysisIntensity === intensity;
            const Icon = INTENSITY_ICON[intensity];
            const label = t(INTENSITY_KEY[intensity].label);
            const hint = t(INTENSITY_KEY[intensity].hint);
            return (
              <button
                key={intensity}
                type="button"
                disabled={locked}
                onClick={() => setIntensity(intensity)}
                aria-pressed={active}
                className={cn(
                  "relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all duration-200 disabled:opacity-45",
                  active
                    ? "border-accent/45 bg-accent/8"
                    : "border-line bg-white/[0.02] hover:border-line-strong"
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon
                    className={cn("size-4", active ? "text-accent" : "text-ink-faint")}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "text-[13px] font-semibold",
                      active ? "text-ink" : "text-ink-muted"
                    )}
                  >
                    {label}
                  </span>
                </span>
                <span className="text-[10px] leading-snug text-ink-subtle">{hint}</span>
                {active && (
                  <motion.span
                    layoutId="intensity-active"
                    className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fuente de coincidencias: vive AQUÍ para que toda superficie que use
          este bloque (estudio de imagen, estudio de vídeo, frame pausado y
          demo) tenga exactamente el mismo selector, sin copias del JSX. */}
      <MatchingSourceSelector
        value={config.matchingMode}
        onChange={setMatchingMode}
        locked={locked || matchingModeLocked}
        capabilities={capabilities}
      />

      {/* El modo person-centric es DERIVADO: se muestra para que no sorprenda. */}
      {config.personCentric && (
        <Callout tone="brand" icon={Shirt} className="mt-4">
          Modo centrado en personas: se analizan las prendas y complementos que llevan o
          sostienen las personas, y se ignora el fondo de la escena.
        </Callout>
      )}
    </div>
  );
}
