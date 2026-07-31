"use client";

import { motion } from "motion/react";
import {
  Binary,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  ImageOff,
  LayoutGrid,
  List,
  Package,
  RefreshCw,
  ScanSearch,
  Search,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  DataRow,
  Drawer,
  EmptyState,
  Input,
  SearchInput,
  SectionLabel,
  Segmented,
  Select,
  Skeleton,
  SkeletonRows,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from "@/components/ui";
import { adminPost, useAdminResource } from "@/lib/admin/client";
import { formatPrice, timeAgo } from "@/lib/admin/status";
import { DatasetImportPanel } from "./DatasetImportPanel";
import type {
  CatalogProductSummary,
  ConnectorsResponse,
  ProductsResponse,
  SearchResponse,
} from "@/lib/catalogService/types";
import { cn } from "@/lib/ui/cn";

/**
 * Explorador de catálogo: rejilla/lista, filtros, paginación, búsqueda por texto
 * y búsqueda por imagen (URL o arrastrando un archivo, que se envía en base64
 * por el mismo endpoint del contrato).
 */

const PAGE_SIZE = 24;

type ViewMode = "grid" | "list";
type SearchMode = "browse" | "text" | "image";

export function CatalogView() {
  const toast = useToast();
  const t = useTranslations("catalog");
  const tToast = useTranslations("toast.catalog");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [view, setView] = useState<ViewMode>("grid");
  const [mode, setMode] = useState<SearchMode>("browse");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [source, setSource] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [active, setActive] = useState("all");
  const [embeddingStatus, setEmbeddingStatus] = useState("all");
  const [colorFilter, setColorFilter] = useState("");
  const [genderFilter, setGenderFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // búsqueda semántica / visual
  const [textQuery, setTextQuery] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<SearchResponse["matches"] | null>(null);
  const [dragging, setDragging] = useState(false);

  // Debounce del buscador: sin esto cada tecla dispara una petición.
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [query]);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (debouncedQuery) params.set("q", debouncedQuery);
  if (source !== "all") params.set("source", source);
  if (active !== "all") params.set("active", active);
  // Estos cuatro ya se filtran en SERVIDOR. `origin` se filtraba en cliente
  // sobre la página cargada, lo que con miles de fichas no es un filtro sino
  // una casualidad: mostraba "0 resultados" cuando sí había, solo porque no
  // caían en los 24 visibles.
  if (origin !== "all") params.set("origin", origin);
  if (embeddingStatus !== "all") params.set("embeddingStatus", embeddingStatus);
  if (colorFilter.trim()) params.set("color", colorFilter.trim());
  if (genderFilter !== "all") params.set("gender", genderFilter);

  const { data, error, loading, refreshing, reload } = useAdminResource<ProductsResponse>(
    `products?${params.toString()}`
  );
  const connectors = useAdminResource<ConnectorsResponse>("connectors");

  const products = data?.products ?? [];

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const runTextSearch = async () => {
    if (!textQuery.trim()) return;
    setSearching(true);
    const res = await adminPost<SearchResponse>("search/text", {
      query: textQuery,
      topK: 24,
      minScore: 0.2,
    });
    setSearching(false);
    if (!res.ok) {
      toast.error(tToast("searchFailed"), res.error.message);
      return;
    }
    setMatches(res.data.matches);
    if (res.data.matches.length === 0) toast.info(tToast("noResultsAboveThreshold"));
  };

  const runImageSearch = async (payload: { imageUrl?: string; imageBase64?: string }) => {
    setSearching(true);
    const res = await adminPost<SearchResponse>("search/image", {
      ...payload,
      topK: 24,
      minScore: 0.4,
    });
    setSearching(false);
    if (!res.ok) {
      toast.error(tToast("imageSearchFailed"), res.error.message);
      return;
    }
    setMatches(res.data.matches);
    toast.success(
      tToast("matchesFound", { count: res.data.matches.length }),
      tToast("matchCascadeDescription")
    );
  };

  const onDropImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(tToast("notAnImage"));
      return;
    }
    const buffer = await file.arrayBuffer();
    // El contrato exige base64 SIN el prefijo data:.
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    void runImageSearch({ imageBase64: base64 });
  };

  const toggleActive = async (product: CatalogProductSummary) => {
    const res = await adminPost(`products/${product.id}/active`, { active: !product.isActive });
    if (!res.ok) {
      toast.error(tToast("statusChangeFailed"), res.error.message);
      return;
    }
    toast.success(
      product.isActive ? tToast("productDeactivated") : tToast("productActivated")
    );
    reload();
  };

  return (
    <div className="space-y-5">
      {/* Importación de catálogo de demostración: da productos de moda reales
          con foto sin depender del scraping de tiendas que bloquean por IP. */}
      <DatasetImportPanel />

      {/* ------------------------- modos ------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          ariaLabel={t("modeAriaLabel")}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setMatches(null);
          }}
          options={[
            { value: "browse", label: t("modes.browse"), icon: Database },
            { value: "text", label: t("modes.text"), icon: Search },
            { value: "image", label: t("modes.image"), icon: ScanSearch },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            size="sm"
            ariaLabel={t("viewAriaLabel")}
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: t("view.grid"), icon: LayoutGrid },
              { value: "list", label: t("view.list"), icon: List },
            ]}
          />
          <Button variant="ghost" size="sm" icon onClick={reload} aria-label={t("actions.refresh")}>
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} aria-hidden />
          </Button>
        </div>
      </div>

      {/* ------------------------- controles por modo ------------------------- */}
      {mode === "browse" && (
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            placeholder={t("filters.titleSearchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-56 flex-1"
          />
          <Select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(1);
            }}
            className="w-auto min-w-40"
            aria-label={t("filters.sourceAriaLabel")}
          >
            <option value="all">{t("filters.allSources")}</option>
            {(connectors.data?.connectors ?? [])
              .filter((c) => c.productCount > 0)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.productCount})
                </option>
              ))}
          </Select>
          <Select
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value);
              setPage(1);
            }}
            className="w-auto min-w-40"
            aria-label={t("filters.originAriaLabel")}
          >
            <option value="all">{t("filters.allOrigins")}</option>
            <option value="scraped">{t("origin.scraped")}</option>
            <option value="externally_discovered">{t("origin.external")}</option>
            <option value="dataset_demo">{t("origin.datasetDemo")}</option>
          </Select>
          <Select
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
            className="w-auto min-w-36"
            aria-label={t("filters.statusAriaLabel")}
          >
            <option value="all">{t("filters.allStatuses")}</option>
            <option value="true">{t("filters.onlyActive")}</option>
            <option value="false">{t("filters.onlyInactive")}</option>
          </Select>
          <Select
            value={embeddingStatus}
            onChange={(e) => {
              setEmbeddingStatus(e.target.value);
              setPage(1);
            }}
            className="w-auto min-w-40"
            aria-label={t("filters.embeddingAriaLabel")}
          >
            <option value="all">{t("filters.allEmbeddings")}</option>
            <option value="ready">{t("embedding.ready")}</option>
            <option value="pending">{t("embedding.pending")}</option>
            <option value="failed">{t("embedding.failed")}</option>
            <option value="skipped">{t("embedding.skipped")}</option>
          </Select>
          <Select
            value={genderFilter}
            onChange={(e) => {
              setGenderFilter(e.target.value);
              setPage(1);
            }}
            className="w-auto min-w-32"
            aria-label={t("filters.genderAriaLabel")}
          >
            <option value="all">{t("filters.allGenders")}</option>
            <option value="Men">Men</option>
            <option value="Women">Women</option>
            <option value="Boys">Boys</option>
            <option value="Girls">Girls</option>
            <option value="Unisex">Unisex</option>
          </Select>
          <Input
            value={colorFilter}
            onChange={(e) => {
              setColorFilter(e.target.value);
              setPage(1);
            }}
            placeholder={t("filters.colorPlaceholder")}
            className="w-auto min-w-32"
            aria-label={t("filters.colorAriaLabel")}
          />
        </div>
      )}

      {mode === "text" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder={t("textSearch.placeholder")}
            value={textQuery}
            onChange={(e) => setTextQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runTextSearch()}
            className="min-w-64 flex-1"
          />
          <Button variant="primary" size="sm" loading={searching} onClick={runTextSearch}>
            <Search className="size-3.5" aria-hidden />
            {tCommon("search")}
          </Button>
        </div>
      )}

      {mode === "image" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder={t("imageSearch.urlPlaceholder")}
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && imageUrl && runImageSearch({ imageUrl })}
              className="min-w-64 flex-1"
            />
            <Button
              variant="primary"
              size="sm"
              loading={searching}
              disabled={!imageUrl}
              onClick={() => runImageSearch({ imageUrl })}
            >
              <ScanSearch className="size-3.5" aria-hidden />
              {t("imageSearch.searchByUrl")}
            </Button>
          </div>

          <button
            type="button"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void onDropImage(file);
            }}
            onClick={() => document.getElementById("catalog-image-input")?.click()}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 transition-colors",
              dragging
                ? "border-brand bg-brand/10"
                : "border-line-strong bg-white/[0.02] hover:border-brand/50"
            )}
          >
            <ScanSearch className="size-5 text-ink-faint" aria-hidden />
            <span className="text-[13px] font-medium text-ink">
              {t("imageSearch.dropHint")}
            </span>
            <span className="text-[11px] text-ink-subtle">
              {t("imageSearch.dropSubHint")}
            </span>
          </button>
          <input
            id="catalog-image-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onDropImage(file);
            }}
          />
        </div>
      )}

      {/* ------------------------- resultados ------------------------- */}
      {matches && mode !== "browse" ? (
        <MatchResults matches={matches} onClear={() => setMatches(null)} />
      ) : (
        <>
          {/*
            Aquí había un aviso de que el filtro de origen solo aplicaba a la
            página cargada. Ya no hace falta: el filtro se aplica en servidor,
            así que el total y la paginación son los del filtro de verdad.
          */}
          {error && !data ? (
            <Card>
              <EmptyState
                icon={CircleAlert}
                title={t("errors.loadFailed")}
                description={error.message}
                action={
                  <Button variant="secondary" size="sm" onClick={reload}>
                    {tCommon("retry")}
                  </Button>
                }
              />
            </Card>
          ) : view === "grid" ? (
            <ProductGrid
              products={products}
              loading={loading}
              onOpen={setOpenId}
              onToggleActive={toggleActive}
            />
          ) : (
            <ProductList
              products={products}
              loading={loading}
              onOpen={setOpenId}
              onToggleActive={toggleActive}
            />
          )}

          {total > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-ink-faint">
                {t("pagination", { count: format.number(total), page, totalPages })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                  {t("actions.previousPage")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t("actions.nextPage")}
                  <ChevronRight className="size-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ProductDrawer id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Thumb({
  product,
  className,
}: {
  product: Pick<CatalogProductSummary, "primaryImage" | "title">;
  className?: string;
}) {
  if (!product.primaryImage) {
    return (
      <div className={cn("grid place-items-center bg-surface-2", className)}>
        <ImageOff className="size-4 text-ink-faint" aria-hidden />
      </div>
    );
  }
  return (
    // Imágenes de tiendas de terceros: <img> plano evita configurar dominios
    // remotos en el optimizador para un panel interno.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={product.primaryImage}
      alt={product.title}
      loading="lazy"
      className={cn("bg-surface-2 object-cover", className)}
    />
  );
}

function ProductGrid({
  products,
  loading,
  onOpen,
  onToggleActive,
}: {
  products: CatalogProductSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onToggleActive: (product: CatalogProductSummary) => void;
}) {
  const t = useTranslations("catalog");
  const tActions = useTranslations("actions");

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="panel overflow-hidden">
            <Skeleton className="aspect-[3/4] w-full rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Package}
          title={t("grid.emptyTitle")}
          description={t("grid.emptyDescription")}
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <motion.button
          key={product.id}
          type="button"
          onClick={() => onOpen(product.id)}
          whileHover={{ y: -3 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="panel group overflow-hidden text-left transition-colors hover:border-brand/40"
        >
          <div className="relative aspect-[3/4] w-full overflow-hidden">
            <Thumb
              product={product}
              className="size-full transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute top-2 left-2 flex flex-col gap-1">
              {!product.isActive && <Badge tone="danger">{t("badges.inactive")}</Badge>}
              {product.origin === "externally_discovered" && (
                <Badge tone="info">{t("badges.external")}</Badge>
              )}
              {/* Marca de demo: estas fichas NO son catálogo comercial. */}
              {product.isDemoProduct && (
                <Badge tone="brand" title={product.dataset?.repo ?? undefined}>
                  {t("badges.datasetDemo")}
                </Badge>
              )}
            </div>
            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
              {product.hasImageEmbedding && (
                <span
                  title={t("badges.hasImageEmbeddingTooltip")}
                  className="grid size-6 place-items-center rounded-md border border-success/30 bg-canvas/80 backdrop-blur-sm"
                >
                  <Binary className="size-3 text-success" aria-hidden />
                </span>
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent px-3 pt-8 pb-2.5">
              {/*
                Sin precio no se pinta un hueco que parezca un fallo de scraping:
                se dice que el dataset no lo trae.
              */}
              <p className="text-[13px] font-semibold text-white tabular-nums">
                {product.price != null ? (
                  formatPrice(product.price, product.currency)
                ) : (
                  <span className="text-[10px] font-normal text-white/70">
                    {t("badges.noPriceInDataset")}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="p-3">
            <p className="truncate text-[12px] font-medium text-ink">{product.title}</p>
            <p className="mt-0.5 truncate text-[11px] text-ink-subtle">
              {product.brand ?? product.source} · {product.category ?? t("noCategory")}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-ink-faint">
                {t("card.lastSeenPrefix")} {timeAgo(product.lastSeenAt)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleActive(product);
                }}
                title={product.isActive ? tActions("deactivate") : tActions("activate")}
                className="rounded-md p-1 text-ink-faint transition-colors hover:text-ink"
              >
                {product.isActive ? (
                  <Eye className="size-3.5" aria-hidden />
                ) : (
                  <EyeOff className="size-3.5" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </motion.button>
      ))}
    </div>
  );
}

function ProductList({
  products,
  loading,
  onOpen,
  onToggleActive,
}: {
  products: CatalogProductSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onToggleActive: (product: CatalogProductSummary) => void;
}) {
  const t = useTranslations("catalog");
  return (
    <Card className="overflow-hidden">
      <TableWrap className="max-h-[64vh] overflow-y-auto">
        <Table className="min-w-[980px]">
          <THead>
            <TR>
              <TH className="w-14" />
              <TH>{t("table.product")}</TH>
              <TH>{t("table.source")}</TH>
              <TH>{t("table.category")}</TH>
              <TH className="text-right">{t("table.price")}</TH>
              <TH>{t("table.indexes")}</TH>
              <TH>{t("table.lastSeen")}</TH>
              <TH className="text-right">{t("table.status")}</TH>
            </TR>
          </THead>
          <TBody>
            {loading && <SkeletonRows rows={8} cols={8} />}
            {!loading && products.length === 0 && (
              <TableEmpty colSpan={8}>
                <EmptyState
                  icon={Package}
                  title={t("table.emptyTitle")}
                  description={t("table.emptyDescription")}
                />
              </TableEmpty>
            )}
            {!loading &&
              products.map((product) => (
                <TR key={product.id} interactive onClick={() => onOpen(product.id)}>
                  <TD>
                    <Thumb product={product} className="size-10 rounded-md" />
                  </TD>
                  <TD>
                    <p className="max-w-72 truncate text-[12px] font-medium text-ink">
                      {product.title}
                    </p>
                    <p className="truncate text-[10px] text-ink-faint">
                      {product.brand ?? "—"}
                      {product.color ? ` · ${product.color}` : ""}
                      {product.gender ? ` · ${product.gender}` : ""}
                      {product.datasetAttributes?.articleType
                        ? ` · ${product.datasetAttributes.articleType}`
                        : ""}
                      {product.datasetAttributes?.season
                        ? ` · ${product.datasetAttributes.season} ${product.datasetAttributes.year ?? ""}`
                        : ""}
                    </p>
                  </TD>
                  <TD className="text-[11px]">
                    <div className="flex flex-col gap-0.5">
                      <span>{product.source}</span>
                      {product.isDemoProduct && (
                        <Badge tone="brand" size="sm">
                          {t("badges.datasetDemo")}
                        </Badge>
                      )}
                    </div>
                  </TD>
                  <TD className="text-[11px]">{product.category ?? "—"}</TD>
                  <TD className="text-right text-[12px] font-medium text-ink tabular-nums">
                    {product.price != null ? (
                      formatPrice(product.price, product.currency)
                    ) : (
                      <span className="text-[10px] font-normal text-ink-faint">
                        {t("badges.noPriceInDataset")}
                      </span>
                    )}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={product.hasImageEmbedding ? "success" : "muted"}>img</Badge>
                      <Badge tone={product.hasTextEmbedding ? "success" : "muted"}>txt</Badge>
                      <Badge tone={product.perceptualHash ? "success" : "muted"}>hash</Badge>
                      {/* El estado importa: `pending` y `failed` se distinguen. */}
                      <Badge
                        tone={
                          product.embeddingStatus === "ready"
                            ? "success"
                            : product.embeddingStatus === "failed"
                              ? "danger"
                              : product.embeddingStatus === "skipped"
                                ? "muted"
                                : "warning"
                        }
                        title={
                          product.embeddingProvider
                            ? `${product.embeddingProvider} · ${product.embeddingDimension ?? "?"}d`
                            : undefined
                        }
                      >
                        {product.embeddingStatus}
                      </Badge>
                    </div>
                  </TD>
                  <TD className="text-[11px] whitespace-nowrap">
                    {timeAgo(product.lastSeenAt)}
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()} className="text-right">
                    <Button
                      variant={product.isActive ? "ghost" : "outline"}
                      size="xs"
                      onClick={() => onToggleActive(product)}
                    >
                      {product.isActive ? t("status.active") : t("status.inactive")}
                    </Button>
                  </TD>
                </TR>
              ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}

function MatchResults({
  matches,
  onClear,
}: {
  matches: SearchResponse["matches"];
  onClear: () => void;
}) {
  const t = useTranslations("catalog");
  const format = useFormatter();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel>{t("matches.countLabel", { count: matches.length })}</SectionLabel>
        <Button variant="ghost" size="xs" onClick={onClear}>
          {t("matches.backToBrowse")}
        </Button>
      </div>

      {matches.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title={t("matches.emptyTitle")}
            description={t("matches.emptyDescription")}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {matches.map((match) => (
            <Card key={match.productId} interactive className="overflow-hidden">
              <div className="flex gap-3 p-3">
                <Thumb
                  product={{ primaryImage: match.image, title: match.title }}
                  className="size-20 shrink-0 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-ink">{match.title}</p>
                  <p className="truncate text-[11px] text-ink-subtle">{match.brand ?? "—"}</p>
                  <p className="mt-1 text-[12px] font-semibold text-ink tabular-nums">
                    {formatPrice(match.price, match.currency)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Badge tone={match.finalScore > 0.82 ? "success" : "warning"}>
                      {Math.round(match.finalScore * 100)}%
                    </Badge>
                    <Badge tone="neutral">{match.matchStage}</Badge>
                    {match.isDemoProduct && (
                      <Badge tone="info" title={match.dataset?.repo ?? undefined}>
                        {t("demoBadge")}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line px-3 py-2">
                <span className="font-mono text-[10px] text-ink-faint">
                  v{format.number(match.visualScore, "precise")} · t
                  {format.number(match.textScore, "precise")} · a
                  {format.number(match.attributeScore, "precise")}
                </span>
                {/*
                  Sin URL no hay enlace. Las fichas de dataset no tienen ficha de
                  tienda, así que se dice eso en vez de pintar un enlace muerto.
                */}
                {match.productUrl ? (
                  <a
                    href={match.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-brand-bright hover:underline"
                  >
                    {t("matches.viewListing")}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  <span className="text-[11px] text-ink-faint">{t("noPurchaseUrl")}</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, loading, error } = useAdminResource<CatalogProductSummary>(
    id ? `products/${id}` : null
  );
  const t = useTranslations("catalog");
  const format = useFormatter();

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      title={data?.title ?? t("drawer.fallbackTitle")}
      subtitle={data ? `${data.brand ?? "—"} · ${data.source}` : undefined}
    >
      {loading && <p className="text-xs text-ink-subtle">{t("drawer.loading")}</p>}
      {error && !data && (
        <Callout tone="danger" icon={CircleAlert}>
          {error.message}
        </Callout>
      )}
      {data && (
        <div className="space-y-5">
          {data.primaryImage && (
            <Thumb product={data} className="max-h-80 w-full rounded-xl border border-line" />
          )}

          <div className="flex flex-wrap gap-2">
            <Badge tone={data.isActive ? "success" : "danger"} size="md">
              {data.isActive ? t("status.active") : t("status.inactive")}
            </Badge>
            <Badge
              tone={
                data.origin === "scraped"
                  ? "neutral"
                  : data.origin === "dataset_demo"
                    ? "brand"
                    : "info"
              }
              size="md"
            >
              {data.origin === "scraped"
                ? t("origin.scraped")
                : data.origin === "dataset_demo"
                  ? t("origin.datasetDemo")
                  : t("origin.external")}
            </Badge>
            <Badge
              tone={
                data.embeddingStatus === "ready"
                  ? "success"
                  : data.embeddingStatus === "failed"
                    ? "danger"
                    : "warning"
              }
              size="md"
            >
              {t("drawer.embeddingStatus", { status: data.embeddingStatus })}
            </Badge>
            <Badge tone={data.perceptualHash ? "success" : "muted"} size="md">
              {t("drawer.hasPerceptualHashBadge")}
            </Badge>
          </div>

          {/*
            Bloque de procedencia del dataset. Es donde se responde "¿por qué
            esta ficha no tiene precio?" sin que nadie tenga que suponerlo.
          */}
          {data.isDemoProduct && data.dataset && (
            <Callout tone="brand" icon={Database} title={t("drawer.datasetTitle")}>
              <div className="space-y-1">
                <DataRow label={t("drawer.datasetRepo")} mono>
                  {data.dataset.repo}
                </DataRow>
                <DataRow label={t("drawer.datasetVersion")} mono>
                  {data.dataset.version.slice(0, 12)}
                </DataRow>
                <DataRow label={t("drawer.datasetRow")} mono>
                  {data.dataset.split}#{data.dataset.rowIndex}
                </DataRow>
                <DataRow label={t("drawer.datasetImportedAt")}>
                  {timeAgo(data.dataset.importedAt)}
                </DataRow>
              </div>
              <p className="mt-2 text-[11px]">{t("drawer.datasetUnavailableNote")}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {data.dataset.unavailableFields.map((f) => (
                  <span
                    key={f}
                    className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-ink-faint"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </Callout>
          )}

          {/* Atributos propios del dataset que no tienen columna en el catálogo. */}
          {data.datasetAttributes && (
            <div>
              <SectionLabel>{t("drawer.datasetAttributesTitle")}</SectionLabel>
              <div className="mt-2">
                <DataRow label={t("drawer.masterCategory")}>
                  {data.datasetAttributes.masterCategory ?? "—"}
                </DataRow>
                <DataRow label={t("drawer.articleType")}>
                  {data.datasetAttributes.articleType ?? "—"}
                </DataRow>
                <DataRow label={t("drawer.baseColour")}>
                  {data.datasetAttributes.baseColour ?? "—"}
                </DataRow>
                <DataRow label={t("drawer.season")}>
                  {data.datasetAttributes.season ?? "—"}
                </DataRow>
                <DataRow label={t("drawer.year")} mono>
                  {data.datasetAttributes.year ?? "—"}
                </DataRow>
                <DataRow label={t("drawer.usage")}>{data.datasetAttributes.usage ?? "—"}</DataRow>
              </div>
            </div>
          )}

          <div>
            <SectionLabel>{t("drawer.normalizedDataTitle")}</SectionLabel>
            <div className="mt-2">
              <DataRow label={t("drawer.price")}>
                {data.price != null ? (
                  formatPrice(data.price, data.currency)
                ) : (
                  <span className="text-ink-faint">{t("drawer.notInDataset")}</span>
                )}
              </DataRow>
              {data.originalPrice != null && (
                <DataRow label={t("drawer.originalPrice")}>
                  {formatPrice(data.originalPrice, data.currency)}
                </DataRow>
              )}
              <DataRow label={t("drawer.availability")}>{data.availability}</DataRow>
              <DataRow label={t("drawer.category")}>{data.category ?? "—"}</DataRow>
              <DataRow label={t("drawer.subcategory")}>{data.subcategory ?? "—"}</DataRow>
              <DataRow label={t("drawer.gender")}>{data.gender ?? "—"}</DataRow>
              <DataRow label={t("drawer.color")}>{data.color ?? "—"}</DataRow>
              <DataRow label={t("drawer.firstSeen")}>{timeAgo(data.firstSeenAt)}</DataRow>
              <DataRow label={t("drawer.lastSeen")}>{timeAgo(data.lastSeenAt)}</DataRow>
              {data.externalScore != null && (
                <DataRow label={t("drawer.externalScore")}>
                  {format.number(data.externalScore)}
                </DataRow>
              )}
              <DataRow label={t("drawer.perceptualHash")} mono>
                {data.perceptualHash ?? "—"}
              </DataRow>
              <DataRow label={t("drawer.id")} mono>
                {data.id}
              </DataRow>
            </div>
          </div>

          {/* Inspector de evidencia: de dónde salió CADA campo. Es lo que
              permite auditar un precio sin volver a la tienda. */}
          {data.extraction && (
            <div>
              <SectionLabel>{t("drawer.extractionTitle")}</SectionLabel>
              <div className="mt-2">
                <DataRow label={t("drawer.primaryExtractor")} mono>
                  {data.extraction.primaryExtractor ?? "—"}
                </DataRow>
                <DataRow label={t("drawer.extractorsUsed")} mono>
                  {data.extraction.extractorsUsed.join(", ") || "—"}
                </DataRow>
                <DataRow label={t("drawer.aiLabel")}>
                  {data.extraction.aiUsed ? (
                    <>
                      <Badge tone="warning">{t("drawer.aiUsedAsFallback")}</Badge>
                      <span className="mt-0.5 block text-[10px] text-ink-faint">
                        {data.extraction.aiModel} · {data.extraction.aiTokens} tokens ·{" "}
                        {format.number(data.extraction.aiCostUsd, "usdCost")}
                      </span>
                    </>
                  ) : (
                    <Badge tone="success">{t("drawer.aiNotNeeded")}</Badge>
                  )}
                </DataRow>
                <DataRow label={t("drawer.browserLabel")}>
                  {data.extraction.browserUsed
                    ? t("drawer.browserUsedYes")
                    : t("drawer.browserNotNeeded")}
                </DataRow>
                <DataRow label={t("drawer.confidence")}>
                  {format.number(data.extraction.confidence, "precise")}
                </DataRow>
                <DataRow label={t("drawer.extractedAt")}>
                  {timeAgo(data.extraction.extractedAt)}
                </DataRow>
              </div>

              {data.extraction.evidence.length > 0 && (
                <div className="mt-3 overflow-hidden rounded-lg border border-line">
                  <table className="w-full text-left">
                    <thead className="bg-white/[0.03]">
                      <tr>
                        <th className="px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
                          {t("drawer.evidenceField")}
                        </th>
                        <th className="px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
                          {t("drawer.evidenceSource")}
                        </th>
                        <th className="px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
                          {t("drawer.evidenceSnippet")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {data.extraction.evidence.map((ev) => (
                        <tr key={`${ev.field}-${ev.source}`}>
                          <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-ink-muted">
                            {ev.field}
                          </td>
                          <td className="px-2.5 py-1.5">
                            <Badge tone={ev.source === "ai" ? "warning" : "neutral"}>
                              {ev.source}
                            </Badge>
                          </td>
                          <td className="px-2.5 py-1.5 font-mono text-[10px] break-all text-ink-faint">
                            {ev.snippet}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.extraction.warnings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {data.extraction.warnings.map((w) => (
                    <li key={w} className="text-[11px] text-warning">
                      · {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {/*
              Solo se enlaza a la tienda si hay tienda. Las fichas de dataset
              tienen `productUrl: null` por contrato (su canonicalUrl es un URI
              `dataset://` no navegable), así que aquí se explica en vez de
              ofrecer un enlace que no lleva a ningún sitio.
            */}
            {data.productUrl ? (
              <a
                href={data.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[12px] text-ink-muted transition-colors hover:border-brand/40 hover:text-ink"
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("drawer.viewInStore")}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-line border-dashed px-3 py-2 text-[12px] text-ink-faint">
                <ImageOff className="size-3.5" aria-hidden />
                {t("drawer.noStoreUrl")}
              </span>
            )}
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(data.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[12px] text-ink-muted transition-colors hover:text-ink"
            >
              <Copy className="size-3.5" aria-hidden />
              {t("drawer.copyId")}
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
