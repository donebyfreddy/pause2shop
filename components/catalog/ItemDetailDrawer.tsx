"use client";

import { useState } from "react";
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
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-line bg-canvas shadow-2xl transition-transform duration-300 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
        role="dialog"
        aria-label="Detalle del elemento"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Detalle del elemento</h2>
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

function EmptyBody({ loadingDetail }: { loadingDetail: boolean }) {
  return loadingDetail ? (
    <p className="py-12 text-center text-sm text-ink-subtle">Cargando…</p>
  ) : (
    <p className="py-12 text-center text-sm text-ink-subtle">Selecciona un elemento.</p>
  );
}

function DrawerBody({
  item,
  searching,
  busy,
  onSearchProducts,
  onSetStatus,
  onRecommendationClick,
}: {
  item: CatalogItemWithRecommendations;
  searching: boolean;
  busy: boolean;
  onSearchProducts: (item: CatalogItem) => void;
  onSetStatus: (item: CatalogItem, status: CatalogItem["status"]) => void;
  onRecommendationClick: (item: CatalogItem, rec: ProductRecommendation) => void;
}) {
  const best = pickBestRecommendation(item.recommendations);
  const alternatives = item.recommendations.filter((r) => r.id !== best?.id);

  return (
    <div className="space-y-5">
      {/* SECCIÓN A — Detectado en el vídeo */}
      <section>
        <SectionTitle>📸 Detectado en el vídeo</SectionTitle>
        <div className="overflow-hidden rounded-2xl border border-brand-bright/20">
          <ItemThumb item={item} className="aspect-video w-full" />
        </div>
        {!item.imageCropUrl && !item.frameImageUrl && (
          <p className="mt-2 text-[11px] text-ink-subtle">
            Aún no hay captura de este objeto — se genera con el matching visual.
          </p>
        )}

        <div className="mt-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-ink">{item.name}</h3>
            <ConfidenceBadge value={item.confidence} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={item.status} />
            {item.type && <Chip>{TYPE_LABELS[item.type] ?? item.type}</Chip>}
            <Chip>{item.category}</Chip>
            {item.detectionCount > 1 && <Chip>visto ×{item.detectionCount}</Chip>}
          </div>
          {item.description && (
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              {item.description}
            </p>
          )}
        </div>

        <div className="mt-3 space-y-1.5">
          <Spec label="Momento del vídeo" value={formatTimestamp(item.timestampSeconds)} />
          <Spec label="Subcategoría" value={item.subcategory} />
          <Spec label="Color" value={item.color} />
          <Spec label="Otros colores" value={item.secondaryColors.join(", ")} />
          <Spec label="Estilo" value={item.style} />
          <Spec label="Patrón" value={item.pattern} />
          <Spec label="Material (estimado)" value={item.materialGuess} />
          <Spec label="Ajuste / género" value={item.genderFit} />
          <Spec label="Marca visible" value={item.visibleBrand} />
        </div>

        {/* Frame de origen completo, si se guardó (contexto de la escena). */}
        {item.frameImageUrl && item.imageCropUrl && (
          <details className="mt-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
            <summary className="cursor-pointer select-none text-xs font-medium text-ink-muted">
              Ver frame original de la escena
            </summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.frameImageUrl}
              alt={`Frame de origen de ${item.name}`}
              className="mt-2 w-full rounded-lg"
            />
          </details>
        )}
      </section>

      {/* SECCIÓN B — Mejor coincidencia en Internet */}
      <section className="border-t border-line pt-4">
        <SectionTitle>🛒 Producto encontrado en Internet</SectionTitle>
        {best ? (
          <BestMatchCard
            rec={best}
            onClick={() => onRecommendationClick(item, best)}
          />
        ) : (
          <p className="text-sm text-ink-subtle">
            {searching
              ? "Buscando coincidencias visuales…"
              : "Sin coincidencia fiable todavía. Prueba «Buscar productos»."}
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
          {searching ? "Buscando…" : "🔎 Buscar productos"}
        </button>
        {item.status !== "reviewed" && (
          <button
            onClick={() => onSetStatus(item, "reviewed")}
            disabled={busy}
            className="rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink transition hover:bg-white/10 disabled:opacity-40"
          >
            Marcar revisado
          </button>
        )}
        {item.status !== "ignored" ? (
          <button
            onClick={() => onSetStatus(item, "ignored")}
            disabled={busy}
            className="rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:border-danger/30 hover:text-danger disabled:opacity-40"
          >
            Ignorar
          </button>
        ) : (
          <button
            onClick={() => onSetStatus(item, "detected")}
            disabled={busy}
            className="rounded-lg border border-line bg-white/5 px-3.5 py-2 text-xs font-medium text-ink-muted transition hover:text-ink disabled:opacity-40"
          >
            Reactivar
          </button>
        )}
      </div>

      {/* SECCIÓN C — Alternativas */}
      <section className="border-t border-line pt-4">
        <SectionTitle>
          Alternativas ({alternatives.length})
        </SectionTitle>
        {searching && <p className="mb-3 text-xs text-ink-subtle">Buscando productos…</p>}
        {alternatives.length === 0 && !searching ? (
          <p className="text-sm text-ink-subtle">No hay más resultados.</p>
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
          🔍 Auditoría técnica
        </summary>
        <div className="mt-2 space-y-1.5">
          <Spec
            label="Imagen detectada"
            value={
              item.imageCropUrl
                ? isDataUrl(item.imageCropUrl)
                  ? "crop local (sesión) — storage pendiente"
                  : "crop en storage"
                : "sin crop"
            }
          />
          <Spec
            label="Frame de origen"
            value={item.frameImageUrl ? "guardado" : "no guardado"}
          />
          <Spec label="Proveedor del match" value={best?.provider} />
          <Spec
            label="Score del match"
            value={
              best?.similarityScore != null
                ? `${Math.round(best.similarityScore * 100)}%`
                : null
            }
          />
          <Spec label="Nº de candidatos" value={String(item.recommendations.length)} />
          <Spec label="Detecciones acumuladas" value={String(item.detectionCount)} />
          <Spec label="Creado" value={new Date(item.createdAt).toLocaleString()} />
          <Spec label="Actualizado" value={new Date(item.updatedAt).toLocaleString()} />
          <Spec label="Query de búsqueda" value={item.searchQuery} mono />
        </div>
        {item.marketplaceKeywords.length > 0 && (
          <div className="mt-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Keywords de marketplace
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
}: {
  rec: ProductRecommendation;
  onClick: () => void;
}) {
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
            <span
              title="Confianza en que el resultado web corresponde al mismo producto."
              className="text-[10px] text-accent"
            >
              {Math.round(rec.similarityScore * 100)}% coincidencia
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
              {rec.price.toFixed(2)} {rec.currency ?? "EUR"}
            </span>
          )}
          <span className="text-xs font-semibold text-success">Ver producto ↗</span>
        </div>
      </div>
    </a>
  );
}

function RecommendationCard({
  rec,
  onClick,
}: {
  rec: ProductRecommendation;
  onClick: () => void;
}) {
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
              {rec.price.toFixed(2)} {rec.currency ?? "EUR"}
            </span>
          )}
          {rec.similarityScore != null && (
            <span className="text-[10px] text-ink-subtle">
              {Math.round(rec.similarityScore * 100)}% afín
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
