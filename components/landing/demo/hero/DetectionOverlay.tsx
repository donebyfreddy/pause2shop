"use client";

import { AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import {
  HERO_DEMO_DETECTIONS,
  type HeroDemoProductId,
} from "@/lib/landing/heroDemo";
import { DetectionBox } from "./DetectionBox";

/**
 * Capa de detecciones sobre la escena.
 *
 * Solo pinta las cajas ya "descubiertas" por la secuencia: el guion cuenta una
 * historia (detectar → resolver, objeto a objeto) y dibujarlas todas desde el
 * primer frame la desmonta. Cuando el usuario interactúa, el componente padre
 * revela todas y el overlay pasa a ser un selector normal.
 */
export function DetectionOverlay({
  revealed,
  activeId,
  onSelect,
  onHover,
}: {
  /** Ids ya visibles. El orden fija el retardo de entrada. */
  readonly revealed: readonly HeroDemoProductId[];
  readonly activeId: HeroDemoProductId | null;
  readonly onSelect: (id: HeroDemoProductId) => void;
  readonly onHover: (id: HeroDemoProductId) => void;
}) {
  const t = useTranslations("landing.heroDemo");

  return (
    // z-10: por encima del orden de profundidad interno de la escena.
    <div className="absolute inset-0 z-10">
      <AnimatePresence>
        {HERO_DEMO_DETECTIONS.filter((d) => revealed.includes(d.id)).map(
          (detection, index) => {
            const label = t(`products.${detection.id}.label`);
            return (
              <DetectionBox
                key={detection.id}
                bbox={detection.bbox}
                accent={detection.accent}
                label={label}
                confidence={detection.confidence}
                active={activeId === detection.id}
                ariaLabel={t("selectDetection", {
                  label,
                  confidence: Math.round(detection.confidence * 100),
                })}
                onSelect={() => onSelect(detection.id)}
                onHover={() => onHover(detection.id)}
                delay={index * 0.05}
              />
            );
          }
        )}
      </AnimatePresence>
    </div>
  );
}
