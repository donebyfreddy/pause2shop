"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader, MousePointerClick, ScanSearch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DEMO_SCENES, matchFor } from "@/lib/landing/demoScene";
import { cn } from "@/lib/ui/cn";
import { FadeIn } from "@/components/motion";
import { SectionLabel } from "@/components/ui";
import { SceneArt } from "./SceneArt";
import { DetectionOverlay } from "./DetectionOverlay";
import { MatchCard } from "./MatchCard";

/**
 * Demo interactiva central: "mira cómo una escena se convierte en catálogo".
 *
 * Es la sección que convierte la afirmación de la landing en algo comprobable
 * sin salir de la página. La sincronía va en las dos direcciones —pulsar un
 * hotspot selecciona su tarjeta y pulsar una tarjeta resalta su objeto—, que es
 * exactamente el gesto que hace el estudio real.
 *
 * Estados que cubre (los tres estaban pedidos y los tres son reales en el
 * producto):
 *
 *  - **analizando**: al cambiar de escena hay una pausa breve con "analizando
 *    frame". No es un `setTimeout` decorativo por gusto: en el producto el
 *    análisis de un frame nuevo tarda, y una demo que responde en 0 ms enseña
 *    algo que luego no se cumple.
 *  - **vacío**: si una escena no devolviera objetos, se dice, con la razón.
 *  - **sin selección**: invitación explícita a pulsar, no un panel en blanco.
 *
 * No usa datos remotos: comparte `lib/landing/demoScene.ts` con el hero, así que
 * las dos superficies no se pueden contradecir.
 */

const ANALYSIS_MS = 620;

