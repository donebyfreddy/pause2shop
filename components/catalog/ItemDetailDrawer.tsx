"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  isDataUrl,
  pickBestRecommendation,
  recommendationMatchType,
} from "@/lib/catalog/images";
import type {
  CatalogItem,
  CatalogItemWithRecommendations,
  ProductRecommendation,
} from "@/lib/catalog/types";
import { formatTimestamp } from "@/lib/utils";
import {
  Chip,
  ConfidenceBadge,
  ItemThumb,
  MatchTypeBadge,
  StatusBadge,
  useTypeLabels,
} from "./catalogUi";

type Props = {
  item: CatalogItemWithRecommendations | null;
  open: boolean;
  loadingDetail: boolean;
  searching: boolean;
  busy: boolean;
  onClose: () => void;
  onSearchProducts: (item: CatalogItem) => void;
  onSetStatus: (item: CatalogItem, status: CatalogItem["status"]) => void;
  onRecommendationClick: (item: CatalogItem, rec: ProductRecommendation) => void;
};

export default function ItemDetailDrawer({
  item,
  open,
  loadingDetail,
  searching,
  busy,
  onClose,
  onSearchProducts,
  onSetStatus,
  onRecommendationClick,
}: Readonly<Props>) {
  const t = useTranslations("publicCatalog.drawer");
  return (
    <>
      <div
        onClick={onClose}
        className={
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity " +
          (open ? "opacity-100" : "pointer-events-none opacity-0")
        }
        aria-hidden
      />
      <aside
        className={
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-line bg-canvas shadow-2xl transition-transform duration-300 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
        role="dialog"
        aria-label={t("ariaLabel")}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
          <button
            onClick={onClose}
            className="rounded-lg border border-line bg-white/5 px-2.5 py-1 text-sm text-ink-muted transition hover:bg-white/10"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!item ? (
            <EmptyBody loadingDetail={loadingDetail} />
          ) : (
            <DrawerBody
              item={item}
              searching={searching}
              busy={busy}
              onSearchProducts={onSearchProducts}
              onSetStatus={onSetStatus}
              onRecommendationClick={onRecommendationClick}
            />
          )}
        </div>
      </aside>
    </>
  );
}

function EmptyBody({ loadingDetail }: Readonly<{ loadingDetail: boolean }>) {
  const t = useTranslations("publicCatalog.drawer");
  return loadingDetail ? (
    <p className="py-12 text-center text-sm text-ink-subtle">{t("loading")}</p>
  ) : (
    <p className="py-12 text-center text-sm text-ink-subtle">{t("selectItem")}</p>
  );
}

