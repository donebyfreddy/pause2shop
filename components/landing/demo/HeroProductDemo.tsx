"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Pause, Play, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DEMO_SCENES } from "@/lib/landing/demoScene";
import { cn } from "@/lib/ui/cn";
import { SceneArt } from "./SceneArt";
import { DetectionOverlay } from "./DetectionOverlay";
import { MatchCard } from "./MatchCard";

/**
 * Demostración del hero: la promesa de la landing, en movimiento, dentro del
 * primer viewport.
 *
 * Restricciones que cumple por diseño:
 *
 *  - **Cero red.** Escenas y coincidencias son datos locales
 *    (`lib/landing/demoScene.ts`). Si el servicio de catálogo está caído, el
 *    hero se ve igual. La auditoría dejó claro que el hero no puede depender de
 *    una API.
 *  - **Cero assets.** El frame es SVG generado (`SceneArt`), así que no hay
 *    imagen que descargar y no compite con el LCP del titular.
 *  - **Pausable de verdad.** El control detiene el temporizador, no solo la
 *    animación CSS, y es un `<button>` con `aria-pressed`.
 *  - **`prefers-reduced-motion`.** No arranca sola: se muestra la primera escena
 *    completa y estática, con todas las detecciones ya dibujadas. La
 *    información es la misma; lo que desaparece es el movimiento.
 *
 * Ritmo: 4 pasos de 1,3 s por escena (5,2 s). Los tres primeros enfocan un
 * objeto y su tarjeta —es el latido "objeto → catálogo"—; el cuarto deja la
 * escena entera antes de cambiar. Un ciclo completo de las tres escenas dura
 * ~15,6 s.
 */

const STEP_MS = 1300;
const STEPS_PER_SCENE = 4;

