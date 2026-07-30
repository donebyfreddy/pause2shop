"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, ScanSearch, Sparkles } from "lucide-react";

/**
 * Visual del hero: la metáfora del producto en movimiento.
 *
 * Un frame de vídeo simulado sobre el que (1) pasa una línea de escaneo,
 * (2) aparecen cajas de detección con su etiqueta y (3) sale una tarjeta de
 * coincidencia con score.
 *
 * Es 100% SVG/CSS a propósito: NO usamos fotos de producto de marcas reales
 * para decorar, y así el hero no depende de assets ni de red.
 */

const BOXES = [
  { id: "jacket", label: "Chaqueta de lino", conf: 0.94, x: 30, y: 18, w: 40, h: 34, delay: 1.0 },
  { id: "bag", label: "Bolso shopper", conf: 0.88, x: 63, y: 47, w: 24, h: 24, delay: 1.45 },
  { id: "sneaker", label: "Zapatilla blanca", conf: 0.81, x: 33, y: 71, w: 22, h: 17, delay: 1.9 },
] as const;

export function HeroVisual() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 32, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.9, delay: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
      className="relative mx-auto w-full max-w-4xl"
    >
      {/* halo */}
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[2rem] bg-brand/20 blur-3xl"
      />

      <div className="panel relative overflow-hidden shadow-panel">
        {/* barra de la ventana */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
            <span className="size-2.5 rounded-full bg-surface-3" />
          </div>
          <p className="ml-2 font-mono text-[11px] text-ink-faint">
            estudio · análisis continuo · 00:42
          </p>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
            <span className="size-1.5 animate-pulse rounded-full bg-success" />
            en directo
          </span>
        </div>

        <div className="grid gap-0 lg:grid-cols-[1.55fr_1fr]">
          {/* ---------------- frame analizado ---------------- */}
          <div className="relative aspect-video overflow-hidden border-line bg-canvas lg:border-r">
            {/* "escena" abstracta: siluetas suaves, nada de fotos de marca */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(120% 90% at 30% 10%, #1b1d2b 0%, #0b0c13 55%, #07070c 100%)",
              }}
            />
            <div aria-hidden className="absolute inset-0 grid-backdrop opacity-30" />
            <div
              aria-hidden
              className="absolute top-[14%] left-[32%] h-[62%] w-[36%] rounded-[45%_45%_38%_38%] bg-linear-to-b from-brand/35 via-brand/12 to-transparent blur-xl"
            />
            <div
              aria-hidden
              className="absolute top-[46%] left-[62%] h-[26%] w-[24%] rounded-2xl bg-linear-to-br from-accent/30 to-transparent blur-lg"
            />

            {/* línea de escaneo */}
            {!reduce && (
              <div aria-hidden className="absolute inset-0 overflow-hidden">
                <div className="animate-scan absolute inset-x-0 h-24 bg-linear-to-b from-transparent via-accent/25 to-transparent">
                  <div className="absolute bottom-0 h-px w-full bg-accent/80 shadow-[0_0_18px_2px_rgba(34,211,238,0.7)]" />
                </div>
              </div>
            )}

            {/* cajas de detección */}
            {BOXES.map((box) => (
              <motion.div
                key={box.id}
                initial={{ opacity: 0, scale: reduce ? 1 : 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.45, delay: box.delay, ease: "easeOut" }}
                className="absolute rounded-lg border-2 border-brand-bright/80 bg-brand/5"
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.w}%`,
                  height: `${box.h}%`,
                }}
              >
                {/* esquinas */}
                {["-top-px -left-px", "-top-px -right-px", "-bottom-px -left-px", "-bottom-px -right-px"].map(
                  (pos) => (
                    <span
                      key={pos}
                      className={`absolute ${pos} size-2 rounded-[2px] bg-brand-bright`}
                    />
                  )
                )}
                <motion.span
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: box.delay + 0.18 }}
                  className="absolute -top-6 left-0 flex items-center gap-1.5 rounded-md bg-brand-bright px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white shadow-lg"
                >
                  {box.label}
                  <span className="tabular-nums opacity-80">
                    {Math.round(box.conf * 100)}%
                  </span>
                </motion.span>
              </motion.div>
            ))}

            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-line bg-canvas/80 px-2.5 py-1.5 backdrop-blur-sm">
              <ScanSearch className="size-3.5 text-accent" aria-hidden />
              <span className="font-mono text-[10px] text-ink-muted">
                3 objetos · 1 persona · dedup activo
              </span>
            </div>
          </div>

          {/* ---------------- panel de resultados ---------------- */}
          <div className="flex flex-col gap-2.5 p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
                Coincidencias
              </p>
              <span className="font-mono text-[10px] text-ink-faint">catálogo + Lens</span>
            </div>

            {[
              { title: "Chaqueta de lino relaxed", store: "Catálogo · Zara", price: "59,95 €", score: 0.93, exact: true, delay: 1.6 },
              { title: "Bolso shopper de piel", store: "Catálogo · Mango", price: "79,99 €", score: 0.87, exact: true, delay: 2.0 },
              { title: "Zapatilla low white", store: "Google Lens", price: "—", score: 0.72, exact: false, delay: 2.35 },
            ].map((match) => (
              <motion.div
                key={match.title}
                initial={{ opacity: 0, x: reduce ? 0 : 22 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: match.delay, ease: [0.22, 0.61, 0.36, 1] }}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/70 p-2.5"
              >
                <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-linear-to-br from-surface-3 to-surface-2">
                  <Sparkles className="size-4 text-ink-faint" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-ink">{match.title}</p>
                  <p className="truncate text-[10px] text-ink-subtle">{match.store}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[12px] font-semibold text-ink tabular-nums">{match.price}</p>
                  <p
                    className={
                      "inline-flex items-center gap-0.5 text-[10px] tabular-nums " +
                      (match.exact ? "text-success" : "text-warning")
                    }
                  >
                    {match.exact && <Check className="size-2.5" aria-hidden />}
                    {Math.round(match.score * 100)}%
                  </p>
                </div>
              </motion.div>
            ))}

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2.7 }}
              className="mt-auto rounded-xl border border-line bg-white/[0.02] px-3 py-2"
            >
              <div className="flex items-center justify-between text-[10px] text-ink-subtle">
                <span>Latencia media</span>
                <span className="font-mono text-ink">1,4 s / frame</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "74%" }}
                  transition={{ duration: 1.2, delay: 2.8, ease: "easeOut" }}
                  className="h-full rounded-full bg-linear-to-r from-brand to-accent"
                />
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
