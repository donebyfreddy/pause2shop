"use client";

import { motion, useScroll, useSpring, type Variants } from "motion/react";
import { Fragment, type ComponentProps, type ReactNode } from "react";

/**
 * Primitivas de movimiento de la landing.
 *
 * Un solo juego de curvas y distancias para toda la página: si el ritmo hay que
 * ajustarlo, se ajusta aquí.
 *
 * ── Movimiento reducido: por qué NO hay `useReducedMotion()` en este fichero ──
 *
 * La primera versión hacía `if (reduce) return <div>{children}</div>`, es decir,
 * cambiaba el ÁRBOL según una media query. Eso provoca un error de hidratación
 * real: el servidor no puede conocer la preferencia del usuario, renderiza la
 * rama con movimiento, y el cliente —si el usuario pide movimiento reducido—
 * renderiza otra distinta en el primer paint. React descarta el HTML del
 * servidor y avisa por consola. Se reprodujo en los E2E con
 * `emulateMedia({ reducedMotion: "reduce" })`.
 *
 * La solución tiene dos mitades y ninguna toca el árbol:
 *
 *  1. `<MotionConfig reducedMotion="user">` en `LocaleProvider`: la propia
 *     librería desactiva las animaciones de transformación cuando el sistema lo
 *     pide, sin que los componentes se enteren.
 *  2. La regla `[data-reveal]` de `globals.css` bajo
 *     `prefers-reduced-motion: reduce`: deja el estado final aplicado desde el
 *     primer paint, así que el contenido no espera a ningún observer.
 *
 * `useReducedMotion()` sigue siendo correcto en efectos y manejadores (parar un
 * temporizador, elegir `behavior: "auto"` en un scroll) — ahí no hay render que
 * pueda divergir. Lo que no se puede es decidir con él QUÉ se renderiza.
 *
 * Solo se animan `transform` y `opacity` (compositor), nunca `filter: blur`
 * sobre superficies grandes ni propiedades que provoquen layout.
 */

const EASE = [0.22, 0.61, 0.36, 1] as const;

/** Se dispara un poco antes de entrar del todo: al llegar ya está resuelto. */
const VIEWPORT = { once: true, amount: 0.2, margin: "0px 0px -8% 0px" } as const;

type DivProps = Omit<ComponentProps<typeof motion.div>, "children">;

/* ------------------------------------------------------------------ FadeIn */

export function FadeIn({
  children,
  delay = 0,
  y = 20,
  x = 0,
  duration = 0.65,
  ...props
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  x?: number;
  duration?: number;
} & DivProps) {
  return (
    <motion.div
      data-reveal
      initial={{ opacity: 0, y, x }}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={VIEWPORT}
      transition={{ duration, delay, ease: EASE }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/* --------------------------------------------------------------- RevealText */

/**
 * Titular que entra por unidades léxicas.
 *
 * Segmenta con `Intl.Segmenter` cuando el idioma no separa por espacios
 * (zh/ja/ko): partir por " " dejaría el titular entero como una sola unidad y
 * la animación no existiría.
 */
export function RevealText({
  text,
  locale,
  className,
  delay = 0,
  as: Tag = "span",
}: {
  text: string;
  locale: string;
  className?: string;
  delay?: number;
  as?: "span" | "h1" | "h2";
}) {
  const spaceless = /^(zh|ja|ko|th)/.test(locale);
  const units = spaceless
    ? Array.from(
        new Intl.Segmenter(locale, { granularity: "word" }).segment(text),
        (s) => s.segment
      )
    : text.split(" ").filter(Boolean);
  const joiner = spaceless ? "" : " ";

  return (
    <Tag className={className}>
      {/* El texto completo queda accesible como una sola cadena para lectores
          de pantalla; las unidades visuales van marcadas como decorativas. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {units.map((unit, i) => (
          <Fragment key={`${unit}-${i}`}>
            <motion.span
              data-reveal
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: delay + i * 0.055, ease: EASE }}
              className="inline-block"
            >
              {unit}
            </motion.span>
            {/* El separador va FUERA del span animado. Dentro no funciona: un
                espacio al final del contenido de un `inline-block` lo elimina el
                algoritmo de línea, y el titular sale con todas las palabras
                pegadas. Como nodo de texto hermano entre dos inline-block sí se
                conserva. */}
            {joiner && i < units.length - 1 ? " " : null}
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}

/* ----------------------------------------------------------- StaggerGroup */

const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};

export function StaggerGroup({
  children,
  delay = 0,
  stagger = 0.07,
  ...props
}: { children: ReactNode; delay?: number; stagger?: number } & DivProps) {
  return (
    <motion.div
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, ...props }: { children: ReactNode } & DivProps) {
  return (
    <motion.div data-reveal variants={ITEM_VARIANTS} {...props}>
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------- MotionCard */

/**
 * Superficie con elevación al hover. El realce va por `transform` + color de
 * borde: nada que provoque reflow. Con movimiento reducido, `MotionConfig` se
 * encarga de que la transformación no se anime.
 */
export function MotionCard({
  children,
  lift = 3,
  ...props
}: { children: ReactNode; lift?: number } & DivProps) {
  return (
    <motion.div
      whileHover={{ y: -lift }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/* ---------------------------------------------------------- ScrollProgress */

/** Barra de progreso de lectura, fijada bajo la cabecera. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-60 h-0.5 origin-left bg-linear-to-r from-brand via-brand-bright to-accent"
    />
  );
}

export { ITEM_VARIANTS, EASE, VIEWPORT };
