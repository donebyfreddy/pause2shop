"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { recommendationMatchType } from "@/lib/catalog/images";
import type { CatalogListItem, FrameSourceType } from "@/lib/catalog/types";
import { formatTimestamp } from "@/lib/utils";
import {
  Chip,
  ConfidenceBadge,
  ItemThumb,
  MatchTypeBadge,
  StatusBadge,
  useSourceTypeLabels,
  useTypeLabels,
} from "./catalogUi";

function useOriginLabel() {
  const t = useTranslations("publicCatalog.card");
  return (sourceType: FrameSourceType | null, timestampSeconds: number): string => {
    if (sourceType === "image_upload") return t("originImage");
    if (sourceType === "screen_capture") return t("originScreen");
    return `⏱ ${formatTimestamp(timestampSeconds)}`;
  };
}

function OriginChip({ sourceType }: Readonly<{ sourceType: FrameSourceType }>) {
  const labels = useSourceTypeLabels();
  const label = labels[sourceType];
  if (!label) return null;
  return <Chip>{label}</Chip>;
}

type Props = {
  item: CatalogListItem;
  busy?: boolean;
  onOpen: (item: CatalogListItem) => void;
  onIgnore: (item: CatalogListItem) => void;
  onReview: (item: CatalogListItem) => void;
};

export default function CatalogItemCard({ item, busy, onOpen, onIgnore, onReview }: Readonly<Props>) {
  const t = useTranslations("publicCatalog.card");
  const format = useFormatter();
  const typeLabels = useTypeLabels();
  const originLabel = useOriginLabel();
  const best = item.bestMatch;
  const matchType = best ? recommendationMatchType(best) : null;
  const hasDetectedImage = Boolean(item.imageCropUrl || item.frameImageUrl);
  const [matchThumbBroken, setMatchThumbBroken] = useState(false);

  return (
    <article
      className={
        "group flex flex-col overflow-hidden rounded-2xl border border-line bg-white/[0.03] transition hover:border-line-strong hover:bg-white/[0.05]" +
        (item.status === "ignored" ? " opacity-60" : "")
      }
    >
      <button
        onClick={() => onOpen(item)}
        className="relative block aspect-square w-full overflow-hidden text-left"
        title={t("viewDetailTitle")}
      >
        {/* Imagen principal: crop REAL detectado en el vídeo (con fallbacks). */}
        <ItemThumb
          item={item}
          matchImageUrl={best?.imageUrl}
          className="h-full w-full transition group-hover:scale-[1.03]"
        />
        <span className="absolute left-2 top-2">
          <StatusBadge status={item.status} />
        </span>
        <span className="absolute right-2 top-2">
          <ConfidenceBadge value={item.confidence} />
        </span>
        {hasDetectedImage && (
          <span className="absolute bottom-2 left-2 rounded-full border border-brand-bright/30 bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-brand-bright">
            {t("detectedInVideo")}
          </span>
        )}
        {/* Miniatura del producto encontrado en Internet, para comparar. */}
        {best?.imageUrl && !matchThumbBroken && (
          <span
            className="absolute bottom-2 right-2 block h-14 w-14 overflow-hidden rounded-lg border-2 border-success/60 bg-black/70 shadow-lg"
            title={t("foundProductTitle", { title: best.title })}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={best.imageUrl}
              alt={best.title}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setMatchThumbBroken(true)}
            />
          </span>
        )}
        {item.detectionCount > 1 && (
          <span className="absolute right-2 top-8 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-ink-muted">
            ×{item.detectionCount}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-ink">
          {item.name}
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {item.type && <Chip>{typeLabels[item.type] ?? item.type}</Chip>}
          <Chip>{item.category}</Chip>
          {item.color && <Chip>{item.color}</Chip>}
          {item.style && <Chip>{item.style}</Chip>}
        </div>

        {/* Estado del matching: producto encontrado vs búsqueda en curso. */}
        {best ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
            <MatchTypeBadge matchType={matchType} />
            {best.similarityScore != null && (
              <span title={t("matchScoreTooltip")} className="text-accent">
                {t("matchPct", { pct: Math.round(best.similarityScore * 100) })}
              </span>
            )}
            <span className="line-clamp-1 min-w-0 flex-1">
              {best.brand ? `${best.brand} · ` : ""}
              {best.provider}
              {best.price != null
                ? ` · ${format.number(best.price, { style: "currency", currency: best.currency ?? "EUR" })}`
                : ""}
            </span>
          </div>
        ) : (
          item.status === "detected" && (
            <p className="text-[11px] text-ink-subtle">{t("searchingMatches")}</p>
          )
        )}

        {item.imagePersistenceStatus === "local_only" && (
          <p className="text-[10px] text-warning/70">{t("localOnlyNotice")}</p>
        )}

        <p className="text-[11px] text-ink-subtle">
          {originLabel(item.sourceType, item.timestampSeconds)}
          {item.visibleBrand ? ` · ${t("brandPrefix", { brand: item.visibleBrand })}` : ""}
        </p>
        {item.sourceType && item.sourceType !== "uploaded" && item.sourceType !== "external_url" && (
          <OriginChip sourceType={item.sourceType} />
        )}

        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <button
            onClick={() => onOpen(item)}
            className="rounded-lg bg-gradient-to-br from-brand to-magenta px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110"
          >
            {t("viewDetail")}
          </button>
          {best && (
            <a
              href={best.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-success/30 bg-success/10 px-2.5 py-1.5 text-[11px] font-semibold text-success transition hover:bg-success/20"
            >
              {t("viewProduct")}
            </a>
          )}
          {item.status !== "reviewed" && (
            <button
              onClick={() => onReview(item)}
              disabled={busy}
              className="rounded-lg border border-line bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-ink transition hover:bg-white/10 disabled:opacity-40"
            >
              {t("markReviewed")}
            </button>
          )}
          {item.status !== "ignored" ? (
            <button
              onClick={() => onIgnore(item)}
              disabled={busy}
              className="rounded-lg border border-line bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-ink-muted transition hover:border-danger/30 hover:text-danger disabled:opacity-40"
            >
              {t("ignore")}
            </button>
          ) : (
            <button
              onClick={() => onReview(item)}
              disabled={busy}
              className="rounded-lg border border-line bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-ink-muted transition hover:text-ink disabled:opacity-40"
            >
              {t("reactivate")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
