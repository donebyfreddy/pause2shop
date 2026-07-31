"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import { isRtl, type Locale } from "@/i18n/locales";

/**
 * Título del hero con entrada escalonada, palabra a palabra o carácter a
 * carácter según el idioma.
 *
 * Antes se animaba un array de 3 palabras fijas en español — rompía en
 * cualquier otro idioma (número/orden de palabras distinto) y no tenía
 * sentido para zh/ja/ko, donde no hay separación por espacios. Ahora se
 * deriva del propio string traducido: se separa por espacios si el guion
 * lingüístico usa espacios, o por grafema (`Intl.Segmenter`) si no.
 */

const CJK_LOCALES = new Set(["zh-CN", "ja", "ko"]);

function segmentTitle(text: string, locale: Locale): string[] {
  if (CJK_LOCALES.has(locale)) {
    const segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return text.split(" ").filter(Boolean);
}

export function AnimatedHeroTitle({
  text,
  secondLine,
  className,
}: {
  text: string;
  secondLine: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const locale = useLocale() as Locale;
  const rtl = isRtl(locale);
  const units = segmentTitle(text, locale);
  const joiner = CJK_LOCALES.has(locale) ? "" : " ";

  return (
    <h1 className={className}>
      <span className="block">
        {units.map((unit, i) => (
          <motion.span
            key={`${unit}-${i}`}
            initial={{ opacity: 0, y: reduce ? 0 : 24, x: reduce ? 0 : rtl ? 12 : -12, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, x: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.7, delay: 0.1 + i * 0.09, ease: [0.22, 0.61, 0.36, 1] }}
            className="inline-block"
          >
            {unit}
            {joiner}
          </motion.span>
        ))}
      </span>
      <motion.span
        initial={{ opacity: 0, y: reduce ? 0 : 24, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.8, delay: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
        className="text-gradient mt-1 block"
      >
        {secondLine}
      </motion.span>
    </h1>
  );
}
