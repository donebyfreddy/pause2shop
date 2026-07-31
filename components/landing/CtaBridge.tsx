"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, LayoutDashboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink, Reveal } from "@/components/ui";

/**
 * Puente hacia la herramienta. Cierra el discurso de la landing y baja al
 * estudio, que está montado en la misma página (#studio).
 */
export function CtaBridge() {
  const t = useTranslations("landing.cta");
  const reduce = useReducedMotion();

  return (
    <section className="relative py-24 sm:py-28">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <div className="panel relative overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-20">
            <div aria-hidden className="absolute inset-0 grid-backdrop mask-fade opacity-40" />
            <div
              aria-hidden
              className="animate-aurora absolute -bottom-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full blur-[120px]"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in oklab, var(--color-brand) 55%, transparent) 0%, transparent 70%)",
                opacity: 0.55,
              }}
            />

            <div className="relative">
              <h2 className="display mx-auto max-w-2xl text-3xl text-ink sm:text-5xl">
                {t("heading")}
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-ink-muted">
                {t("description")}
              </p>

              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() =>
                    document
                      .getElementById("studio")
                      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
                  }
                >
                  {t("action")}
                  <motion.span
                    animate={reduce ? {} : { y: [0, 3, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                    className="inline-flex"
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </motion.span>
                </Button>
                <ButtonLink href="/admin" variant="secondary" size="lg">
                  <LayoutDashboard className="size-4" aria-hidden />
                  {t("operationsPanel")}
                </ButtonLink>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
