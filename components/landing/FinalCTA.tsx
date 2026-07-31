"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, PlayCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/ui";
import { FadeIn } from "@/components/motion";

/**
 * Cierre de la landing.
 *
 * El CTA auditado ofrecía `Panel de operaciones` como acción secundaria: el
 * último gesto que se le pedía a un visitante era entrar en la administración
 * del sistema. Aquí las dos salidas son de producto —abrir el estudio con
 * contenido propio, o ver la demo guiada— y el titular pide algo concreto y
 * comprobable en lugar de "empieza ahora".
 */

export function FinalCTA() {
  const t = useTranslations("landing.finalCta");
  const reduce = useReducedMotion();

  return (
    <section className="relative py-16 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="panel relative overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-18">
            <div aria-hidden className="absolute inset-0 grid-backdrop mask-fade opacity-40" />
            <div
              aria-hidden
              className="absolute -bottom-32 left-1/2 size-[34rem] -translate-x-1/2 rounded-full blur-[120px]"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in oklab, var(--color-brand) 55%, transparent) 0%, transparent 70%)",
                opacity: 0.5,
              }}
            />

            <div className="relative">
              <h2 className="display mx-auto max-w-2xl text-3xl text-ink sm:text-[2.75rem]">
                {t("heading")}
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-ink-muted">
                {t("description")}
              </p>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
              >
                <ButtonLink href="/studio" variant="primary" size="lg" className="w-full sm:w-auto">
                  {t("primary")}
                  <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
                <ButtonLink href="/demo" variant="secondary" size="lg" className="w-full sm:w-auto">
                  <PlayCircle className="size-4" aria-hidden />
                  {t("secondary")}
                </ButtonLink>
              </motion.div>

              <p className="mt-6 text-[11px] text-ink-faint">{t("note")}</p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
