"use client";

import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { ArrowUpRight, Loader } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ButtonLink, SectionLabel } from "@/components/ui";

/**
 * Sección del estudio dentro de la landing.
 *
 * El estudio arrastra el reproductor, los hooks de captura y la cola de
 * matching: montarlo con la landing penalizaría el primer render de una página
 * que la mayoría solo va a leer. Así que se carga en dos condiciones:
 *
 *  1. cuando la sección entra (o casi entra) en viewport, o
 *  2. inmediatamente si la URL ya trae `#studio` (venimos de un CTA directo).
 */

const StudioExperience = dynamic(() => import("@/components/studio/StudioExperience"), {
  ssr: false,
  loading: () => <StudioSkeleton />,
});

function StudioSkeleton() {
  return (
    <div className="panel flex min-h-[420px] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader className="size-5 animate-spin text-brand-bright" aria-hidden />
        <p className="text-xs text-ink-subtle">Cargando el estudio de análisis…</p>
      </div>
    </div>
  );
}

export function StudioSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // `observe()` dispara un callback inicial con el estado actual, así que si
    // llegamos con la URL en #studio (el navegador ya ha hecho scroll) monta
    // de inmediato. No hace falta leer window.location aparte.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      // Se precarga 600 px antes de ser visible: al llegar ya está listo.
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="studio"
      ref={ref}
      className="relative scroll-mt-16 border-t border-line bg-canvas-raised py-16 sm:py-20"
    >
      <div aria-hidden className="absolute inset-0 grid-backdrop mask-fade-b opacity-30" />

      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="mb-8 flex flex-wrap items-end justify-between gap-4"
        >
          <div>
            <SectionLabel className="text-accent">El estudio</SectionLabel>
            <h2 className="display mt-2.5 text-3xl text-ink sm:text-4xl">
              Analiza un vídeo o una imagen ahora
            </h2>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-muted">
              Elige categorías e intensidad, carga el contenido y observa las detecciones y
              coincidencias en tiempo real.
            </p>
          </div>
          <ButtonLink href="/studio" variant="outline" size="sm">
            Abrir en pantalla completa
            <ArrowUpRight className="size-3.5" aria-hidden />
          </ButtonLink>
        </motion.div>

        {mounted ? <StudioExperience variant="embedded" /> : <StudioSkeleton />}
      </div>
    </section>
  );
}
