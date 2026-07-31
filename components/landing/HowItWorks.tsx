"use client";

import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import {
  Boxes,
  Fingerprint,
  ScanSearch,
  Sparkles,
  Video,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal } from "@/components/ui";
import { cn } from "@/lib/ui/cn";

/**
 * Explicador del pipeline con interacción de scroll: una línea vertical se
 * rellena a medida que la sección avanza y cada paso se enciende al entrar.
 *
 * Los pasos son los REALES del sistema (captura → detección → crop/dedup →
 * matching → resultado), no una narrativa de marketing inventada.
 */

const STEP_ICONS = [Video, ScanSearch, Fingerprint, Boxes, Sparkles] as const;
const STEP_KEYS = ["capture", "detect", "dedupe", "match", "result"] as const;

export function HowItWorks() {
  const t = useTranslations("landing.howItWorks");
  const steps = STEP_KEYS.map((key, index) => ({
    key,
    icon: STEP_ICONS[index],
    title: t(`steps.${key}.title`),
    body: t(`steps.${key}.body`),
    meta: t(`steps.${key}.meta`),
  }));
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 70%", "end 60%"],
  });
  // Spring sobre el progreso: la línea no salta con el scroll por rueda.
  const lineHeight = useSpring(useTransform(scrollYProgress, [0, 1], ["0%", "100%"]), {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <section id="como-funciona" className="relative py-24 sm:py-32">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">
            {t("title")}
          </p>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">{t("heading")}</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">{t("description")}</p>
        </Reveal>

        <div ref={containerRef} className="relative mt-16 sm:mt-20">
          {/* raíl + progreso */}
          <div
            aria-hidden
            className="absolute top-2 bottom-2 left-[19px] w-px bg-line sm:left-1/2 sm:-translate-x-px"
          >
            <motion.div
              style={{ height: lineHeight }}
              className="w-px bg-linear-to-b from-brand-bright via-brand to-accent shadow-[0_0_12px_1px_rgba(109,94,252,0.6)]"
            />
          </div>

          <ol className="space-y-10 sm:space-y-14">
            {steps.map((step, index) => {
              const alignRight = index % 2 === 1;
              return (
                <li key={step.key} className="relative">
                  <div
                    className={cn(
                      "grid gap-6 sm:grid-cols-2 sm:items-center",
                      alignRight && "sm:[&>*:first-child]:col-start-2"
                    )}
                  >
                    <Reveal
                      y={26}
                      amount={0.5}
                      className={cn("pl-12 sm:pl-0", alignRight ? "sm:pl-14" : "sm:pr-14 sm:text-right")}
                    >
                      <div className="inline-flex items-center gap-2">
                        <span className="font-mono text-[11px] text-ink-faint">
                          0{index + 1}
                        </span>
                        <h3 className="text-base font-semibold text-ink">{step.title}</h3>
                      </div>
                      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                        {step.body}
                      </p>
                      <p
                        className={cn(
                          "mt-3 inline-flex flex-wrap gap-1.5",
                          alignRight ? "" : "sm:justify-end"
                        )}
                      >
                        {step.meta.split(" · ").map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink-subtle"
                          >
                            {tag}
                          </span>
                        ))}
                      </p>
                    </Reveal>
                  </div>

                  {/* nodo del raíl */}
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ type: "spring", stiffness: 320, damping: 22 }}
                    className="absolute top-0 left-0 sm:left-1/2 sm:-translate-x-1/2"
                  >
                    <span className="relative grid size-10 place-items-center rounded-xl border border-line-strong bg-surface-2 shadow-panel">
                      <span
                        aria-hidden
                        className="animate-pulse-ring absolute inset-0 rounded-xl border border-brand/40"
                      />
                      <step.icon className="size-4 text-brand-bright" aria-hidden />
                    </span>
                  </motion.div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
