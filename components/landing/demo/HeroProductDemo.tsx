"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ScanSearch } from "lucide-react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  HERO_DEMO_PRODUCTS,
  HERO_DEMO_STEPS,
  HERO_DEMO_STEP_MS,
  type HeroDemoProductId,
} from "@/lib/landing/heroDemo";
import { DemoScene } from "./hero/DemoScene";
import { DetectionOverlay } from "./hero/DetectionOverlay";
import { ProductMatchPanel } from "./hero/ProductMatchPanel";
import { DemoPlaybackControls } from "./hero/DemoPlaybackControls";

/**
 * Demo del hero: la promesa de la landing en movimiento, con producto real.
 *
 * Sustituye a la ilustración SVG de formas genéricas. El argumento que tiene
 * que quedar claro en 10 segundos es la cadena completa:
 *
 *   escena → detección → caja + etiqueta → búsqueda en catálogo →
 *   coincidencia con score → publicada o retenida por el umbral
 *
 * Restricciones que sigue cumpliendo respecto de la versión anterior:
 *
 *  - **Cero red.** Detecciones y coincidencias son datos locales
 *    (`lib/landing/heroDemo.ts`) y las imágenes son WebP servidos desde
 *    `public/`. Si el catálogo está caído, el hero se ve igual.
 *  - **Pausable de verdad.** El control detiene el temporizador.
 *  - **`prefers-reduced-motion`.** No arranca sola: se muestra el estado final
 *    completo —las tres detecciones y las tres coincidencias— de forma
 *    estática. La información es la misma; lo que desaparece es el movimiento.
 *  - **Interacción manda sobre el guion.** En cuanto alguien pasa el ratón o
 *    hace clic, la reproducción automática se detiene: seguir avanzando por
 *    debajo mientras el usuario explora es desconcertante.
 */

const ALL_IDS = HERO_DEMO_PRODUCTS.map((p) => p.id);

