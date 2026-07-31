"use client";

import { motion } from "motion/react";
import { Check, EyeOff, ShieldQuestion, SlidersHorizontal } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { DEMO_SCENES } from "@/lib/landing/demoScene";
import { cn } from "@/lib/ui/cn";
import { SectionLabel } from "@/components/ui";
import { FadeIn } from "@/components/motion";

/**
 * Precisión, umbral y control editorial.
 *
 * Responde a la primera pregunta de cualquier responsable de contenido —"¿qué
 * pasa cuando el sistema no está seguro?"— y lo hace con una demostración, no
 * con una promesa: el deslizador mueve el umbral de verdad y recalcula cómo se
 * reparten las coincidencias de la demo entre publicar, revisar y retener.
 *
 * Usa los MISMOS datos que el hero y la demo interactiva
 * (`lib/landing/demoScene.ts`), así que los números que salen aquí son
 * consistentes con lo que el visitante acaba de ver más arriba. Si se cambia una
 * puntuación en los datos, esta sección se mueve con ella.
 *
 * Lo que NO afirma: automatización total. El estado intermedio existe y se
 * enseña, porque existe en el producto.
 */

/** Margen bajo el umbral que se envía a revisión en vez de descartarse. */
const REVIEW_BAND = 20;

const ALL_SCORES = DEMO_SCENES.flatMap((scene) =>
  scene.matches.map((match) => Math.round(match.score * 100))
);

const ZONES = [
  {
    key: "high",
    icon: Check,
    accent: "text-success",
    border: "border-success/35",
    bg: "bg-success/[0.07]",
    dot: "bg-success",
  },
  {
    key: "medium",
    icon: ShieldQuestion,
    accent: "text-warning",
    border: "border-warning/35",
    bg: "bg-warning/[0.07]",
    dot: "bg-warning",
  },
  {
    key: "low",
    icon: EyeOff,
    accent: "text-ink-subtle",
    border: "border-line-strong",
    bg: "bg-white/[0.02]",
    dot: "bg-ink-faint",
  },
] as const;

const CONTROL_KEYS = ["score", "brandRules", "allowlist", "audit", "feedback"] as const;
const QUALITY_KEYS = ["recall", "precision", "coverage", "published"] as const;

