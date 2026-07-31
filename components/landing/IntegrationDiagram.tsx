"use client";

import {
  ArrowDown,
  ArrowRight,
  Clock,
  Database,
  FileVideo,
  Cpu,
  MonitorPlay,
  Plug,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import { SectionLabel } from "@/components/ui";
import { FadeIn, StaggerGroup, StaggerItem } from "@/components/motion";

/**
 * Cómo encaja Pause2Shop en una cadena de VOD que ya existe.
 *
 * Es la sección que faltaba por completo y la que responde a la objeción real de
 * un cliente con infraestructura montada: "¿me obligas a cambiar el
 * reproductor?". La respuesta —no— tiene que ser VISIBLE en la forma del
 * diagrama, no solo escrita: por eso el bloque central va con borde discontinuo
 * de marca y los extremos (contenido y reproductor) con borde neutro. Se lee de
 * un vistazo que lo que se añade es la capa del medio.
 *
 * Composición deliberadamente distinta al resto de la página: no hay rejilla de
 * tarjetas, hay un flujo con nodos y flechas.
 */

const LAYER_NODES = [
  { key: "processing", icon: Cpu },
  { key: "catalog", icon: Database },
  { key: "api", icon: Plug },
] as const;

const GUARANTEE_KEYS = [
  "signal",
  "playback",
  "noMatch",
  "api",
  "traceability",
  "latency",
] as const;

/** Nodo de los extremos: infraestructura del cliente, no nuestra. */
function EdgeNode({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof FileVideo;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2/50 p-5 text-center lg:text-left">
      <span className="mx-auto grid size-10 place-items-center rounded-xl border border-line bg-white/[0.03] lg:mx-0">
        <Icon className="size-4 text-ink-muted" aria-hidden />
      </span>
      <p className="mt-3.5 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">{body}</p>
    </div>
  );
}

/** Flecha de flujo: hacia abajo en móvil, hacia la derecha en escritorio. */
function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1 lg:flex-col lg:py-0">
      <ArrowDown className="size-4 shrink-0 text-brand-bright lg:hidden" aria-hidden />
      <ArrowRight className="hidden size-4 shrink-0 text-brand-bright lg:block" aria-hidden />
      <span className="text-[10px] font-medium text-ink-faint lg:max-w-20 lg:text-center">
        {label}
      </span>
    </div>
  );
}

export function IntegrationDiagram() {
  const t = useTranslations("landing.integration");

  return (
    <section id="integracion" className="relative scroll-mt-20 py-16 sm:py-24">
      {/* separador luminoso: cose la sección con la anterior sin una línea dura */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-line-strong to-transparent"
      />

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="max-w-2xl">
          <SectionLabel className="text-accent">{t("label")}</SectionLabel>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">
            {t("headingLine1")}
            <br className="hidden sm:block" />{" "}
            <span className="text-ink-muted">{t("headingLine2")}</span>
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            {t("description")}
          </p>
        </FadeIn>

        {/* ---------------------------- el diagrama --------------------------- */}
        <FadeIn delay={0.08} className="mt-12">
          <div className="grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.5fr)_auto_minmax(0,1fr)]">
            <EdgeNode icon={FileVideo} title={t("input.title")} body={t("input.body")} />

            <FlowArrow label={t("flow.ingest")} />

            {/* La capa. Borde discontinuo de marca = lo que se añade. */}
            <div className="relative rounded-2xl border border-dashed border-brand/45 bg-brand/[0.04] p-4">
              <p className="absolute -top-2.5 left-4 rounded-full border border-brand/40 bg-canvas px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand-bright uppercase">
                {t("layerLabel")}
              </p>

              <div className="mt-1.5 grid gap-2.5 sm:grid-cols-3">
                {LAYER_NODES.map((node) => {
                  const Icon = node.icon;
                  return (
                    <div
                      key={node.key}
                      className="rounded-xl border border-line bg-surface-2/80 p-3.5"
                    >
                      <span className="grid size-8 place-items-center rounded-lg border border-brand/30 bg-brand/10">
                        <Icon className="size-3.5 text-brand-bright" aria-hidden />
                      </span>
                      <p className="mt-2.5 text-[12px] font-semibold text-ink">
                        {t(`layer.${node.key}.title`)}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">
                        {t(`layer.${node.key}.body`)}
                      </p>
                    </div>
                  );
                })}
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-faint">
                <Clock className="size-3 shrink-0" aria-hidden />
                {t("layerNote")}
              </p>
            </div>

            <FlowArrow label={t("flow.query")} />

            <EdgeNode icon={MonitorPlay} title={t("output.title")} body={t("output.body")} />
          </div>
        </FadeIn>

        {/* --------------------------- garantías ---------------------------- */}
        <StaggerGroup
          delay={0.1}
          className="mt-10 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {GUARANTEE_KEYS.map((key) => (
            <StaggerItem key={key}>
              <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-muted">
                <span
                  aria-hidden
                  className={cn("mt-1.5 size-1.5 shrink-0 rounded-full bg-accent")}
                />
                {t(`guarantees.${key}`)}
              </p>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </section>
  );
}
