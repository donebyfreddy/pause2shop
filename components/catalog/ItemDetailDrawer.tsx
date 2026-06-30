"use client";

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
  StatusBadge,
  TYPE_LABELS,
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
}: Props) {
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
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-zinc-950 shadow-2xl transition-transform duration-300 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
        role="dialog"
        aria-label="Detalle del elemento"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Detalle del elemento</h2>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-zinc-300 transition hover:bg-white/10"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!item ? (
            loadingDetail ? (
              <p className="py-12 text-center text-sm text-zinc-500">Cargando…</p>
            ) : (
              <p className="py-12 text-center text-sm text-zinc-500">
                Selecciona un elemento.
              </p>
            )
          ) : (
            <div className="space-y-5">
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <ItemThumb item={item} className="aspect-video w-full" />
              </div>

              <div>
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-zinc-100">{item.name}</h3>
                  <ConfidenceBadge value={item.confidence} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={item.status} />
                  {item.type && <Chip>{TYPE_LABELS[item.type] ?? item.type}</Chip>}
                  <Chip>{item.category}</Chip>
                  {item.detectionCount > 1 && <Chip>visto ×{item.detectionCount}</Chip>}
                </div>
                {item.description && (
                  <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                    {item.description}
                  </p>
                )}
              </div>

              <Spec label="Subcategoría" value={item.subcategory} />
              <Spec label="Color" value={item.color} />
              <Spec label="Otros colores" value={item.secondaryColors.join(", ")} />
              <Spec label="Estilo" value={item.style} />
              <Spec label="Patrón" value={item.pattern} />
              <Spec label="Material (estimado)" value={item.materialGuess} />
              <Spec label="Ajuste / género" value={item.genderFit} />
              <Spec label="Marca visible" value={item.visibleBrand} />
              <Spec label="Momento del vídeo" value={formatTimestamp(item.timestampSeconds)} />
              <Spec label="Query de búsqueda" value={item.searchQuery} mono />
              {item.marketplaceKeywords.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Keywords de marketplace
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.marketplaceKeywords.map((k) => (
                      <Chip key={k}>{k}</Chip>
                    ))}
                  </div>
                </div>
              )}

              {/* Acciones */}
              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                <button
                  onClick={() => onSearchProducts(item)}
                  disabled={searching}
                  className="rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {searching ? "Buscando…" : "🔎 Buscar productos"}
                </button>
                {item.status !== "reviewed" && (
                  <button
                    onClick={() => onSetStatus(item, "reviewed")}
                    disabled={busy}
                    className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    Marcar revisado
                  </button>
                )}
                {item.status !== "ignored" ? (
                  <button
                    onClick={() => onSetStatus(item, "ignored")}
                    disabled={busy}
                    className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-400 transition hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-40"
                  >
                    Ignorar
                  </button>
                ) : (
                  <button
                    onClick={() => onSetStatus(item, "detected")}
                    disabled={busy}
                    className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-zinc-400 transition hover:text-zinc-200 disabled:opacity-40"
                  >
                    Reactivar
                  </button>
                )}
              </div>

              {/* Recomendaciones */}
              <div className="border-t border-white/10 pt-4">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Recomendaciones ({item.recommendations.length})
                </h4>
                {searching && (
                  <p className="mb-3 text-xs text-zinc-500">Buscando productos…</p>
                )}
                {item.recommendations.length === 0 && !searching ? (
                  <p className="text-sm text-zinc-500">
                    Aún no hay recomendaciones. Pulsa{" "}
                    <span className="text-zinc-300">Buscar productos</span>.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {item.recommendations.map((rec) => (
                      <RecommendationCard
                        key={rec.id}
                        rec={rec}
                        onClick={() => onRecommendationClick(item, rec)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
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
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <span className={"text-right text-sm text-zinc-200" + (mono ? " font-mono text-xs" : "")}>
        {value}
      </span>
    </div>
  );
}

function RecommendationCard({
  rec,
  onClick,
}: {
  rec: ProductRecommendation;
  onClick: () => void;
}) {
  return (
    <a
      href={rec.productUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition hover:border-white/20 hover:bg-white/[0.06]"
    >
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black/40">
        {rec.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={rec.imageUrl} alt={rec.title} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs font-medium text-zinc-100">{rec.title}</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          {rec.provider}
          {rec.brand ? ` · ${rec.brand}` : ""}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {rec.price != null && (
            <span className="text-sm font-semibold text-emerald-300">
              {rec.price.toFixed(2)} {rec.currency ?? "EUR"}
            </span>
          )}
          {rec.similarityScore != null && (
            <span className="text-[10px] text-zinc-500">
              {Math.round(rec.similarityScore * 100)}% afín
            </span>
          )}
        </div>
        {rec.reason && (
          <p className="mt-1 line-clamp-1 text-[11px] italic text-zinc-400">{rec.reason}</p>
        )}
      </div>
    </a>
  );
}
