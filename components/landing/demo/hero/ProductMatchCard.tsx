"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight, Check, Minus } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import {
  ACCENT_CLASSES,
  heroProductById,
  type HeroDemoMatch,
} from "@/lib/landing/heroDemo";

/**
 * Tarjeta de una coincidencia del catálogo.
 *
 * Dos cosas que la tarjeta NO hace, a propósito:
 *
 *  - No dice una marca. Poner "Zara" en una demo insinúa un acuerdo comercial
 *    que no existe; la procedencia honesta es el TIPO de fuente.
 *  - No ofrece comprar. No hay URL de producto detrás, así que el CTA es "ver
 *    coincidencia" y lleva al estudio, no a un checkout inventado.
 *
 * La que no supera el umbral se pinta apagada y sin precio: publicar un precio
 * de algo que el sistema ha decidido retener sería contradecirse.
 */
export function ProductMatchCard({
  match,
  active,
  searching,
  onSelect,
}: {
  readonly match: HeroDemoMatch;
  readonly active: boolean;
  /** El guion está en el paso "buscando" de este producto. */
  readonly searching: boolean;
  readonly onSelect: () => void;
}) {
  const t = useTranslations("landing.heroDemo");
  const tDemo = useTranslations("landing.demo");
  const format = useFormatter();

  const product = heroProductById(match.productId);
  const tone = ACCENT_CLASSES[product.accent];
  const published = match.status === "published";
  const title = t(`products.${match.productId}.title`);

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={t("selectCard", { label: title })}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-all",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        active
          ? cn("border-transparent bg-white/[0.06] ring-1", tone.ring, tone.glow)
          : "border-line bg-white/[0.02] hover:border-line-strong",
        // Lo retenido se atenúa SIEMPRE, activo o no: su estado es la
        // información principal de la tarjeta.
        !published && "opacity-70"
      )}
    >
      {/* Barra de acento: identifica la caja a la que corresponde sin depender
          solo del color de fondo. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 left-0 w-0.5 rounded-full transition-opacity",
          tone.dot,
          active ? "opacity-100" : "opacity-0"
        )}
      />

      <span className="relative size-11 shrink-0 overflow-hidden rounded-lg border border-line bg-canvas sm:size-12">
        <Image
          src={product.src}
          alt=""
          width={product.intrinsic.width}
          height={product.intrinsic.height}
          loading="lazy"
          sizes="48px"
          className="size-full object-contain p-1"
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[11px] font-semibold text-ink sm:text-xs">
            {title}
          </span>
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] text-ink-faint sm:text-[10px]">
          <span>{tDemo(`categories.${match.category}`)}</span>
          <span aria-hidden>·</span>
          <span>{tDemo("source")}</span>
          <span aria-hidden>·</span>
          {/* Marcado explícito como demo: la tarjeta no puede dar a entender
              que hay una ficha comercial real detrás. */}
          <span className="text-ink-subtle">{t("demoProduct")}</span>
        </span>

        <span className="mt-1 flex items-center gap-1.5">
          {searching ? (
            <span className="text-[10px] text-ink-subtle">{t("searching")}</span>
          ) : (
            <>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums sm:text-[10px]",
                  published
                    ? "bg-success/15 text-success"
                    : "bg-white/[0.06] text-ink-muted"
                )}
              >
                {tDemo("scoreShort", { score: Math.round(match.score * 100) })}
              </span>

              {/* Estado, con icono además de color: el color solo no basta. */}
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[9px] font-medium sm:text-[10px]",
                  published ? "text-success" : "text-ink-muted"
                )}
              >
                {published ? (
                  <Check className="size-2.5" aria-hidden />
                ) : (
                  <Minus className="size-2.5" aria-hidden />
                )}
                {published
                  ? tDemo("status.published")
                  : t("belowThreshold")}
              </span>
            </>
          )}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[11px] font-bold text-ink tabular-nums sm:text-xs">
          {match.priceEur != null
            ? format.number(match.priceEur, "eurPrice")
            : tDemo("noPrice")}
        </span>
        {published && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[9px] font-medium transition-colors sm:text-[10px]",
              active ? tone.text : "text-ink-faint group-hover:text-ink-muted"
            )}
          >
            {t("viewMatch")}
            <ArrowUpRight className="size-2.5" aria-hidden />
          </span>
        )}
      </span>
    </motion.button>
  );
}
