"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import type { ComponentProps, ReactNode } from "react";

/**
 * Primitivas de aparición al hacer scroll.
 *
 * Toda la animación de secciones del producto pasa por aquí, para que el ritmo
 * (distancia, duración, easing, escalonado) sea IDÉNTICO en toda la landing.
 * `useReducedMotion` desactiva el desplazamiento cuando el sistema lo pide:
 * el contenido aparece igual, sin movimiento.
 */

const EASE = [0.22, 0.61, 0.36, 1] as const;

export function Reveal({
  children,
  delay = 0,
  y = 22,
  once = true,
  amount = 0.35,
  ...props
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  once?: boolean;
  amount?: number;
} & Omit<ComponentProps<typeof motion.div>, "children">) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, amount }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/** Contenedor que escalona la entrada de sus `RevealItem`. */
export function RevealGroup({
  children,
  stagger = 0.08,
  delay = 0,
  amount = 0.25,
  ...props
}: {
  children: ReactNode;
  stagger?: number;
  delay?: number;
  amount?: number;
} & Omit<ComponentProps<typeof motion.div>, "children">) {
  const variants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren: delay } },
  };
  return (
    <motion.div
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  y = 18,
  ...props
}: { children: ReactNode; y?: number } & Omit<ComponentProps<typeof motion.div>, "children">) {
  const reduce = useReducedMotion();
  const variants: Variants = {
    hidden: { opacity: 0, y: reduce ? 0 : y },
    show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
  };
  return (
    <motion.div variants={variants} {...props}>
      {children}
    </motion.div>
  );
}
