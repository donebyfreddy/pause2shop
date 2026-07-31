"use client";

import { Boxes, Clock, GitPullRequestArrow, Layers, SlidersHorizontal, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { FadeIn, StaggerGroup, StaggerItem } from "@/components/motion";

/**
 * Franja de prueba tras el hero.
 *
 * Dos registros distintos y deliberadamente separados:
 *
 *  1. **Capacidades verificables** — afirmaciones sobre lo que el sistema HACE.
 *     No llevan número porque no lo necesitan y porque inventarlo sería el error
 *     que esta sección existe para evitar.
 *  2. **Métricas del entorno de prueba** — cifras reales que vienen del servicio
 *     de catálogo (`app/page.tsx`), etiquetadas como lo que son. Si el servicio
 *     no responde, llegan como `—` y se muestran así: la alternativa (un número
 *     de relleno) convertiría la sección en el problema.
 *
 * Nunca se presentan como métricas de producción, porque no hay producción.
 */

const CAPABILITY_ICONS = [
  Video,
  Layers,
  Boxes,
  Clock,
  SlidersHorizontal,
  GitPullRequestArrow,
] as const;

const CAPABILITY_KEYS = [
  "vod",
  "closedCatalog",
  "visualMatching",
  "timestamp",
  "threshold",
  "exceptionQueue",
] as const;

export function TrustStrip({
  stats,
}: {
  stats: Array<{ value: string; label: string }>;
}) {
  const t = useTranslations("landing.trust");

  return (
    <section className="relative border-y border-line bg-canvas-raised py-12 sm:py-14">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <StaggerGroup className="flex flex-wrap justify-center gap-2 sm:gap-2.5">
          {CAPABILITY_KEYS.map((key, i) => {
            const Icon = CAPABILITY_ICONS[i];
            return (
              <StaggerItem key={key}>
                <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2/60 px-3.5 py-2 text-[12px] font-medium text-ink-muted sm:text-[13px]">
                  <Icon className="size-3.5 shrink-0 text-brand-bright" aria-hidden />
                  {t(`capabilities.${key}`)}
                </span>
              </StaggerItem>
            );
          })}
        </StaggerGroup>

        <FadeIn delay={0.1} className="mt-10">
          <p className="text-center text-[10px] font-semibold tracking-[0.16em] text-ink-faint uppercase">
            {t("metricsLabel")}
          </p>

          <dl className="mx-auto mt-4 grid max-w-3xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-canvas px-4 py-4 text-center">
                <dt className="text-[10px] leading-snug font-medium text-ink-faint">
                  {stat.label}
                </dt>
                <dd className="mt-1.5 text-xl font-semibold tracking-tight text-ink tabular-nums sm:text-2xl">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mx-auto mt-4 max-w-xl text-center text-[11px] leading-relaxed text-ink-faint">
            {t("metricsNote")}
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
