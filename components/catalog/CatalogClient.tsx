"use client";

import Link from "next/link";
import { Database, PlugZap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CatalogItem,
  CatalogItemWithRecommendations,
  CatalogListItem,
  ItemStatus,
  ProductRecommendation,
} from "@/lib/catalog/types";
import type {
  CatalogItemResponse,
  CatalogItemUpdateResponse,
  CatalogListResponse,
  SearchProductsResponse,
} from "@/lib/api/types";
import CatalogFilters, { type FilterState } from "./CatalogFilters";
import CatalogItemCard from "./CatalogItemCard";
import ItemDetailDrawer from "./ItemDetailDrawer";

const EMPTY_FILTERS: FilterState = {
  q: "",
  category: "",
  color: "",
  type: "",
  status: "",
  sourceType: "",
};

type Props = {
  initialVideoId: string | null;
  appName: string;
};

export default function CatalogClient({ initialVideoId, appName }: Readonly<Props>) {
  const t = useTranslations("publicCatalog");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [videoFilter, setVideoFilter] = useState<string | null>(initialVideoId);

  const [items, setItems] = useState<CatalogListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [persisted, setPersisted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [detail, setDetail] = useState<CatalogItemWithRecommendations | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searching, setSearching] = useState(false);

  const reqId = useRef(0);

  const fetchItems = useCallback(async () => {
    const myReq = ++reqId.current;
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    const filterKeys = ["q", "category", "color", "type", "status", "sourceType"] as const;
    for (const key of filterKeys) {
      if (filters[key]) sp.set(key, filters[key]);
    }
    if (videoFilter) sp.set("videoId", videoFilter);
    sp.set("limit", "120");

    try {
      const res = await fetch(`/api/catalog/items?${sp.toString()}`);
      const data = (await res.json()) as CatalogListResponse;
      if (myReq !== reqId.current) return; // resultado obsoleto
      if (!data.ok) {
        setError(data.error);
        setItems([]);
        setTotal(0);
      } else {
        setItems(data.items);
        setTotal(data.total);
        setPersisted(data.persisted);
      }
    } catch (err) {
      if (myReq !== reqId.current) return;
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }, [filters, videoFilter, t]);

  // Debounce: refetch al cambiar filtros.
  useEffect(() => {
    const t = setTimeout(fetchItems, 300);
    return () => clearTimeout(t);
  }, [fetchItems]);

  const patchInList = useCallback((updated: CatalogItem) => {
    // Conserva los campos enriquecidos del listado (bestMatch, estado de imagen).
    setItems((list) =>
      list.map((it) => (it.id === updated.id ? { ...it, ...updated } : it))
    );
    setDetail((d) => (d && d.id === updated.id ? { ...d, ...updated } : d));
  }, []);

  const openItem = useCallback(async (item: CatalogItem) => {
    setDrawerOpen(true);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/catalog/items/${item.id}`);
      const data = (await res.json()) as CatalogItemResponse;
      if (data.ok) setDetail(data.item);
      else setError(data.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.network"));
    } finally {
      setLoadingDetail(false);
    }
  }, [t]);

  const setStatus = useCallback(
    async (item: CatalogItem, status: ItemStatus) => {
      setBusyId(item.id);
      try {
        const res = await fetch(`/api/catalog/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const data = (await res.json()) as CatalogItemUpdateResponse;
        if (data.ok) patchInList(data.item);
      } catch {
        /* noop */
      } finally {
        setBusyId(null);
      }
    },
    [patchInList]
  );

  const searchProducts = useCallback(
    async (item: CatalogItem) => {
      setSearching(true);
      try {
        const res = await fetch(`/api/catalog/items/${item.id}/search-products`, {
          method: "POST",
        });
        const data = (await res.json()) as SearchProductsResponse;
        if (data.ok) {
          setDetail((d) =>
            d && d.id === item.id
              ? { ...d, recommendations: data.recommendations, status: "matched" }
              : d
          );
          setItems((list) =>
            list.map((it) =>
              it.id === item.id && it.status === "detected"
                ? { ...it, status: "matched" }
                : it
            )
          );
        } else {
          setError(data.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errors.network"));
      } finally {
        setSearching(false);
      }
    },
    [t]
  );

  const recommendationClick = useCallback(
    (item: CatalogItem, rec: ProductRecommendation) => {
      // Feedback no bloqueante.
      void fetch("/api/catalog/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detectedItemId: item.id,
          recommendationId: rec.id,
          action: "clicked",
        }),
      }).catch(() => {});
    },
    []
  );

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl text-ink sm:text-4xl">
            {t("page.heading")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            {t("page.description")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/connectors"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-br from-brand to-magenta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <PlugZap className="size-4" aria-hidden />
            {t("page.openScraper")}
          </Link>
          <Link
            href="/admin/catalog"
            className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-brand/40 hover:text-brand-bright"
          >
            <Database className="size-4" aria-hidden />
            {t("page.ingestedCatalog")}
          </Link>
        </div>
      </header>

      <div className="mb-6">
        <CatalogFilters
          value={filters}
          total={total}
          persisted={persisted}
          videoFilter={videoFilter}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onClear={() => {
            setFilters(EMPTY_FILTERS);
            setVideoFilter(null);
          }}
          onClearVideo={() => setVideoFilter(null)}
        />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <Grid>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4] animate-pulse rounded-2xl border border-line bg-white/5"
            />
          ))}
        </Grid>
      ) : items.length === 0 ? (
        <EmptyState hasFilters={Boolean(filters.q || filters.category || filters.color || filters.type || filters.status || videoFilter)} appName={appName} />
      ) : (
        <Grid>
          {items.map((item) => (
            <CatalogItemCard
              key={item.id}
              item={item}
              busy={busyId === item.id}
              onOpen={openItem}
              onIgnore={(it) => setStatus(it, "ignored")}
              onReview={(it) =>
                setStatus(it, it.status === "ignored" ? "detected" : "reviewed")
              }
            />
          ))}
        </Grid>
      )}

      <ItemDetailDrawer
        item={detail}
        open={drawerOpen}
        loadingDetail={loadingDetail}
        searching={searching}
        busy={busyId === detail?.id}
        onClose={() => setDrawerOpen(false)}
        onSearchProducts={searchProducts}
        onSetStatus={setStatus}
        onRecommendationClick={recommendationClick}
      />
    </main>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
  );
}

function EmptyState({
  hasFilters,
  appName,
}: Readonly<{ hasFilters: boolean; appName: string }>) {
  const t = useTranslations("publicCatalog.empty");
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-white/[0.02] py-20 text-center">
      <div className="text-4xl">🗂️</div>
      {hasFilters ? (
        <p className="max-w-sm text-sm text-ink-muted">{t("filtered")}</p>
      ) : (
        <>
          <p className="max-w-sm text-sm text-ink-muted">
            {t("noItems", { appName })}
          </p>
          <Link
            href="/"
            className="rounded-lg bg-gradient-to-br from-brand to-magenta px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {t("cta")}
          </Link>
        </>
      )}
    </div>
  );
}
