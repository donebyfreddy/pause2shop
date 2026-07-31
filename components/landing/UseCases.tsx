"use client";

import { BarChart3, Clapperboard, Layers, MousePointerClick, Presentation, Radio } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import { Badge, SectionLabel } from "@/components/ui";
import { FadeIn, MotionCard, StaggerGroup, StaggerItem } from "@/components/motion";
import { DEMO_SCENES } from "@/lib/landing/demoScene";
import { SceneArt } from "./demo/SceneArt";

/**
 * Casos de uso.
 *
 * Cambia el titular defensivo auditado ("Pensado para catálogos de vídeo, no
 * para una foto suelta") por uno afirmativo, y sobre todo cambia la FORMA: en
 * lugar de una rejilla de tarjetas iguales hay tres tratamientos distintos —un
 * caso protagonista con visual real, tres secundarios y dos en una banda de
 * madurez—. Es la variación de composición que la auditoría pedía.
 *
 * Cada caso lleva su estado real (`funciona`, `piloto`, `futuro`). Es la
 * diferencia entre una landing que se puede defender en una reunión y una que
 * genera una conversación incómoda diez minutos después: el directo aparece,
 * pero etiquetado como evolución, no como capacidad de hoy.
 *
 * Ya no se menciona el límite de duración por job: era una restricción de
 * desarrollo usada como viñeta de venta.
 */

const SECONDARY = [
  { key: "pauseDiscovery", icon: MousePointerClick, stage: "works" },
  { key: "ownCatalog", icon: Layers, stage: "works" },
  { key: "controlledDemo", icon: Presentation, stage: "works" },
] as const;

const HORIZON = [
  { key: "placementReporting", icon: BarChart3, stage: "pilot" },
  { key: "live", icon: Radio, stage: "future" },
] as const;

const STAGE_TONE = {
  works: "success",
  pilot: "brand",
  future: "muted",
} as const;

const SCENE = DEMO_SCENES[0];

export function UseCases() {
  const t = useTranslations("landing.useCases");

  return (
    <section id="casos-de-uso" className="relative scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="max-w-2xl">
          <SectionLabel className="text-accent">{t("label")}</SectionLabel>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">{t("heading")}</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            {t("description")}
          </p>
        </FadeIn>

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
          {/* ------------------------ caso protagonista ----------------------- */}
          <FadeIn>
            <article className="panel relative h-full overflow-hidden">
              {/* Visual real de la escena, no un icono grande: conecta este caso
                  con la demo que el visitante acaba de ver funcionar arriba. */}
              <div className="relative aspect-16/7 overflow-hidden border-b border-line bg-canvas">
                <SceneArt
                  sceneId={SCENE.id}
                  palette={SCENE.palette}
                  className="absolute inset-0 size-full object-cover"
                />
                {SCENE.objects.map((object) => (
                  <span
                    key={object.id}
                    aria-hidden
                    className="absolute rounded border border-brand-bright/70 bg-brand/5"
                    style={{
                      left: `${object.box.x}%`,
                      top: `${object.box.y}%`,
                      width: `${object.box.w}%`,
                      height: `${object.box.h}%`,
                    }}
                  />
                ))}
                <div className="absolute inset-x-3 bottom-3 flex items-center gap-1.5">
                  {DEMO_SCENES.map((scene, i) => (
                    <span
                      key={scene.id}
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[9px] backdrop-blur-sm",
                        i === 0
                          ? "border-accent/50 bg-canvas/85 text-accent"
                          : "border-line bg-canvas/70 text-ink-subtle"
                      )}
                    >
                      {scene.timecode}
                    </span>
                  ))}
                </div>
              </div>

              <div className="p-6">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="grid size-10 place-items-center rounded-xl border border-brand/30 bg-brand/12">
                    <Clapperboard className="size-4 text-brand-bright" aria-hidden />
                  </span>
                  <Badge tone={STAGE_TONE.works} size="md">
                    {t("stage.works")}
                  </Badge>
                </div>

                <h3 className="mt-4 text-xl font-semibold tracking-tight text-ink">
                  {t("primary.title")}
                </h3>
                <p className="mt-3 max-w-md text-[13px] leading-relaxed text-ink-muted">
                  {t("primary.body")}
                </p>

                <ul className="mt-5 space-y-2.5">
                  {(["point1", "point2", "point3"] as const).map((point) => (
                    <li key={point} className="flex items-start gap-2.5 text-[13px] text-ink-muted">
                      <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                      {t(`primary.${point}`)}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          </FadeIn>

          {/* -------------------------- tres secundarios ---------------------- */}
          <StaggerGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {SECONDARY.map((item) => {
              const Icon = item.icon;
              return (
                <StaggerItem key={item.key} className="h-full">
                  <MotionCard className="h-full">
                    <article className="panel h-full p-5 transition-colors hover:border-line-strong">
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid size-9 place-items-center rounded-lg border border-line bg-white/[0.03]">
                          <Icon className="size-4 text-ink-muted" aria-hidden />
                        </span>
                        <Badge tone={STAGE_TONE[item.stage]}>{t(`stage.${item.stage}`)}</Badge>
                      </div>
                      <h3 className="mt-4 text-sm font-semibold text-ink">
                        {t(`secondary.${item.key}.title`)}
                      </h3>
                      <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">
                        {t(`secondary.${item.key}.body`)}
                      </p>
                    </article>
                  </MotionCard>
                </StaggerItem>
              );
            })}
          </StaggerGroup>
        </div>

        {/* ------------------------ banda de madurez ------------------------- */}
        <FadeIn delay={0.1} className="mt-4">
          <div className="panel grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
            {HORIZON.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.key} className="flex items-start gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-white/[0.03]">
                    <Icon className="size-4 text-ink-subtle" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">
                        {t(`horizon.${item.key}.title`)}
                      </h3>
                      <Badge tone={STAGE_TONE[item.stage]}>{t(`stage.${item.stage}`)}</Badge>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">
                      {t(`horizon.${item.key}.body`)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
