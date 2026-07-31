"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import type { DemoObject } from "@/lib/landing/demoScene";
import { cn } from "@/lib/ui/cn";

/**
 * Capa de detección sobre el frame de demostración: cajas, etiquetas y
 * hotspots.
 *
 * Dos modos:
 *
 *  - **decorativo** (`onSelect` ausente): el hero. Todo es `aria-hidden` y no
 *    hay nada enfocable — es una ilustración animada, y ofrecer tabstops que no
 *    llevan a ninguna parte sería peor que no ofrecerlos.
 *  - **interactivo** (`onSelect` presente): la demo central. Cada objeto es un
 *    `<button>` real con `aria-pressed`, así que la sincronía caja ↔ tarjeta
 *    funciona con teclado y se anuncia el estado seleccionado.
 */

export function DetectionOverlay({
  objects,
  activeId,
  onSelect,
  sceneKey,
  showLabels = true,
}: {
  objects: readonly DemoObject[];
  activeId: string | null;
  onSelect?: (id: string) => void;
  sceneKey: string;
  showLabels?: boolean;
}) {
  const t = useTranslations("landing.demo");
  const interactive = typeof onSelect === "function";

  return (
    <div className={cn("absolute inset-0", !interactive && "pointer-events-none")} aria-hidden={!interactive}>
      <AnimatePresence>
        {objects.map((object, index) => {
          const active = activeId === object.id;
          const label = t(`objects.${object.key}`);
          const relationship = t(`relationship.${object.relationship}`);

          const box = (
            <>
              {/* esquinas: leen como "mira de cámara", no como borde de div */}
              {["-top-px -left-px", "-top-px -right-px", "-bottom-px -left-px", "-bottom-px -right-px"].map(
                (pos) => (
                  <span
                    key={pos}
                    className={cn(
                      "absolute size-2 rounded-[2px] transition-colors",
                      pos,
                      active ? "bg-accent" : "bg-brand-bright"
                    )}
                  />
                )
              )}

              {showLabels && (
                <span
                  className={cn(
                    "absolute -top-[26px] left-0 flex max-w-[180px] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap shadow-lg transition-colors",
                    active ? "bg-accent text-canvas" : "bg-brand-bright text-white"
                  )}
                >
                  <span className="truncate">{label}</span>
                  <span className="tabular-nums opacity-80">
                    {Math.round(object.confidence * 100)}%
                  </span>
                </span>
              )}

              {/* hotspot en el centro: el objetivo táctil real en móvil */}
              {interactive && (
                <span
                  className={cn(
                    "absolute top-1/2 left-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border transition-colors",
                    active
                      ? "border-accent bg-accent/25"
                      : "border-white/40 bg-canvas/50 group-hover:border-accent/70"
                  )}
                >
                  {!active && (
                    <span className="animate-pulse-ring absolute inset-0 rounded-full border border-accent/50" />
                  )}
                  <span
                    className={cn(
                      "size-1.5 rounded-full transition-colors",
                      active ? "bg-accent" : "bg-white/80"
                    )}
                  />
                </span>
              )}
            </>
          );

          const style = {
            left: `${object.box.x}%`,
            top: `${object.box.y}%`,
            width: `${object.box.w}%`,
            height: `${object.box.h}%`,
          } as const;

          /**
           * Ritmo de entrada y salida de las cajas.
           *
           * La salida es CASI INSTANTÁNEA a propósito: con una salida lenta, al
           * cambiar de escena las cajas de la escena anterior se quedaban
           * dibujadas encima del frame nuevo —etiquetas de "Abrigo largo" sobre
           * un salón— durante casi un segundo. Se vio en una captura del hero.
           *
           * La entrada también se ha acortado: el hero cambia de escena cada
           * 5,2 s, así que cada décima de retardo se paga en bucle.
           */
          const shared = {
            initial: { opacity: 0, scale: 0.9 },
            animate: { opacity: 1, scale: 1 },
            exit: { opacity: 0, scale: 0.98, transition: { duration: 0.1 } },
            transition: {
              duration: 0.3,
              delay: 0.14 + index * 0.12,
              ease: [0.22, 0.61, 0.36, 1] as const,
            },
          };

          if (!interactive) {
            return (
              <motion.div
                key={`${sceneKey}-${object.id}`}
                {...shared}
                style={style}
                className="absolute rounded-lg border-2 border-brand-bright/80 bg-brand/5"
              >
                {box}
              </motion.div>
            );
          }

          return (
            <motion.button
              key={`${sceneKey}-${object.id}`}
              {...shared}
              type="button"
              style={style}
              onClick={() => onSelect?.(object.id)}
              aria-pressed={active}
              aria-label={t("selectObject", {
                label,
                confidence: Math.round(object.confidence * 100),
                relationship,
              })}
              className={cn(
                "group absolute cursor-pointer rounded-lg border-2 transition-colors",
                active
                  ? "border-accent bg-accent/10"
                  : "border-brand-bright/70 bg-brand/5 hover:border-brand-bright"
              )}
            >
              {box}
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
