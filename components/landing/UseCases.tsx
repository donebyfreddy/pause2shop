"use client";

import { motion } from "motion/react";
import {
  Clapperboard,
  Compass,
  Layers,
  Presentation,
  ShoppingBag,
} from "lucide-react";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui";

/**
 * Casos de uso. Tarjeta grande destacada + rejilla: evita el clásico "cinco
 * tarjetas iguales" y deja claro cuál es el caso principal (VOD).
 */

const PRIMARY = {
  icon: Clapperboard,
  title: "VOD y vídeo bajo demanda",
  body: "Convierte un catálogo de vídeo en un catálogo de producto. Se analiza el vídeo completo, se deduplica lo que reaparece y se entrega la lista de productos con su timestamp de aparición.",
  points: [
    "Vídeos de hasta 2 minutos por job (configurable)",
    "Timestamp y frame de origen por producto",
    "Presupuesto de llamadas y coste por vídeo",
  ],
};

const SECONDARY = [
  {
    icon: Compass,
    title: "Descubrimiento de producto",
    body: "El usuario ve algo en pantalla y quiere saber qué es. Una imagen basta para arrancar la búsqueda.",
  },
  {
    icon: Layers,
    title: "Coincidencia con catálogo",
    body: "Cruza detecciones contra tu propio catálogo antes de salir a Internet: más precisión y coste menor.",
  },
  {
    icon: ShoppingBag,
    title: "Shopping visual",
    body: "Resultados comprables con precio, disponibilidad y enlace directo a la ficha de la tienda.",
  },
  {
    icon: Presentation,
    title: "Demos con cliente",
    body: "Modo presentación, panel de costes y datos de ejemplo listos para enseñar sin depender de credenciales.",
  },
];

export function UseCases() {
  return (
    <section className="relative py-24 sm:py-28">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">
            Casos de uso
          </p>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">
            Pensado para catálogos de vídeo, no para una foto suelta
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <RevealItem>
            <motion.article
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="panel group relative h-full overflow-hidden p-7"
            >
              <div
                aria-hidden
                className="absolute -top-24 -right-24 size-64 rounded-full bg-brand/20 blur-3xl transition-opacity duration-500 group-hover:opacity-150"
              />
              <div className="relative">
                <span className="grid size-11 place-items-center rounded-xl border border-brand/30 bg-brand/12">
                  <PRIMARY.icon className="size-5 text-brand-bright" aria-hidden />
                </span>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">
                  {PRIMARY.title}
                </h3>
                <p className="mt-3 max-w-md text-[13px] leading-relaxed text-ink-muted">
                  {PRIMARY.body}
                </p>
                <ul className="mt-6 space-y-2.5">
                  {PRIMARY.points.map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-[13px] text-ink-muted">
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
                      />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.article>
          </RevealItem>

          <RevealGroup className="grid gap-4 sm:grid-cols-2">
            {SECONDARY.map((item) => (
              <RevealItem key={item.title}>
                <motion.article
                  whileHover={{ y: -3 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  className="panel h-full p-5 transition-colors hover:border-line-strong"
                >
                  <span className="grid size-9 place-items-center rounded-lg border border-line bg-white/[0.03]">
                    <item.icon className="size-4 text-ink-muted" aria-hidden />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">{item.body}</p>
                </motion.article>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </div>
    </section>
  );
}