export function InteractiveFrameDemo() {
  const t = useTranslations("landing.demo");
  const tSection = useTranslations("landing.interactiveDemo");
  const reduce = useReducedMotion();

  const [sceneIndex, setSceneIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const timerRef = useRef<number | null>(null);

  const scene = DEMO_SCENES[sceneIndex];
  const selectedMatch = selectedId ? matchFor(scene, selectedId) : null;

  const goToScene = useCallback(
    (index: number) => {
      if (index === sceneIndex) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);

      setSelectedId(null);
      setAnalyzing(true);
      setSceneIndex(index);

      timerRef.current = window.setTimeout(
        () => setAnalyzing(false),
        reduce ? 0 : ANALYSIS_MS
      );
    },
    [sceneIndex, reduce]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  /** Pulsar una tarjeta resalta su objeto: la sincronía inversa. */
  const selectByMatch = (matchId: string) => {
    const object = scene.objects.find((o) => o.matchId === matchId);
    setSelectedId(object ? object.id : null);
  };

  const objects = analyzing ? [] : scene.objects;

  return (
    <section id="demo" className="relative scroll-mt-20 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="max-w-2xl">
          <SectionLabel className="text-accent">{tSection("label")}</SectionLabel>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">{tSection("heading")}</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            {tSection("description")}
          </p>
        </FadeIn>

        <FadeIn delay={0.08} className="mt-10">
          <div className="panel overflow-hidden">
            <div className="grid lg:grid-cols-[1.45fr_1fr]">
              {/* ============================= frame ============================ */}
              <div className="border-line lg:border-r">
                <div className="relative aspect-video overflow-hidden bg-canvas">
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={scene.id}
                      initial={{ opacity: 0, scale: 1.03 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.5 }}
                      className="absolute inset-0"
                    >
                      <SceneArt
                        sceneId={scene.id}
                        palette={scene.palette}
                        className="size-full object-cover"
                      />
                    </motion.div>
                  </AnimatePresence>

                  <DetectionOverlay
                    objects={objects}
                    activeId={selectedId}
                    onSelect={setSelectedId}
                    sceneKey={scene.id}
                  />

                  {/* estado "analizando frame" */}
                  <AnimatePresence>
                    {analyzing && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 grid place-items-center bg-canvas/55 backdrop-blur-[2px]"
                      >
                        <div className="flex items-center gap-2.5 rounded-full border border-line bg-canvas/90 px-3.5 py-2">
                          <Loader className="size-3.5 animate-spin text-accent" aria-hidden />
                          <span className="text-[11px] font-medium text-ink-muted">
                            {tSection("analyzing")}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-lg border border-line bg-canvas/85 px-2 py-1 backdrop-blur-sm sm:bottom-3 sm:left-3 sm:px-2.5 sm:py-1.5">
                    <ScanSearch className="size-3.5 shrink-0 text-accent" aria-hidden />
                    <span className="font-mono text-[9px] text-ink-muted sm:text-[10px]">
                      {t("detectionSummary", { objects: scene.objects.length })}
                    </span>
                  </div>
                </div>

                {/* ---- línea de tiempo: hace de "mover el vídeo" ---- */}
                <div className="border-t border-line px-3 py-3 sm:px-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
                      {tSection("timelineLabel")}
                    </p>
                    <span className="font-mono text-[10px] text-ink-subtle">
                      {scene.timecode}
                    </span>
                  </div>

                  <div
                    className="mt-2.5 flex gap-1.5"
                    role="tablist"
                    aria-label={tSection("timelineLabel")}
                  >
                    {DEMO_SCENES.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        role="tab"
                        aria-selected={i === sceneIndex}
                        onClick={() => goToScene(i)}
                        className={cn(
                          "group flex-1 cursor-pointer rounded-lg border px-2 py-2 text-left transition-colors",
                          i === sceneIndex
                            ? "border-accent/50 bg-accent/[0.07]"
                            : "border-line bg-white/[0.02] hover:border-line-strong"
                        )}
                      >
                        <span
                          className={cn(
                            "block font-mono text-[10px] transition-colors",
                            i === sceneIndex ? "text-accent" : "text-ink-faint"
                          )}
                        >
                          {s.timecode}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block truncate text-[11px] font-medium transition-colors",
                            i === sceneIndex ? "text-ink" : "text-ink-subtle group-hover:text-ink-muted"
                          )}
                        >
                          {t(`scenes.${s.key}`)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* =========================== resultados ========================== */}
              <div className="flex flex-col p-3 sm:p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
                    {t("matchesTitle")}
                  </p>
                  <span className="font-mono text-[10px] text-ink-faint">{t("source")}</span>
                </div>

                {/* El panel se anuncia al cambiar: es el resultado del análisis,
                    y quien no ve la pantalla necesita saber que ya está. */}
                <div className="mt-3 flex flex-col gap-2" aria-live="polite">
                  {analyzing ? (
                    // Skeleton del mismo alto que las tarjetas: sin salto de layout.
                    Array.from({ length: 3 }, (_, i) => (
                      <div
                        key={i}
                        className="skeleton-sheen h-[92px] rounded-xl border border-line"
                        aria-hidden
                      />
                    ))
                  ) : scene.matches.length === 0 ? (
                    <div className="rounded-xl border border-line bg-white/[0.02] px-4 py-8 text-center">
                      <p className="text-[13px] font-medium text-ink">{tSection("emptyTitle")}</p>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
                        {tSection("emptyBody")}
                      </p>
                    </div>
                  ) : (
                    scene.matches.map((match) => (
                      <MatchCard
                        key={match.id}
                        match={match}
                        timecode={scene.timecode}
                        active={selectedMatch?.id === match.id}
                        onSelect={() => selectByMatch(match.id)}
                        compact
                      />
                    ))
                  )}
                </div>

                {/* pista de interacción / detalle de la selección */}
                <div className="mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                  <AnimatePresence mode="wait">
                    {selectedMatch ? (
                      <motion.dl
                        key={selectedMatch.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]"
                      >
                        <div className="col-span-2">
                          <dt className="text-ink-faint">{tSection("detail.object")}</dt>
                          <dd className="mt-0.5 font-medium text-ink">
                            {t(`matches.${selectedMatch.key}.title`)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-faint">{tSection("detail.score")}</dt>
                          <dd className="mt-0.5 font-mono text-ink tabular-nums">
                            {Math.round(selectedMatch.score * 100)}%
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-faint">{tSection("detail.timestamp")}</dt>
                          <dd className="mt-0.5 font-mono text-ink">{scene.timecode}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-faint">{tSection("detail.category")}</dt>
                          <dd className="mt-0.5 text-ink">
                            {t(`categories.${selectedMatch.category}`)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-faint">{tSection("detail.status")}</dt>
                          <dd className="mt-0.5 text-ink">{t(`status.${selectedMatch.status}`)}</dd>
                        </div>
                      </motion.dl>
                    ) : (
                      <motion.p
                        key="hint"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2 text-[11px] leading-relaxed text-ink-subtle"
                      >
                        <MousePointerClick className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                        {tSection("hint")}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-3 text-center text-[11px] text-ink-faint">
            {tSection("disclaimer")}
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
