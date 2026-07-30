"use client";

import Link from "next/link";
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
import { Badge, Reveal, RevealGroup, RevealItem } from "@/components/ui";

/**
 * Bloques de capacidad = prueba de producto. Cada tarjeta enlaza a la pantalla
 * real donde se puede comprobar, y las que no están completas lo dicen: es una
 * demo técnica, no un folleto.
 */

const FEATURES = [
  {
    icon: Video,
    title: "Analizar vídeo",
    body: "Vídeo subido, YouTube o captura de pantalla, con análisis continuo y overlay de detecciones sobre el reproductor.",
    href: "/studio",
    cta: "Abrir estudio",
    badge: null as null | { text: string; tone: "warning" | "muted" },
  },
  {
    icon: ImageIcon,
    title: "Analizar imagen",
    body: "Sube una imagen y obtén los objetos detectados con sus recortes, listos para buscar.",
    href: "/studio",
    cta: "Abrir estudio",
    badge: null,
  },
  {
    icon: Plug,
    title: "Conectores de catálogo",
    body: "Registro modular de fuentes de moda con estado real: implementado, sin verificar, o pendiente de acuerdo comercial.",
    href: "/admin/connectors",
    cta: "Ver conectores",
    badge: null,
  },
  {
    icon: Binary,
    title: "Embeddings visuales",
    body: "CLIP local o proveedor hash determinista para demo. Reindexado completo desde el admin cuando cambia el modelo.",
    href: "/admin/settings",
    cta: "Ver ajustes",
    badge: { text: "CLIP opcional", tone: "muted" as const },
  },
  {
    icon: Database,
    title: "Catálogo normalizado",
    body: "Esquema único de producto con marca y categoría normalizadas, histórico de precios, dedup multinivel y trazabilidad de fuente.",
    href: "/admin/catalog",
    cta: "Explorar catálogo",
    badge: null,
  },
  {
    icon: Gauge,
    title: "Coste y presupuesto",
    body: "Contadores de llamadas por proveedor, tope de coste por vídeo y caché para no repetir búsquedas pagadas.",
    href: "/studio",
    cta: "Ver en el estudio",
    badge: null,
  },
];

export function Capabilities() {
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
              Capacidades
            </p>
            <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">
              Todo lo que ya funciona, con enlace directo para comprobarlo
            </h2>
          </div>
          <Badge tone="brand" size="md" dot>
            Demo técnica verificable
          </Badge>
        </Reveal>

        <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <RevealItem key={feature.title}>
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
              <span className="font-medium text-ink">Ingesta con reglas.</span> robots.txt
              comprobado antes de cada petición, <code className="font-mono text-[11px]">Crawl-delay</code>{" "}
              respetado, User-Agent identificable con contacto y cero evasión anti-bot. Las
              fuentes que exigen acuerdo de partner o afiliación no se ingieren hasta tenerlo.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
