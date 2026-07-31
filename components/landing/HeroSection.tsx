"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, LayoutGrid, PlayCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui";
import { RevealText } from "@/components/motion";
import { Aurora } from "./Aurora";
import { HeroProductDemo } from "./demo/HeroProductDemo";

/**
 * Primera pantalla.
 *
 * El objetivo medible es que la demo ENTRE en el primer viewport: en la versión
 * auditada el mockup empezaba a 620 px y se cortaba a un tercio, así que la
 * promesa "objeto → catálogo" no se veía nunca sin hacer scroll. Para
 * conseguirlo el bloque de copy está deliberadamente comprimido:
 *
 *  - el titular sube hasta `5xl` en escritorio, no `7xl`;
 *  - el párrafo va a `max-w-2xl` y dos líneas;
 *  - los CTAs no son tres botones iguales — hay uno principal, uno secundario y
 *    un enlace discreto, que además es lo que pedía la jerarquía.
 *
 * Presupuesto vertical a 1440×900 (836 px útiles bajo la cabecera):
 * eyebrow 28 + titular 108 + párrafo 56 + CTAs 48 + separaciones 96 ≈ 336 px de
 * copy, lo que deja ~500 px para el panel de la demo, que mide ~350 px.
 */

export function HeroSection() {
  const t = useTranslations("landing.hero");
  const locale = useLocale();
  const reduce = useReducedMotion();

  const scrollToDemo = () => {
    document.getElementById("demo")?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  };

  // Los ajustes `max-height` de abajo no son un adorno: un portátil de 1366×768
  // —que sigue siendo una resolución muy común en salas de reunión— solo tiene
  // 704 px bajo la cabecera, y con el ritmo de escritorio la demo se quedaba
  // fuera. Ahí el bloque de copy se comprime (menos aire arriba, titular más
  // pequeño, menos separación entre bloques) para devolver ~90 px al panel.
  // No se oculta nada: solo se aprieta.
  return (
    <section className="relative isolate overflow-hidden pt-6 pb-14 sm:pt-10 sm:pb-18 [@media(max-height:820px)]:pt-2 [@media(max-height:820px)]:pb-10">
      <Aurora intense />

      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* `max-w-4xl` y no `3xl`: con 3xl la segunda línea del titular partía en
            dos y dejaba "compra." sola en una tercera línea. */}
        <div className="mx-auto max-w-4xl text-center">
          <motion.p
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-ink-muted backdrop-blur-sm"
          >
            {/* El `animate-ping` es una animación CSS: la regla global de
                `prefers-reduced-motion` en globals.css ya la deja en 0,001 ms.
                No hace falta —ni se debe— condicionar el render. */}
            <span className="relative flex size-1.5" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-70" />
              <span className="relative size-1.5 rounded-full bg-accent" />
            </span>
            {t("eyebrow")}
          </motion.p>

          <h1 className="display mt-4 text-[2.5rem] text-ink sm:text-5xl lg:text-[3.5rem] [@media(max-height:820px)]:mt-3 [@media(max-height:820px)]:text-4xl">
            <RevealText text={t("titleLine1")} locale={locale} />
            <RevealText
              text={t("titleLine2")}
              locale={locale}
              delay={0.28}
              className="text-gradient mt-1 block"
            />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-muted sm:text-base [@media(max-height:820px)]:mt-3"
          >
            {t("description")}
          </motion.p>

          {/* Jerarquía explícita: un primario, un secundario y un terciario que
              es un enlace, no un tercer botón compitiendo por la atención.
              Los tres van en la MISMA fila en escritorio: en filas separadas
              costaban ~50 px de alto, y ese alto es justo lo que decide si el
              panel de la demo cabe entero en el primer viewport. */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.62 }}
            className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4 [@media(max-height:820px)]:mt-4"
          >
            <ButtonLink href="/studio" variant="primary" size="md" className="w-full sm:w-auto">
              {t("ctaPrimary")}
              <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
            <Button
              variant="secondary"
              size="md"
              onClick={scrollToDemo}
              className="w-full sm:w-auto"
            >
              <PlayCircle className="size-4" aria-hidden />
              {t("ctaSecondary")}
            </Button>
            <ButtonLink
              href="/catalog"
              variant="ghost"
              size="sm"
              className="text-ink-subtle hover:text-ink-muted"
            >
              <LayoutGrid className="size-3.5" aria-hidden />
              {t("ctaTertiary")}
            </ButtonLink>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
          className="mx-auto mt-6 w-full max-w-5xl sm:mt-8 [@media(max-height:820px)]:mt-5"
        >
          <HeroProductDemo />
        </motion.div>
      </div>
    </section>
  );
}
