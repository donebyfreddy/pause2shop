"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import type { ProductCandidate } from "@/lib/matching/types";
import { cn } from "@/lib/utils";
import { MatchScoreBadge, MatchSourceBadge, MatchTypeBadge } from "./MatchSourceBadge";

/**
 * Tarjeta de un resultado DE INTERNET.
 *
 * Estructuralmente parecida a la del catálogo pero deliberadamente NO idéntica:
 * acento cian, el merchant siempre visible y el CTA dice "abrir resultado
 * externo", no "ver producto". Un usuario que mira la tarjeta a media distancia
 * tiene que poder decir de qué fuente es sin leer el badge.
 */

function formatPrice(
  format: ReturnType<typeof useFormatter>,
  price: number | null | undefined,
  currency: string | null | undefined
): string | null {
  if (price == null || !Number.isFinite(price)) return null;
  try {
    return format.number(price, {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    });
  } catch {
    return `${price} ${currency ?? ""}`.trim();
  }
}

/** Dominio legible del resultado, para que se vea de qué tienda viene. */
function merchantLabel(candidate: ProductCandidate): string | null {
  if (candidate.merchant) return candidate.merchant;
  if (!candidate.productUrl) return null;
  try {
    return new URL(candidate.productUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

type Props = {
  candidate: ProductCandidate;
  variant?: "primary" | "alternative";
  provider?: string | null;
};

export default function ExternalCandidateCard({
  candidate,
  variant = "primary",
  provider,
}: Props) {
  const t = useTranslations("studio.matching.external");
  const format = useFormatter();
  const price = formatPrice(format, candidate.price, candidate.currency);
  const merchant = merchantLabel(candidate);

  if (variant === "alternative") {
    return (
      <a
        href={candidate.productUrl ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex w-40 shrink-0 flex-col gap-1.5 rounded-lg border border-accent/20 bg-accent/[0.04] p-2",
          "transition-colors hover:border-accent/40 hover:bg-accent/[0.09]"
        )}
      >
        <div className="aspect-square w-full overflow-hidden rounded-md bg-white/[0.04]">
          {/* Resultados de dominios arbitrarios de Internet: no se pueden
              declarar en la config de next/image. */}
          {candidate.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- dominios no enumerables
            <img
              src={candidate.imageUrl}
              alt={candidate.title}
              loading="lazy"
              className="size-full object-cover"
            />
          ) : null}
        </div>
        <p className="line-clamp-2 text-[11px] font-medium text-ink" title={candidate.title}>
          {candidate.title}
        </p>
        <span className="flex flex-wrap items-center gap-1">
          <MatchScoreBadge score={candidate.score} source="external" />
          {price ? (
            <span className="text-[11px] font-semibold text-ink-muted tabular-nums">{price}</span>
          ) : null}
        </span>
        {merchant ? (
          <span className="truncate text-[10px] text-ink-faint">{merchant}</span>
        ) : null}
      </a>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="size-24 shrink-0 overflow-hidden rounded-lg bg-white/[0.04] sm:size-28">
        {candidate.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- dominios no enumerables
          <img
            src={candidate.imageUrl}
            alt={candidate.title}
            className="size-full object-cover"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug text-ink">{candidate.title}</p>
        {candidate.brand ? (
          <p className="mt-0.5 text-[11px] text-ink-muted">{candidate.brand}</p>
        ) : null}

        {/* Ver comentario equivalente en CatalogCandidateCard: la procedencia
            viaja con el resultado, nunca solo con la sección. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-accent/35 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
            Candidato externo
          </span>
          <MatchSourceBadge source="external" />
          <MatchTypeBadge matchType={candidate.matchType} source="external" />
          <MatchScoreBadge score={candidate.score} source="external" />
          {price ? (
            <span className="text-xs font-bold text-ink tabular-nums">{price}</span>
          ) : null}
        </div>

        {merchant ? (
          <p className="mt-1 text-[11px] text-ink-muted">{merchant}</p>
        ) : null}
        {provider ? (
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {t("provider", { provider })}
          </p>
        ) : null}

        {candidate.productUrl ? (
          <a
            href={candidate.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "mt-2 inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/12 px-2.5 py-1",
              "text-[11px] font-semibold text-accent transition-colors hover:bg-accent/22"
            )}
          >
            {t("open")}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>
    </div>
  );
}
