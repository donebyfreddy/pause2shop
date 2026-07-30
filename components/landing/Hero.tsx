"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, LayoutGrid, PlayCircle } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui";
import { Aurora } from "./Aurora";
import { HeroVisual } from "./HeroVisual";

/**
 * Hero de la landing. `Prueba ahora` hace scroll suave a la sección del estudio
 * (que se monta en la misma página), y hay ruta directa `/studio` para enlaces
 * profundos y para quien llega con la intención ya formada.
 */

const WORDS = ["Pausa", "el", "vídeo."];

export function Hero({
  stats,
}: {
  stats: Array<{ value: string; label: string }>;
}) {
  const reduce = useReducedMotion();

  const scrollToStudio = () => {
    document.getElementById("studio")?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <section className="relative isolate overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-28">
      <Aurora intense />

      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-[11px] text-ink-muted backdrop-blur-sm"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-70" />
              <span className="relative size-1.5 rounded-full bg-accent" />
            </span>
            Detección visual de producto en vídeo, en tiempo real
          </motion.div>

          <h1 className="display mt-6 text-[2.75rem] text-ink sm:text-6xl lg:text-7xl">
            <span className="block">
              {WORDS.map((word, i) => (
                <motion.span
                  key={word + i}
                  initial={{ opacity: 0, y: reduce ? 0 : 24, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.7, delay: 0.1 + i * 0.09, ease: [0.22, 0.61, 0.36, 1] }}
                  className="mr-[0.28em] inline-block"
                >
                  {word}
                </motion.span>
              ))}
            </span>
            <motion.span
              initial={{ opacity: 0, y: reduce ? 0 : 24, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.8, delay: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
              className="text-gradient mt-1 block"
            >
              Encuentra el producto.
            </motion.span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
            className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-ink-muted sm:text-base"
          >
            Pause2Shop analiza vídeo e imagen, detecta cada prenda, calzado o accesorio
            y lo cruza contra un catálogo de moda propio y búsqueda visual inversa.
            Con procedencia y confianza en cada resultado.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.68 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
            <Button variant="primary" size="lg" onClick={scrollToStudio}>
              Prueba ahora
              <ArrowRight className="size-4" aria-hidden />
            </Button>
            <ButtonLink href="/catalog" variant="secondary" size="lg">
              <LayoutGrid className="size-4" aria-hidden />
              Ver catálogo
            </ButtonLink>
            <ButtonLink href="/demo" variant="ghost" size="lg">
              <PlayCircle className="size-4" aria-hidden />
              Ver demo
            </ButtonLink>
          </motion.div>
        </div>

        <div className="mt-16 sm:mt-20">
          <HeroVisual />
        </div>

        {/* Cifras reales del servicio: si está caído, el server component pasa
            los valores de reserva y se dice explícitamente. */}
        <motion.dl
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 1.1 }}
          className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="bg-canvas-raised px-5 py-5 text-center">
              <dt className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
                {stat.label}
              </dt>
              <dd className="mt-1.5 text-2xl font-semibold tracking-tight text-ink tabular-nums">
                {stat.value}
              </dd>
            </div>
          ))}
        </motion.dl>
      </div>
    </section>
  );
}
