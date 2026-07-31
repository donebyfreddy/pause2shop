"use client";

import { motion } from "motion/react";
import {
  Clapperboard,
  Compass,
  Layers,
  Presentation,
  ShoppingBag,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui";

/**
 * Casos de uso. Tarjeta grande destacada + rejilla: evita el clásico "cinco
 * tarjetas iguales" y deja claro cuál es el caso principal (VOD).
 */

const SECONDARY_ICONS = {
  discovery: Compass,
  catalogMatch: Layers,
  visualShopping: ShoppingBag,
  clientDemos: Presentation,
} as const;

export function UseCases() {
  const t = useTranslations("landing.useCases");

  const primary = {
    icon: Clapperboard,
    title: t("primary.title"),
    body: t("primary.body"),
    points: [t("primary.point1"), t("primary.point2"), t("primary.point3")],
  };

  const secondary = (
    Object.keys(SECONDARY_ICONS) as Array<keyof typeof SECONDARY_ICONS>
  ).map((key) => ({
    key,
    icon: SECONDARY_ICONS[key],
    title: t(`secondary.${key}.title`),
    body: t(`secondary.${key}.body`),
  }));

  const PrimaryIcon = primary.icon;

  return (
    <section className="relative py-24 sm:py-28">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">
            {t("title")}
          </p>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">{t("heading")}</h2>
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
                  <PrimaryIcon className="size-5 text-brand-bright" aria-hidden />
                </span>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-ink">
                  {primary.title}
                </h3>
                <p className="mt-3 max-w-md text-[13px] leading-relaxed text-ink-muted">
                  {primary.body}
                </p>
                <ul className="mt-6 space-y-2.5">
                  {primary.points.map((point) => (
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
            {secondary.map((item) => (
              <RevealItem key={item.key}>
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