export function HeroProductDemo() {
  const t = useTranslations("landing.heroDemo");
  const prefersReduced = usePrefersReducedMotion();

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  /**
   * Selección FIJADA con clic y realce TRANSITORIO por hover, separados.
   *
   * Con una sola variable, el ratón rompía el clic: al acercarse, el
   * `mouseenter` ya fijaba el producto, y el clic que venía justo detrás lo
   * alternaba de vuelta a "nada" — pinchar una caja parecía no hacer nada. Con
   * las dos, el hover solo previsualiza y el clic gobierna la selección.
   */
  const [pinnedId, setPinnedId] = useState<HeroDemoProductId | null>(null);
  const [hoveredId, setHoveredId] = useState<HeroDemoProductId | null>(null);
  /**
   * El usuario ya ha tocado la demo alguna vez.
   *
   * A partir de ese momento se enseña todo y no se vuelve al estado parcial del
   * guion: si no, al retirar el ratón las cajas DESAPARECÍAN —el guion seguía
   * pausado en un paso temprano— y parecía que la demo se había roto.
   */
  const [touched, setTouched] = useState(false);

  const autoplay = playing && !prefersReduced;

  useEffect(() => {
    if (!autoplay) return;
    const id = window.setInterval(
      () => setStep((s) => (s + 1) % HERO_DEMO_STEPS.length),
      HERO_DEMO_STEP_MS
    );
    return () => window.clearInterval(id);
  }, [autoplay]);

  const current = HERO_DEMO_STEPS[step];

  /**
   * Qué hay revelado en cada momento.
   *
   * Con movimiento reducido —o con el guion terminado, o con selección
   * manual— se enseña todo: el estado parcial solo tiene sentido mientras la
   * secuencia lo está construyendo delante de ti.
   */
  const { revealed, resolved, searchingId } = useMemo(() => {
    if (prefersReduced || touched) {
      return { revealed: ALL_IDS, resolved: ALL_IDS, searchingId: null };
    }
    const revealedIds: HeroDemoProductId[] = [];
    const resolvedIds: HeroDemoProductId[] = [];
    let searching: HeroDemoProductId | null = null;

    for (let i = 0; i <= step; i++) {
      const s = HERO_DEMO_STEPS[i];
      if (!s.productId) continue;
      if (!revealedIds.includes(s.productId)) revealedIds.push(s.productId);
      if (s.phase === "match" && !resolvedIds.includes(s.productId)) {
        resolvedIds.push(s.productId);
      }
    }
    // El paso "detect" del producto en curso muestra su tarjeta buscando: es
    // el eslabón que conecta la caja con el panel.
    if (current.phase === "detect" && current.productId) {
      searching = current.productId;
    }
    return { revealed: revealedIds, resolved: resolvedIds, searchingId: searching };
  }, [step, current, prefersReduced, touched]);

  // El hover manda sobre lo fijado, y lo fijado sobre el guion.
  const activeId = hoveredId ?? pinnedId ?? current.productId;

  /** Clic: fija (o suelta) el producto y congela el guion. */
  const select = useCallback((id: HeroDemoProductId) => {
    setPinnedId((prev) => (prev === id ? null : id));
    setTouched(true);
    setPlaying(false);
  }, []);

  /** Hover/foco: solo previsualiza. No toca la selección fijada. */
  const hover = useCallback((id: HeroDemoProductId) => {
    setHoveredId(id);
    setTouched(true);
    setPlaying(false);
  }, []);

  const restart = useCallback(() => {
    setPinnedId(null);
    setHoveredId(null);
    setTouched(false);
    setStep(0);
    setPlaying(true);
  }, []);

  return (
    <div className="relative">
      {/* halo: profundidad sin animar blur (coste de compositor) */}
      <div
        aria-hidden
        className="absolute -inset-4 rounded-[2rem] bg-brand/15 blur-3xl sm:-inset-6"
      />

      <div className="panel relative overflow-hidden shadow-panel">
        {/* ---------------------------- barra superior --------------------------- */}
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4 sm:py-2.5">
          <div className="hidden gap-1.5 sm:flex" aria-hidden>
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
          </div>

          <p className="truncate font-mono text-[10px] text-ink-faint sm:ml-2 sm:text-[11px]">
            {t("sceneCaption")}
          </p>

          <span className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-ink-muted sm:inline-flex">
            {t("demoBadge")}
          </span>

          <DemoPlaybackControls
            playing={autoplay}
            onToggle={() => {
              setPinnedId(null);
              setHoveredId(null);
              setPlaying((p) => !p);
              // Reanudar vuelve al guion; pausar deja todo a la vista.
              setTouched((prev) => (playing ? true : prev));
            }}
            onRestart={restart}
            className="ml-auto sm:ml-2"
          />
        </div>

        {/* En móvil la escena va arriba y el panel debajo; a partir de `lg`
            comparten fila con la escena dominante (≈65/35). */}
        <div className="grid lg:grid-cols-[1.65fr_1fr]">
          {/* ------------------------------ la escena ---------------------------- */}
          <div
            className="relative aspect-video overflow-hidden border-line bg-canvas lg:border-r"
            onMouseLeave={() => setHoveredId(null)}
          >
            <DemoScene activeId={activeId} dimInactive={!prefersReduced} />

            {/* Línea de escaneo: la metáfora de "analizar el frame". Solo
                mientras el guion corre — con la demo pausada sería ruido. */}
            {autoplay && (
              <div aria-hidden className="absolute inset-0 overflow-hidden">
                <div className="animate-scan absolute inset-x-0 h-20 bg-linear-to-b from-transparent via-accent/20 to-transparent">
                  <div className="absolute bottom-0 h-px w-full bg-accent/70 shadow-[0_0_16px_2px_rgba(34,211,238,0.6)]" />
                </div>
              </div>
            )}

            <DetectionOverlay
              revealed={revealed}
              activeId={activeId}
              onSelect={select}
              onHover={hover}
            />

            {/* Contador de detecciones. Antes repetía el rótulo de la barra
                superior palabra por palabra; aquí lo útil es cuántas cajas se
                llevan dibujadas, que además avanza con la secuencia. */}
            <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 rounded-lg border border-line bg-canvas/85 px-2 py-1 backdrop-blur-sm sm:bottom-3 sm:left-3 sm:px-2.5 sm:py-1.5">
              <ScanSearch className="size-3.5 shrink-0 text-accent" aria-hidden />
              <span className="font-mono text-[9px] text-ink-muted sm:text-[10px]">
                {t("detectedCount", { count: revealed.length })}
              </span>
            </div>
          </div>

          {/* --------------------------- panel de resultados ---------------------- */}
          <ProductMatchPanel
            resolved={resolved}
            activeId={activeId}
            searchingId={searchingId}
            onSelect={select}
          />
        </div>
      </div>
    </div>
  );
}
