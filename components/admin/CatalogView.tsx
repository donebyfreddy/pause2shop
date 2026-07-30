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
import { useEffect, useMemo, useState } from "react";
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
  const [view, setView] = useState<ViewMode>("grid");
  const [mode, setMode] = useState<SearchMode>("browse");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [source, setSource] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [active, setActive] = useState("all");
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

  const { data, error, loading, refreshing, reload } = useAdminResource<ProductsResponse>(
    `products?${params.toString()}`
  );
  const connectors = useAdminResource<ConnectorsResponse>("connectors");

  const products = useMemo(() => {
    const list = data?.products ?? [];
    // `origin` no está en el contrato de filtros del servicio: se filtra aquí y
    // se advierte de que aplica solo a la página cargada.
    return origin === "all" ? list : list.filter((p) => p.origin === origin);
  }, [data?.products, origin]);

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
      toast.error("La búsqueda falló", res.error.message);
      return;
    }
    setMatches(res.data.matches);
    if (res.data.matches.length === 0) toast.info("Sin resultados por encima del umbral");
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
      toast.error("La búsqueda por imagen falló", res.error.message);
      return;
    }
    setMatches(res.data.matches);
    toast.success(
      `${res.data.matches.length} coincidencia${res.data.matches.length === 1 ? "" : "s"}`,
      "Cascada: hash exacto → hash perceptual → embedding visual"
    );
  };

  const onDropImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Ese archivo no es una imagen");
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
      toast.error("No se pudo cambiar el estado", res.error.message);
      return;
    }
    toast.success(product.isActive ? "Producto desactivado" : "Producto activado");
    reload();
  };

  return (
    <div className="space-y-5">
      {/* ------------------------- modos ------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          ariaLabel="Modo de exploración"
          value={mode}
          onChange={(next) => {
            setMode(next);
            setMatches(null);
          }}
          options={[
            { value: "browse", label: "Explorar", icon: Database },
            { value: "text", label: "Buscar por texto", icon: Search },
            { value: "image", label: "Buscar por imagen", icon: ScanSearch },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            size="sm"
            ariaLabel="Vista"
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "Rejilla", icon: LayoutGrid },
              { value: "list", label: "Lista", icon: List },
            ]}
          />
          <Button variant="ghost" size="sm" icon onClick={reload} aria-label="Refrescar">
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} aria-hidden />
          </Button>
        </div>
      </div>

      {/* ------------------------- controles por modo ------------------------- */}
      {mode === "browse" && (
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            placeholder="Buscar por título, marca…"
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
            aria-label="Fuente"
          >
            <option value="all">Todas las fuentes</option>
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
            onChange={(e) => setOrigin(e.target.value)}
            className="w-auto min-w-40"
            aria-label="Origen"
          >
            <option value="all">Todo origen</option>
            <option value="scraped">Ingerido de tienda</option>
            <option value="externally_discovered">Descubierto externamente</option>
          </Select>
          <Select
            value={active}
            onChange={(e) => {
              setActive(e.target.value);
              setPage(1);
            }}
            className="w-auto min-w-36"
            aria-label="Estado"
          >
            <option value="all">Activos e inactivos</option>
            <option value="true">Solo activos</option>
            <option value="false">Solo inactivos</option>
          </Select>
        </div>
      )}

      {mode === "text" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="vestido rojo satinado, blazer de punto negro…"
            value={textQuery}
            onChange={(e) => setTextQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runTextSearch()}
            className="min-w-64 flex-1"
          />
          <Button variant="primary" size="sm" loading={searching} onClick={runTextSearch}>
            <Search className="size-3.5" aria-hidden />
            Buscar
          </Button>
        </div>
      )}

      {mode === "image" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="https://…/imagen.jpg"
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
              Buscar por URL
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
              Arrastra una imagen o haz clic para elegirla
            </span>
            <span className="text-[11px] text-ink-subtle">
              Se envía en base64 al endpoint de búsqueda visual del catálogo
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
          {origin !== "all" && (
            <Callout tone="info">
              El filtro de origen se aplica sobre la página cargada: el servicio pagina antes de
              filtrar por origen.
            </Callout>
          )}

          {error && !data ? (
            <Card>
              <EmptyState
                icon={CircleAlert}
                title="No se pudo leer el catálogo"
                description={error.message}
                action={
                  <Button variant="secondary" size="sm" onClick={reload}>
                    Reintentar
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
                {total.toLocaleString("es-ES")} productos · página {page} de {totalPages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Siguiente
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
          title="El catálogo está vacío con estos filtros"
          description="Lanza un sync desde Conectores o ejecuta el seed de fixtures (npm run catalog:seed en la raíz) para tener datos de demo."
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
              {!product.isActive && <Badge tone="danger">inactivo</Badge>}
              {product.origin === "externally_discovered" && <Badge tone="info">externo</Badge>}
            </div>
            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
              {product.hasImageEmbedding && (
                <span
                  title="Con embedding visual"
                  className="grid size-6 place-items-center rounded-md border border-success/30 bg-canvas/80 backdrop-blur-sm"
                >
                  <Binary className="size-3 text-success" aria-hidden />
                </span>
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent px-3 pt-8 pb-2.5">
              <p className="text-[13px] font-semibold text-white tabular-nums">
                {formatPrice(product.price, product.currency)}
              </p>
            </div>
          </div>
          <div className="p-3">
            <p className="truncate text-[12px] font-medium text-ink">{product.title}</p>
            <p className="mt-0.5 truncate text-[11px] text-ink-subtle">
              {product.brand ?? product.source} · {product.category ?? "sin categoría"}
            </p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-ink-faint">
                visto {timeAgo(product.lastSeenAt)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleActive(product);
                }}
                title={product.isActive ? "Desactivar" : "Activar"}
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
  return (
    <Card className="overflow-hidden">
      <TableWrap className="max-h-[64vh] overflow-y-auto">
        <Table className="min-w-[980px]">
          <THead>
            <TR>
              <TH className="w-14" />
              <TH>Producto</TH>
              <TH>Fuente</TH>
              <TH>Categoría</TH>
              <TH className="text-right">Precio</TH>
              <TH>Índices</TH>
              <TH>Visto</TH>
              <TH className="text-right">Estado</TH>
            </TR>
          </THead>
          <TBody>
            {loading && <SkeletonRows rows={8} cols={8} />}
            {!loading && products.length === 0 && (
              <TableEmpty colSpan={8}>
                <EmptyState
                  icon={Package}
                  title="Sin productos"
                  description="Ajusta los filtros o ingiere catálogo desde Conectores."
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
                    </p>
                  </TD>
                  <TD className="text-[11px]">{product.source}</TD>
                  <TD className="text-[11px]">{product.category ?? "—"}</TD>
                  <TD className="text-right text-[12px] font-medium text-ink tabular-nums">
                    {formatPrice(product.price, product.currency)}
                  </TD>
                  <TD>
                    <div className="flex gap-1">
                      <Badge tone={product.hasImageEmbedding ? "success" : "muted"}>img</Badge>
                      <Badge tone={product.hasTextEmbedding ? "success" : "muted"}>txt</Badge>
                      <Badge tone={product.perceptualHash ? "success" : "muted"}>hash</Badge>
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
                      {product.isActive ? "Activo" : "Inactivo"}
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
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel>
          {matches.length} coincidencia{matches.length === 1 ? "" : "s"} ordenadas por score
        </SectionLabel>
        <Button variant="ghost" size="xs" onClick={onClear}>
          Volver a explorar
        </Button>
      </div>

      {matches.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Sin coincidencias por encima del umbral"
            description="El catálogo no tiene nada suficientemente parecido. Es el comportamiento correcto: preferimos no devolver nada antes que devolver algo dudoso."
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
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line px-3 py-2">
                <span className="font-mono text-[10px] text-ink-faint">
                  v{match.visualScore.toFixed(2)} · t{match.textScore.toFixed(2)} · a
                  {match.attributeScore.toFixed(2)}
                </span>
                <a
                  href={match.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-brand-bright hover:underline"
                >
                  Ficha
                  <ExternalLink className="size-3" aria-hidden />
                </a>
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

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      title={data?.title ?? "Producto"}
      subtitle={data ? `${data.brand ?? "—"} · ${data.source}` : undefined}
    >
      {loading && <p className="text-xs text-ink-subtle">Cargando ficha…</p>}
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
              {data.isActive ? "Activo" : "Inactivo"}
            </Badge>
            <Badge tone={data.origin === "scraped" ? "neutral" : "info"} size="md">
              {data.origin === "scraped" ? "Ingerido de tienda" : "Descubierto externamente"}
            </Badge>
            <Badge tone={data.hasImageEmbedding ? "success" : "muted"} size="md">
              embedding visual
            </Badge>
            <Badge tone={data.perceptualHash ? "success" : "muted"} size="md">
              hash perceptual
            </Badge>
          </div>

          <div>
            <SectionLabel>Datos normalizados</SectionLabel>
            <div className="mt-2">
              <DataRow label="Precio">{formatPrice(data.price, data.currency)}</DataRow>
              {data.originalPrice != null && (
                <DataRow label="Precio original">
                  {formatPrice(data.originalPrice, data.currency)}
                </DataRow>
              )}
              <DataRow label="Disponibilidad">{data.availability}</DataRow>
              <DataRow label="Categoría">{data.category ?? "—"}</DataRow>
              <DataRow label="Subcategoría">{data.subcategory ?? "—"}</DataRow>
              <DataRow label="Género">{data.gender ?? "—"}</DataRow>
              <DataRow label="Color">{data.color ?? "—"}</DataRow>
              <DataRow label="Primera vez visto">{timeAgo(data.firstSeenAt)}</DataRow>
              <DataRow label="Última vez visto">{timeAgo(data.lastSeenAt)}</DataRow>
              {data.externalScore != null && (
                <DataRow label="Score externo">{data.externalScore.toFixed(3)}</DataRow>
              )}
              <DataRow label="Hash perceptual" mono>
                {data.perceptualHash ?? "—"}
              </DataRow>
              <DataRow label="ID" mono>
                {data.id}
              </DataRow>
            </div>
          </div>

          {/* Inspector de evidencia: de dónde salió CADA campo. Es lo que
              permite auditar un precio sin volver a la tienda. */}
          {data.extraction && (
            <div>
              <SectionLabel>Cómo se extrajo</SectionLabel>
              <div className="mt-2">
                <DataRow label="Extractor principal" mono>
                  {data.extraction.primaryExtractor ?? "—"}
                </DataRow>
                <DataRow label="Extractores aplicados" mono>
                  {data.extraction.extractorsUsed.join(", ") || "—"}
                </DataRow>
                <DataRow label="IA">
                  {data.extraction.aiUsed ? (
                    <>
                      <Badge tone="warning">usada como fallback</Badge>
                      <span className="mt-0.5 block text-[10px] text-ink-faint">
                        {data.extraction.aiModel} · {data.extraction.aiTokens} tokens ·{" "}
                        {data.extraction.aiCostUsd.toFixed(6)} USD
                      </span>
                    </>
                  ) : (
                    <Badge tone="success">no necesaria</Badge>
                  )}
                </DataRow>
                <DataRow label="Navegador">
                  {data.extraction.browserUsed ? "renderizado con Playwright" : "no necesario"}
                </DataRow>
                <DataRow label="Confianza">{data.extraction.confidence.toFixed(2)}</DataRow>
                <DataRow label="Extraído">{timeAgo(data.extraction.extractedAt)}</DataRow>
              </div>

              {data.extraction.evidence.length > 0 && (
                <div className="mt-3 overflow-hidden rounded-lg border border-line">
                  <table className="w-full text-left">
                    <thead className="bg-white/[0.03]">
                      <tr>
                        <th className="px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
                          Campo
                        </th>
                        <th className="px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
                          Origen
                        </th>
                        <th className="px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
                          Evidencia
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
            <a
              href={data.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[12px] text-ink-muted transition-colors hover:border-brand/40 hover:text-ink"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Ver en la tienda
            </a>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(data.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[12px] text-ink-muted transition-colors hover:text-ink"
            >
              <Copy className="size-3.5" aria-hidden />
              Copiar ID
            </button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
