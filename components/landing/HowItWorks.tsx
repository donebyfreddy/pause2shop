"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { ArrowUpRight, Check, EyeOff, ScanSearch, ShieldQuestion } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DEMO_SCENES } from "@/lib/landing/demoScene";
import { cn } from "@/lib/ui/cn";
import { ButtonLink, SectionLabel } from "@/components/ui";
import { FadeIn } from "@/components/motion";
import { SceneArt } from "./demo/SceneArt";

/**
 * Cómo funciona: cuatro pasos ligados al scroll sobre un visual pegajoso.
 *
 * Frente al timeline auditado, tres cambios de fondo:
 *
 *  - **Cinco pasos pasan a cuatro.** El tercero ("tracking y deduplicación") era
 *    una etapa interna del pipeline, no una idea que un comprador necesite para
 *    decidir. Sigue existiendo, pero como chip del paso 2.
 *  - **El mismo frame se transforma.** Antes cada paso era un icono junto a un
 *    párrafo; ahora el visual es uno solo y va cambiando de estado, que es
 *    exactamente lo que hace el producto con la escena.
 *  - **La jerga baja de nivel.** `rVFC`, `NMS` y `pgvector` salen del cuerpo del
 *    texto y pasan a chips; el detalle completo vive en `/arquitectura`.
 *
 * No hay scroll hijacking: la sección no captura la rueda ni fija la duración
 * del scroll. Solo lee el progreso para decidir qué estado pinta el visual.
 */

const STEP_KEYS = ["analyze", "detect", "match", "publish"] as const;
type StepKey = (typeof STEP_KEYS)[number];

/**
 * Chips técnicos por paso. Secundarios a propósito: dan confianza sin liderar.
 *
 * `satisfies` en lugar de una anotación `Record<StepKey, readonly string[]>`:
 * la anotación ensancharía los valores a `string` y la clave de traducción
 * quedaría como `chips.${string}`, que `next-intl` no puede verificar. Con
 * `satisfies` se comprueba la forma y se conservan los literales.
 */
const STEP_CHIPS = {
  analyze: ["frames", "sceneChange", "timeline"],
  detect: ["objects", "crops", "tracking", "dedupe"],
  match: ["embeddings", "candidates", "ranking", "variants"],
  publish: ["threshold", "rules", "exception", "traceability"],
} as const satisfies Record<StepKey, readonly string[]>;

/** La escena que se transforma. Es la misma que abre el hero, a propósito. */
const FRAME = DEMO_SCENES[0];

/* ------------------------------------------------------------------ visuales */

/** Paso 1 — se recorre el contenido: frames candidatos y cambios de escena. */
function AnalyzeStage() {
  return (
    <>
      {/* `animate-scan` es una animación CSS: la regla global de
          `prefers-reduced-motion` ya la neutraliza. Condicionar el render aquí
          haría que servidor y cliente pintasen árboles distintos. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        <div className="animate-scan absolute inset-x-0 h-20 bg-linear-to-b from-transparent via-accent/25 to-transparent">
          <div className="absolute bottom-0 h-px w-full bg-accent/80 shadow-[0_0_16px_2px_rgba(34,211,238,0.6)]" />
        </div>
      </div>

      {/* Tira de frames. Los altos en cian son cambios de escena: los que
          realmente se analizan. Comunica el ahorro sin decir una cifra. */}
      <div className="absolute inset-x-3 bottom-3 flex items-end gap-1.5">
        {Array.from({ length: 9 }, (_, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scaleY: 0.4 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
            className={cn(
              "flex-1 origin-bottom rounded-sm",
              i === 2 || i === 5 || i === 7 ? "h-7 bg-accent/70" : "h-3.5 bg-white/15"
            )}
          />
        ))}
      </div>

      <span className="absolute top-3 left-3 rounded-md border border-line bg-canvas/85 px-2 py-1 font-mono text-[10px] text-ink-muted backdrop-blur-sm">
        {FRAME.timecode}
      </span>
    </>
  );
}

/** Paso 2 — los objetos aparecen con su caja y su confianza. */
function DetectStage() {
  const t = useTranslations("landing.demo");
  return (
    <>
      {FRAME.objects.map((object, i) => (
        <motion.div
          key={object.id}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.16, duration: 0.35 }}
          className="absolute rounded-lg border-2 border-brand-bright/85 bg-brand/5"
          style={{
            left: `${object.box.x}%`,
            top: `${object.box.y}%`,
            width: `${object.box.w}%`,
            height: `${object.box.h}%`,
          }}
        >
          <span className="absolute -top-[22px] left-0 rounded bg-brand-bright px-1.5 py-0.5 text-[9px] font-semibold whitespace-nowrap text-white">
            {t(`objects.${object.key}`)} {Math.round(object.confidence * 100)}%
          </span>
        </motion.div>
      ))}
    </>
  );
}

