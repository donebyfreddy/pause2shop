"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  Binary,
  Database,
  Gauge,
  Image as ImageIcon,
  Plug,
  ShieldCheck,
  Video,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, Reveal, RevealGroup, RevealItem } from "@/components/ui";

/**
 * Bloques de capacidad = prueba de producto. Cada tarjeta enlaza a la pantalla
 * real donde se puede comprobar, y las que no están completas lo dicen: es una
 * demo técnica, no un folleto.
 */

const FEATURE_META = [
  { key: "video", icon: Video, href: "/studio", titleKey: "actions.analyzeVideo" as const },
  { key: "image", icon: ImageIcon, href: "/studio", titleKey: "actions.analyzeImage" as const },
  { key: "connectors", icon: Plug, href: "/admin/connectors" },
  { key: "embeddings", icon: Binary, href: "/admin/settings" },
  { key: "catalog", icon: Database, href: "/admin/catalog" },
  { key: "cost", icon: Gauge, href: "/studio" },
] as const;

function ComplianceCode({ children }: Readonly<{ children: ReactNode }>) {
  return <code className="font-mono text-[11px]">{children}</code>;
}

export function Capabilities() {
  const t = useTranslations("landing.capabilities");
  const tRoot = useTranslations();

  const ctaFor = (meta: (typeof FEATURE_META)[number]) => {
    switch (meta.key) {
      case "video":
      case "image":
        return t("ctaOpenStudio");
      case "cost":
        return t("ctaViewInStudio");
      case "connectors":
        return t("features.connectors.cta");
      case "embeddings":
        return t("features.embeddings.cta");
      case "catalog":
        return t("features.catalog.cta");
    }
  };

  const features = FEATURE_META.map((meta) => ({
    key: meta.key,
    icon: meta.icon,
    href: meta.href,
    title: "titleKey" in meta ? tRoot(meta.titleKey) : t(`features.${meta.key}.title`),
    body: t(`features.${meta.key}.body`),
    cta: ctaFor(meta),
    badge:
      meta.key === "embeddings"
        ? { text: t("features.embeddings.badge"), tone: "muted" as const }
        : null,
  }));

  return (
    <section className="relative py-24 sm:py-28">
      {/* separador luminoso */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-line-strong to-transparent"
      />

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">
              {t("title")}
            </p>
            <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">{t("heading")}</h2>
          </div>
          <Badge tone="brand" size="md" dot>
            {t("verifiableBadge")}
          </Badge>
        </Reveal>

        <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <RevealItem key={feature.key}>
              <motion.div
                whileHover={{ y: -4 }}
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
                className="h-full"
              >
                <Link
                  href={feature.href}
                  className="panel group flex h-full flex-col p-5 transition-colors hover:border-brand/40"
                >
                  <div className="flex items-start justify-between">
                    <span className="grid size-10 place-items-center rounded-xl border border-line bg-white/[0.03] transition-colors group-hover:border-brand/40 group-hover:bg-brand/10">
                      <feature.icon
                        className="size-4 text-ink-muted transition-colors group-hover:text-brand-bright"
                        aria-hidden
                      />
                    </span>
                    {feature.badge && (
                      <Badge tone={feature.badge.tone}>{feature.badge.text}</Badge>
                    )}
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-ink">{feature.title}</h3>
                  <p className="mt-1.5 flex-1 text-xs leading-relaxed text-ink-subtle">
                    {feature.body}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted transition-colors group-hover:text-brand-bright">
                    {feature.cta}
                    <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </Link>
              </motion.div>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal delay={0.1} className="mt-6">
          <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
            <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
            <p className="text-xs leading-relaxed text-ink-muted">
              <span className="font-medium text-ink">{t("complianceNote.lead")}</span>{" "}
              {t.rich("complianceNote.body", {
                code: (chunks) => <ComplianceCode>{chunks}</ComplianceCode>,
              })}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