function DrawerBody({
  item,
  searching,
  busy,
  onSearchProducts,
  onSetStatus,
  onRecommendationClick,
}: Readonly<{
  item: CatalogItemWithRecommendations;
  searching: boolean;
  busy: boolean;
  onSearchProducts: (item: CatalogItem) => void;
  onSetStatus: (item: CatalogItem, status: CatalogItem["status"]) => void;
  onRecommendationClick: (item: CatalogItem, rec: ProductRecommendation) => void;
}>) {
  const t = useTranslations("publicCatalog.drawer");
  const format = useFormatter();
  const typeLabels = useTypeLabels();
  const best = pickBestRecommendation(item.recommendations);
  const alternatives = item.recommendations.filter((r) => r.id !== best?.id);

  return (
    <div className="space-y-5">
      {/* SECCIÓN A — Detectado en el vídeo */}
      <section>
        <SectionTitle>{t("sectionDetected")}</SectionTitle>
        <div className="overflow-hidden rounded-2xl border border-brand-bright/20">
          <ItemThumb item={item} className="aspect-video w-full" />
        </div>
        {!item.imageCropUrl && !item.frameImageUrl && (
          <p className="mt-2 text-[11px] text-ink-subtle">{t("noCaptureYet")}</p>
        )}

        <div className="mt-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-ink">{item.name}</h3>
            <ConfidenceBadge value={item.confidence} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={item.status} />
            {item.type && <Chip>{typeLabels[item.type] ?? item.type}</Chip>}
            <Chip>{item.category}</Chip>
            {item.detectionCount > 1 && (
              <Chip>{t("seenCount", { count: item.detectionCount })}</Chip>
            )}
          </div>
          {item.description && (
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              {item.description}
            </p>
          )}
        </div>

        <div className="mt-3 space-y-1.5">
          <Spec label={t("specs.moment")} value={formatTimestamp(item.timestampSeconds)} />
          <Spec label={t("specs.subcategory")} value={item.subcategory} />
          <Spec label={t("specs.color")} value={item.color} />
          <Spec label={t("specs.otherColors")} value={item.secondaryColors.join(", ")} />
          <Spec label={t("specs.style")} value={item.style} />
          <Spec label={t("specs.pattern")} value={item.pattern} />
          <Spec label={t("specs.materialGuess")} value={item.materialGuess} />
          <Spec label={t("specs.genderFit")} value={item.genderFit} />
          <Spec label={t("specs.visibleBrand")} value={item.visibleBrand} />
        </div>

        {/* Frame de origen completo, si se guardó (contexto de la escena). */}
        {item.frameImageUrl && item.imageCropUrl && (
          <details className="mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-ink-muted">
              {t("viewOriginalFrame")}
            </summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.frameImageUrl}
              alt={t("originalFrameAlt", { name: item.name })}
              className="mt-2 w-full rounded-lg"
            />
          </details>
        )}
      </section>

      {/* SECCIÓN B — Mejor coincidencia en Internet */}
      <section className="border-t border-line pt-4">
        <SectionTitle>{t("sectionBestMatch")}</SectionTitle>
        {best ? (
          <BestMatchCard
            rec={best}
            onClick={() => onRecommendationClick(item, best)}
          />
        ) : (
          <p className="text-sm text-ink-subtle">
            {searching ? t("searchingBestMatch") : t("noReliableMatch")}
          </p>
        )}
      </section>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          onClick={() => onSearchProducts(item)}
          disabled={searching}
          className="rounded-lg bg-gradient-to-br from-brand to-magenta px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {searching ? t("searching") : t("searchProducts")}
        </button>
        {item.status !== "reviewed" && (
          <button
            onClick={() => onSetStatus(item, "reviewed")}
            disabled={busy}
            className="rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink transition hover:bg-white/10 disabled:opacity-40"
          >
            {t("markReviewed")}
          </button>
        )}
        {item.status !== "ignored" ? (
          <button
            onClick={() => onSetStatus(item, "ignored")}
            disabled={busy}
            className="rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:border-danger/30 hover:text-danger disabled:opacity-40"
          >
            {t("ignore")}
          </button>
        ) : (
          <button
            onClick={() => onSetStatus(item, "detected")}
            disabled={busy}
            className="rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:text-ink disabled:opacity-40"
          >
            {t("reactivate")}
          </button>
        )}
      </div>

      {/* SECCIÓN C — Alternativas */}
      <section className="border-t border-line pt-4">
        <SectionTitle>{t("alternativesTitle", { count: alternatives.length })}</SectionTitle>
        {searching && <p className="mb-3 text-xs text-ink-subtle">{t("searchingProducts")}</p>}
        {alternatives.length === 0 && !searching ? (
          <p className="text-sm text-ink-subtle">{t("noMoreResults")}</p>
        ) : (
          <div className="space-y-3">
            {alternatives.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                onClick={() => onRecommendationClick(item, rec)}
              />
            ))}
          </div>
        )}
      </section>

      {/* SECCIÓN D — Auditoría (plegable) */}
      <details className="rounded-xl border border-line bg-white/[0.02] px-3 py-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-ink-muted">
          {t("auditTitle")}
        </summary>
        <div className="mt-2 space-y-1.5">
          <Spec
            label={t("audit.detectedImage")}
            value={
              item.imageCropUrl
                ? isDataUrl(item.imageCropUrl)
                  ? t("audit.localCrop")
                  : t("audit.storedCrop")
                : t("audit.noCrop")
            }
          />
          <Spec
            label={t("audit.originFrame")}
            value={item.frameImageUrl ? t("audit.saved") : t("audit.notSaved")}
          />
          <Spec label={t("audit.matchProvider")} value={best?.provider} />
          <Spec
            label={t("audit.matchScore")}
            value={
              best?.similarityScore != null
                ? `${Math.round(best.similarityScore * 100)}%`
                : null
            }
          />
          <Spec label={t("audit.candidateCount")} value={String(item.recommendations.length)} />
          <Spec label={t("audit.detectionCount")} value={String(item.detectionCount)} />
          <Spec label={t("audit.createdAt")} value={format.dateTime(new Date(item.createdAt), "short")} />
          <Spec label={t("audit.updatedAt")} value={format.dateTime(new Date(item.updatedAt), "short")} />
          <Spec label={t("audit.searchQuery")} value={item.searchQuery} mono />
        </div>
        {item.marketplaceKeywords.length > 0 && (
          <div className="mt-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              {t("audit.marketplaceKeywords")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {item.marketplaceKeywords.map((k) => (
                <Chip key={k}>{k}</Chip>
              ))}
            </div>
          </div>
        )}
      </details>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
      {children}
    </h4>
  );
}