/** Paso 3 — el recorte se compara y sale un ranking de candidatos. */
function MatchStage() {
  const t = useTranslations("landing.demo");
  const candidates = [0.93, 0.71, 0.54];

  return (
    <div className="absolute inset-0 flex items-center gap-3 bg-canvas/75 p-3 backdrop-blur-[3px] sm:gap-4 sm:p-5">
      {/* el recorte que se busca: el mismo frame, ampliado sobre el objeto */}
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
        className="relative aspect-3/4 w-[26%] shrink-0 overflow-hidden rounded-lg border-2 border-accent/70"
      >
        <SceneArt
          sceneId={FRAME.id}
          palette={FRAME.palette}
          className="absolute inset-0 size-full scale-[2.4] object-cover"
        />
        <span className="absolute inset-x-0 bottom-0 bg-canvas/85 py-0.5 text-center text-[9px] font-medium text-accent">
          {t(`objects.${FRAME.objects[0].key}`)}
        </span>
      </motion.div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {candidates.map((score, i) => (
          <motion.div
            key={score}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.12 + i * 0.1, duration: 0.35 }}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2 py-1.5",
              i === 0 ? "border-accent/50 bg-accent/[0.08]" : "border-line bg-surface-2/80"
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded bg-surface-3 font-mono text-[9px] text-ink-faint">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${score * 100}%` }}
                  transition={{ delay: 0.2 + i * 0.1, duration: 0.6 }}
                  className={cn(
                    "h-full rounded-full",
                    i === 0 ? "bg-linear-to-r from-brand to-accent" : "bg-ink-faint/60"
                  )}
                />
              </div>
            </div>
            <span
              className={cn(
                "shrink-0 font-mono text-[10px] tabular-nums",
                i === 0 ? "text-accent" : "text-ink-subtle"
              )}
            >
              {Math.round(score * 100)}%
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Paso 4 — el umbral reparte: publicado, revisión, retenido. */
function PublishStage() {
  const t = useTranslations("landing.howItWorks");
  const lanes = [
    { key: "published", icon: Check, cls: "border-success/40 bg-success/10 text-success", score: 93 },
    { key: "review", icon: ShieldQuestion, cls: "border-warning/40 bg-warning/10 text-warning", score: 61 },
    { key: "withheld", icon: EyeOff, cls: "border-line-strong bg-white/[0.03] text-ink-subtle", score: 38 },
  ] as const;

  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2 bg-canvas/80 p-3 backdrop-blur-[3px] sm:gap-2.5 sm:p-5">
      {lanes.map((lane, i) => {
        const Icon = lane.icon;
        return (
          <motion.div
            key={lane.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12, duration: 0.35 }}
            className={cn("flex items-center gap-2.5 rounded-lg border px-2.5 py-2", lane.cls)}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
              {t(`lanes.${lane.key}`)}
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums opacity-80">
              {lane.score}%
            </span>
          </motion.div>
        );
      })}
      <p className="mt-1 text-center text-[10px] text-ink-faint">
        {t("lanes.note", { threshold: 75 })}
      </p>
    </div>
  );
}

const STAGES = [AnalyzeStage, DetectStage, MatchStage, PublishStage] as const;

/* ------------------------------------------------------------------ sección */

export function HowItWorks() {
  const t = useTranslations("landing.howItWorks");
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 60%", "end 85%"],
  });

  // Progreso → paso activo. Se lee con `useMotionValueEvent` y no con
  // `useTransform` porque el visual cambia de ÁRBOL, no de estilo: hace falta
  // estado de React para que `AnimatePresence` pueda hacer el cruce.
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const next = Math.min(
      STEP_KEYS.length - 1,
      Math.max(0, Math.floor(p * STEP_KEYS.length))
    );
    setActive((current) => (current === next ? current : next));
  });

  const ActiveStage = STAGES[active];

  return (
    <section id="como-funciona" className="relative scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="max-w-2xl">
          <SectionLabel className="text-accent">{t("label")}</SectionLabel>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">{t("heading")}</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            {t("description")}
          </p>
        </FadeIn>

        <div ref={containerRef} className="mt-12 lg:grid lg:grid-cols-2 lg:gap-14">
          {/* ----------------------- visual pegajoso ----------------------- */}
          <div className="sticky top-[72px] z-10 -mx-4 mb-8 bg-canvas/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none lg:top-24 lg:mb-0 lg:self-start">
            <div className="panel relative overflow-hidden">
              <div className="relative aspect-video overflow-hidden bg-canvas">
                <SceneArt
                  sceneId={FRAME.id}
                  palette={FRAME.palette}
                  className="absolute inset-0 size-full object-cover"
                />
                <AnimatePresence mode="wait">
                  <motion.div
                    key={STEP_KEYS[active]}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0"
                  >
                    <ActiveStage />
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
                <ScanSearch className="size-3.5 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
                  {t(`steps.${STEP_KEYS[active]}.title`)}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                  {active + 1}/{STEP_KEYS.length}
                </span>
              </div>
              <div className="h-0.5 bg-surface-3">
                <motion.div
                  className="h-full bg-linear-to-r from-brand to-accent"
                  animate={{ width: `${((active + 1) / STEP_KEYS.length) * 100}%` }}
                  transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
                />
              </div>
            </div>
          </div>

          {/* ----------------------------- pasos ---------------------------- */}
          <ol className="space-y-6 sm:space-y-8">
            {STEP_KEYS.map((key, index) => {
              const isActive = index === active;
              return (
                <li key={key}>
                  <div
                    className={cn(
                      "rounded-2xl border p-5 transition-colors duration-300 sm:p-6",
                      isActive ? "border-brand/40 bg-brand/[0.05]" : "border-line bg-white/[0.015]"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-lg border font-mono text-[11px] transition-colors",
                          isActive
                            ? "border-brand/50 bg-brand/15 text-brand-bright"
                            : "border-line bg-surface-2 text-ink-faint"
                        )}
                      >
                        {index + 1}
                      </span>
                      <h3
                        className={cn(
                          "text-base font-semibold transition-colors",
                          isActive ? "text-ink" : "text-ink-muted"
                        )}
                      >
                        {t(`steps.${key}.title`)}
                      </h3>
                    </div>

                    <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
                      {t(`steps.${key}.body`)}
                    </p>

                    <ul className="mt-4 flex flex-wrap gap-1.5">
                      {STEP_CHIPS[key].map((chip) => (
                        <li
                          key={chip}
                          className="rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink-subtle"
                        >
                          {t(`chips.${chip}`)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}

            <li>
              <ButtonLink href="/arquitectura" variant="outline" size="sm">
                {t("architectureCta")}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </ButtonLink>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