export function HeroProductDemo() {
  const t = useTranslations("landing.demo");
  const tHero = useTranslations("landing.heroDemo");
  const reduce = useReducedMotion();

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  /**
   * Preferencia de movimiento, pero solo DESPUÉS de hidratar.
   *
   * `useReducedMotion()` a secas no sirve para decidir qué se renderiza: el
   * servidor no conoce la preferencia del usuario, así que el primer render del
   * cliente saldría distinto y React descartaría el HTML del servidor. Se
   * reprodujo en los E2E con `emulateMedia({ reducedMotion: "reduce" })`.
   *
   * Con esta bandera, el primer render del cliente es idéntico al del servidor
   * (`false`) y la preferencia se aplica en el render siguiente. Aquí es
   * necesario —y no basta con `MotionConfig`— porque lo que hay que parar no es
   * una animación de la librería, es un `setInterval` que cambia de escena.
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const prefersReduced = hydrated && reduce === true;

  useEffect(() => {
    if (prefersReduced || !playing) return;
    const id = window.setInterval(() => setStep((s) => s + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, [prefersReduced, playing]);

  const sceneIndex = Math.floor(step / STEPS_PER_SCENE) % DEMO_SCENES.length;
  const scene = DEMO_SCENES[sceneIndex];
  const stepInScene = step % STEPS_PER_SCENE;

  // En el paso final no hay objeto enfocado: la escena descansa completa.
  const focused =
    stepInScene < scene.objects.length ? scene.objects[stepInScene] : null;
  const focusedMatchId = focused?.matchId ?? null;

  return (
    <div className="relative">
      {/* halo: profundidad sin animar blur (coste de compositor) */}
      <div aria-hidden className="absolute -inset-4 rounded-[2rem] bg-brand/15 blur-3xl sm:-inset-6" />

      <div className="panel relative overflow-hidden shadow-panel">
        {/* ---------------------------- barra superior --------------------------- */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4 sm:py-2.5">
          <div className="hidden gap-1.5 sm:flex" aria-hidden>
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
          </div>

          <p className="truncate font-mono text-[10px] text-ink-faint sm:ml-2 sm:text-[11px]">
            {tHero("windowLabel", { timecode: scene.timecode })}
          </p>

          {/* Etiqueta honesta: es una escena de demostración, no una emisión.
              La versión anterior ponía "en directo" — el producto no hace
              directo, y el badge lo prometía dentro del propio mockup. */}
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-ink-muted sm:inline-flex">
            {tHero("demoBadge")}
          </span>

          {/* `aria-label` explícito y no solo el texto de dentro: por debajo de
              `sm` la etiqueta se oculta para que la barra quepa, y el icono es
              `aria-hidden`, así que sin esto el botón se queda SIN nombre
              accesible en móvil. Lo detectó el E2E de móvil. */}
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing && !prefersReduced}
            aria-label={playing && !prefersReduced ? tHero("pause") : tHero("play")}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[10px] font-medium text-ink-muted transition-colors hover:border-line-strong hover:text-ink sm:ml-2"
          >
            {playing && !prefersReduced ? (
              <>
                <Pause className="size-3" aria-hidden />
                <span className="hidden sm:inline">{tHero("pause")}</span>
              </>
            ) : (
              <>
                <Play className="size-3" aria-hidden />
                <span className="hidden sm:inline">{tHero("play")}</span>
              </>
            )}
          </button>
        </div>

        <div className="grid lg:grid-cols-[1.5fr_1fr]">
          {/* ------------------------------ el frame ----------------------------- */}
          <div className="relative aspect-video overflow-hidden border-line bg-canvas lg:border-r">
            <AnimatePresence mode="popLayout">
              <motion.div
                key={scene.id}
                initial={{ opacity: 0, scale: 1.04 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }}
                className="absolute inset-0"
              >
                <SceneArt
                  sceneId={scene.id}
                  palette={scene.palette}
                  className="size-full object-cover"
                />
              </motion.div>
            </AnimatePresence>

            {/* línea de escaneo: la metáfora de "analizar el frame" */}
            {playing && (
              <div aria-hidden className="absolute inset-0 overflow-hidden">
                <div className="animate-scan absolute inset-x-0 h-20 bg-linear-to-b from-transparent via-accent/20 to-transparent">
                  <div className="absolute bottom-0 h-px w-full bg-accent/70 shadow-[0_0_16px_2px_rgba(34,211,238,0.6)]" />
                </div>
              </div>
            )}

            <DetectionOverlay
              objects={scene.objects}
              activeId={focused?.id ?? null}
              sceneKey={scene.id}
            />

            <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-lg border border-line bg-canvas/85 px-2 py-1 backdrop-blur-sm sm:bottom-3 sm:left-3 sm:px-2.5 sm:py-1.5">
              <ScanSearch className="size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="font-mono text-[9px] text-ink-muted sm:text-[10px]">
                {t("detectionSummary", { objects: scene.objects.length })}
              </span>
            </div>

            {/* progreso de escenas: orienta sin robar atención */}
            <div className="absolute right-2 bottom-2 flex gap-1 sm:right-3 sm:bottom-3" aria-hidden>
              {DEMO_SCENES.map((s, i) => (
                <span
                  key={s.id}
                  className={cn(
                    "h-0.5 rounded-full transition-all duration-500",
                    i === sceneIndex ? "w-5 bg-accent" : "w-2 bg-white/25"
                  )}
                />
              ))}
            </div>
          </div>

          {/* --------------------------- panel de resultados ---------------------- */}
          <div className="flex flex-col gap-2 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
                {t("matchesTitle")}
              </p>
              <span className="font-mono text-[10px] text-ink-faint">{t("source")}</span>
            </div>

            {/* aria-live: quien usa lector de pantalla se entera de que el panel
                cambia con la escena, sin tener que ir a buscarlo. */}
            <div className="flex flex-col gap-1.5" aria-live="polite" aria-atomic="false">
              {scene.matches.map((match, i) => (
                <motion.div
                  key={`${scene.id}-${match.id}`}
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.45,
                    delay: 0.3 + i * 0.14,
                    ease: [0.22, 0.61, 0.36, 1],
                  }}
                >
                  <MatchCard
                    match={match}
                    timecode={scene.timecode}
                    active={focusedMatchId === match.id}
                    compact
                  />
                </motion.div>
              ))}
            </div>

            {/* Resumen del umbral en una línea: cierra el discurso del hero con
                la promesa que más importa a un responsable editorial.
                Compacto a propósito — el alto de esta columna es lo que fija el
                alto del panel, y el panel tiene que caber en el primer
                viewport. El desarrollo completo, con deslizador, está en
                `ConfidenceSection`. */}
            <div className="mt-auto flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
              <span className="truncate text-[10px] text-ink-subtle">
                {tHero("thresholdLabel")}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-ink">
                {tHero("thresholdValue", { value: 75 })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