function Spec({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        {label}
      </span>
      <span className={"text-right text-sm text-ink" + (mono ? " font-mono text-xs" : "")}>
        {value}
      </span>
    </div>
  );
}

/** Tarjeta destacada del MEJOR match: imagen grande + datos comerciales. */
function BestMatchCard({
  rec,
  onClick,
}: Readonly<{
  rec: ProductRecommendation;
  onClick: () => void;
}>) {
  const t = useTranslations("publicCatalog.drawer.bestMatch");
  const format = useFormatter();
  const [broken, setBroken] = useState(false);
  const matchType = recommendationMatchType(rec);

  return (
    <a
      href={rec.productUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="block overflow-hidden rounded-2xl border border-success/20 bg-success/[0.04] transition hover:border-success/40 hover:bg-success/[0.08]"
    >
      {rec.imageUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={rec.imageUrl}
          alt={rec.title}
          className="aspect-video w-full bg-black/40 object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-black/40 text-3xl">
          🛒
        </div>
      )}
      <div className="p-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <MatchTypeBadge matchType={matchType} />
          {rec.similarityScore != null && (
            <span title={t("matchScoreTooltip")} className="text-[10px] text-accent">
              {t("matchPct", { pct: Math.round(rec.similarityScore * 100) })}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-sm font-medium text-ink">{rec.title}</p>
        <p className="mt-0.5 text-[11px] text-ink-subtle">
          {rec.provider}
          {rec.brand ? ` · ${rec.brand}` : ""}
        </p>
        <div className="mt-1.5 flex items-center justify-between">
          {rec.price != null && (
            <span className="text-base font-semibold text-success">
              {format.number(rec.price, { style: "currency", currency: rec.currency ?? "EUR" })}
            </span>
          )}
          <span className="text-xs font-semibold text-success">{t("viewProduct")}</span>
        </div>
      </div>
    </a>
  );
}

function RecommendationCard({
  rec,
  onClick,
}: Readonly<{
  rec: ProductRecommendation;
  onClick: () => void;
}>) {
  const t = useTranslations("publicCatalog.drawer.recommendation");
  const format = useFormatter();
  const [broken, setBroken] = useState(false);
  return (
    <a
      href={rec.productUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="flex gap-3 rounded-xl border border-line bg-white/[0.03] p-2.5 transition hover:border-line-strong hover:bg-white/[0.06]"
    >
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40">
        {rec.imageUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={rec.imageUrl}
            alt={rec.title}
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg">🛒</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs font-medium text-ink">{rec.title}</p>
        <p className="mt-0.5 text-[11px] text-ink-subtle">
          {rec.provider}
          {rec.brand ? ` · ${rec.brand}` : ""}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {rec.price != null && (
            <span className="text-sm font-semibold text-success">
              {format.number(rec.price, { style: "currency", currency: rec.currency ?? "EUR" })}
            </span>
          )}
          {rec.similarityScore != null && (
            <span className="text-[10px] text-ink-subtle">
              {t("affinityPct", { pct: Math.round(rec.similarityScore * 100) })}
            </span>
          )}
        </div>
        {rec.reason && (
          <p className="mt-1 line-clamp-1 text-[11px] italic text-ink-muted">{rec.reason}</p>
        )}
      </div>
    </a>
  );
}