export function ConfidenceSection() {
  const t = useTranslations("landing.confidence");
  const [threshold, setThreshold] = useState(75);
  const sliderId = useId();

  const counts = useMemo(() => {
    let published = 0;
    let review = 0;
    let withheld = 0;
    for (const score of ALL_SCORES) {
      if (score >= threshold) published += 1;
      else if (score >= threshold - REVIEW_BAND) review += 1;
      else withheld += 1;
    }
    return { published, review, withheld, total: ALL_SCORES.length };
  }, [threshold]);

  const reviewFloor = Math.max(0, threshold - REVIEW_BAND);

  return (
    <section id="precision" className="relative scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <SectionLabel className="text-accent">{t("label")}</SectionLabel>
          <h2 className="display mt-3 text-3xl text-ink sm:text-5xl">{t("heading")}</h2>
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            {t("description")}
          </p>
        </FadeIn>

        {/* ------------------------- control del umbral ------------------------ */}
        <FadeIn delay={0.08} className="mt-12">
          <div className="panel mx-auto max-w-3xl p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label
                htmlFor={sliderId}
                className="inline-flex items-center gap-2 text-[13px] font-medium text-ink"
              >
                <SlidersHorizontal className="size-4 text-brand-bright" aria-hidden />
                {t("slider.label")}
              </label>
              <output
                htmlFor={sliderId}
                className="font-mono text-sm font-semibold text-accent tabular-nums"
              >
                {threshold}%
              </output>
            </div>

            {/* Eje de confianza: las tres zonas, a escala, con el umbral encima. */}
            <div className="relative mt-5 h-9">
              <div className="absolute inset-x-0 top-2.5 flex h-3 overflow-hidden rounded-full">
                <div
                  className="bg-ink-faint/25 transition-all duration-200"
                  style={{ width: `${reviewFloor}%` }}
                />
                <div
                  className="bg-warning/35 transition-all duration-200"
                  style={{ width: `${threshold - reviewFloor}%` }}
                />
                <div
                  className="bg-linear-to-r from-success/40 to-success/60 transition-all duration-200"
                  style={{ width: `${100 - threshold}%` }}
                />
              </div>

              {/* Marcas de las coincidencias de la demo sobre el eje. */}
              {ALL_SCORES.map((score, i) => (
                <span
                  key={`${score}-${i}`}
                  aria-hidden
                  className={cn(
                    "absolute top-1 size-2 -translate-x-1/2 rounded-full ring-2 ring-canvas transition-colors duration-200",
                    score >= threshold
                      ? "bg-success"
                      : score >= reviewFloor
                        ? "bg-warning"
                        : "bg-ink-faint"
                  )}
                  style={{ left: `${score}%` }}
                />
              ))}

              <input
                id={sliderId}
                type="range"
                min={50}
                max={95}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                aria-describedby={`${sliderId}-desc`}
                className="absolute inset-x-0 top-1.5 h-5 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-canvas [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-lg [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-canvas [&::-moz-range-thumb]:bg-accent"
              />
            </div>

            {/* Resultado del reparto. `aria-live` porque cambia sin recargar y es
                el dato que da sentido al control. */}
            <dl
              id={`${sliderId}-desc`}
              aria-live="polite"
              className="mt-5 grid grid-cols-3 gap-2.5"
            >
              {/* `as const` para que `item.key` sea una unión de literales: sin
                  él el tipo es `string`, la clave de traducción queda como
                  `outcome.${string}` y `next-intl` no puede verificarla. */}
              {([
                { key: "published", value: counts.published, cls: "text-success" },
                { key: "review", value: counts.review, cls: "text-warning" },
                { key: "withheld", value: counts.withheld, cls: "text-ink-subtle" },
              ] as const).map((item) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-line bg-white/[0.02] px-3 py-3 text-center"
                >
                  <dd className={cn("text-2xl font-semibold tabular-nums", item.cls)}>
                    <motion.span
                      key={item.value}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="inline-block"
                    >
                      {item.value}
                    </motion.span>
                    <span className="text-sm font-normal text-ink-faint">/{counts.total}</span>
                  </dd>
                  <dt className="mt-1 text-[11px] leading-snug text-ink-muted">
                    {t(`outcome.${item.key}`)}
                  </dt>
                </div>
              ))}
            </dl>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">
              {t("slider.note", { total: counts.total })}
            </p>
          </div>
        </FadeIn>

        {/* ---------------------------- las tres zonas ------------------------- */}
        <div className="mt-10 grid gap-3 lg:grid-cols-3">
          {ZONES.map((zone, i) => {
            const Icon = zone.icon;
            return (
              <FadeIn key={zone.key} delay={0.06 * i}>
                <div className={cn("h-full rounded-2xl border p-5", zone.border, zone.bg)}>
                  <div className="flex items-center gap-2.5">
                    <Icon className={cn("size-4 shrink-0", zone.accent)} aria-hidden />
                    <h3 className="text-sm font-semibold text-ink">{t(`zones.${zone.key}.title`)}</h3>
                  </div>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-ink-muted">
                    {t(`zones.${zone.key}.body`)}
                  </p>
                  <p className="mt-3 font-mono text-[11px] text-ink-subtle">
                    {t(`zones.${zone.key}.rule`)}
                  </p>
                </div>
              </FadeIn>
            );
          })}
        </div>

        {/* -------------------- controles + calidad medible -------------------- */}
        <FadeIn delay={0.1} className="mt-10 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="panel p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-ink">{t("controls.title")}</h3>
            <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {CONTROL_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-2.5 text-[13px] text-ink-muted">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-bright" />
                  {t(`controls.${key}`)}
                </li>
              ))}
            </ul>
          </div>

          <div className="panel p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-ink">{t("quality.title")}</h3>
            <dl className="mt-4 space-y-3">
              {QUALITY_KEYS.map((key) => (
                <div key={key}>
                  <dt className="text-[12px] font-medium text-ink">{t(`quality.${key}.term`)}</dt>
                  <dd className="mt-0.5 text-[11px] leading-relaxed text-ink-subtle">
                    {t(`quality.${key}.definition`)}
                  </dd>
                </div>
              ))}
            </dl>
            {/* Nota honesta: definimos las métricas, no publicamos valores que
                no se han medido en un conjunto acordado con el cliente. */}
            <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
              {t("quality.note")}
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
