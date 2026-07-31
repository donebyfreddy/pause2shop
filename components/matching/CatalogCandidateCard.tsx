"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import type { ProductCandidate } from "@/lib/matching/types";
import { cn } from "@/lib/utils";
import { MatchScoreBadge, MatchSourceBadge, MatchTypeBadge } from "./MatchSourceBadge";

/**
 * Tarjeta de un producto DEL CATÁLOGO propio.
 *
 * Dos variantes: `primary` (la coincidencia seleccionada, imagen grande y CTA)
 * y `alternative` (compacta, para la lista horizontal de alternativas).
 *
 * Las fichas de dataset (`isDemoProduct`) no ofrecen "Ver producto": no tienen
 * URL de compra y presentarlas con un CTA de compra sería prometer algo que no
 * existe. Se marcan explícitamente en su lugar.
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
    // Divisa desconocida: se muestra el número con el código tal cual antes
    // que no mostrar precio.
    return `${price} ${currency ?? ""}`.trim();
  }
}

type Props = {
  candidate: ProductCandidate;
  variant?: "primary" | "alternative";
  onSelect?: (candidate: ProductCandidate) => void;
};

export default function CatalogCandidateCard({
  candidate,
  variant = "primary",
  onSelect,
}: Props) {
  const t = useTranslations("studio.matching.catalog");
  const format = useFormatter();
  const price = formatPrice(format, candidate.price, candidate.currency);
  const purchasable = Boolean(candidate.productUrl) && !candidate.isDemoProduct;

  if (variant === "alternative") {
    return (
      <button
        type="button"
        onClick={onSelect ? () => onSelect(candidate) : undefined}
        className={cn(
          "group flex w-40 shrink-0 flex-col gap-1.5 rounded-lg border border-brand/20 bg-brand/[0.04] p-2 text-left",
          "transition-colors hover:border-brand/40 hover:bg-brand/[0.09]",
          onSelect ? "cursor-pointer" : "cursor-default"
        )}
      >
        <div className="aspect-square w-full overflow-hidden rounded-md bg-white/[0.04]">
          {/* Imágenes de dominios arbitrarios del catálogo: next/image exigiría
              declarar cada host en la config y un host nuevo rompería la tarjeta. */}
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
          <MatchScoreBadge score={candidate.score} source="catalog" />
          {price ? (
            <span className="text-[11px] font-semibold text-ink-muted tabular-nums">{price}</span>
          ) : null}
        </span>
      </button>
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

        {/* La FUENTE va en la propia tarjeta, no solo en la cabecera de la
            sección: al desplazarse, o al comparar dos tarjetas, la cabecera
            queda fuera de vista y un resultado sin procedencia visible es
            exactamente lo que esta UI viene a evitar. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <MatchSourceBadge source="catalog" />
          <MatchTypeBadge matchType={candidate.matchType} source="catalog" />
          <MatchScoreBadge score={candidate.score} source="catalog" />
          {price ? (
            <span className="text-xs font-bold text-ink tabular-nums">{price}</span>
          ) : (
            <span className="text-[11px] text-ink-faint">{t("noPrice")}</span>
          )}
        </div>

        {candidate.isDemoProduct ? (
          <p className="mt-1.5 text-[11px] text-ink-faint">{t("demoProduct")}</p>
        ) : null}

        {purchasable ? (
          <a
            href={candidate.productUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "mt-2 inline-flex items-center gap-1 rounded-lg border border-brand/40 bg-brand/15 px-2.5 py-1",
              "text-[11px] font-semibold text-brand-bright transition-colors hover:bg-brand/25"
            )}
          >
            {t("viewProduct")}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}

        {candidate.evidence?.length ? (
          <ul className="mt-2 space-y-0.5">
            {candidate.evidence.slice(0, 3).map((line) => (
              <li key={line} className="text-[11px] text-ink-muted">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
