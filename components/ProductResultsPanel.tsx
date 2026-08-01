"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  CircleCheck,
  Film,
  Layers,
  Lock,
  RefreshCw,
  ScanSearch,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import type { DetectedItem, FrameAnalysis } from "@/lib/types";
import type { PersistenceStatus } from "@/lib/api/types";
import { presentationPriority } from "@/lib/priority";
import { itemKey, normalizeStyle, prettyStyleLabel } from "@/lib/utils";
import { IS_PRESENTATION } from "@/lib/presentation";
import FramePreview from "./FramePreview";
import LoadingAnalysis from "./LoadingAnalysis";
import DetectionResultCard from "./matching/DetectionResultCard";
import { Button, Callout, EmptyState, Segmented, SectionLabel } from "@/components/ui";

type Props = {
  loading: boolean;
  /** true mientras llegan items en streaming (análisis parcial visible). */
  streaming?: boolean;
  error: string | null;
  /** Detalle técnico del error (mensaje crudo del proveedor), para depuración. */
  errorDetail?: string | null;
  warning?: string | null;
  analysis: FrameAnalysis | null;
  items: DetectedItem[];
  /** Todos los objetos únicos detectados en la sesión de vídeo. */
  sessionItems?: DetectedItem[];
  frameDataUrl: string | null;
  mock: boolean;
  persisted?: boolean;
  persistence?: PersistenceStatus | null;
  savedCount?: number;
  videoId?: string | null;
  onReanalyze?: () => void;
  canReanalyze?: boolean;
  /** Item resaltado (sincronizado con el hotspot de la imagen analizada). */
  selectedKey?: string | null;
  /** Clic en una card: selecciona su hotspot correspondiente en la imagen. */
  onSelectItem?: (item: DetectedItem) => void;
  /** El usuario pide buscar también en Internet para una detección concreta. */
  onSearchExternal?: (detectionId: string) => void;
  /** Máximo de alternativas visibles por bloque (CATALOG_MATCH_MAX_VISIBLE). */
  maxVisibleCandidates?: number;
  /**
   * Cuántas de las detecciones guardadas tienen de verdad un producto del
   * catálogo asociado. Es distinto de `savedCount` (detecciones guardadas).
   */
  catalogMatchedCount?: number;
};

type Tab = "frame" | "session";

/** Agrupación PERSON-CENTRIC: lo de la persona primero, el fondo plegado. */
function groupByRelationship(items: DetectedItem[]): {
  worn: DetectedItem[];
  heldOrUsed: DetectedItem[];
  other: DetectedItem[];
  background: DetectedItem[];
} {
  const worn: DetectedItem[] = [];
  const heldOrUsed: DetectedItem[] = [];
  const other: DetectedItem[] = [];
  const background: DetectedItem[] = [];
  for (const item of items) {
    if (item.relationship === "worn") worn.push(item);
    else if (item.relationship === "held" || item.relationship === "used") {
      heldOrUsed.push(item);
    } else if (
      item.relationship === "background" ||
      presentationPriority(item) === "low"
    ) {
      background.push(item);
    } else other.push(item);
  }
  return { worn, heldOrUsed, other, background };
}

/** Lista agrupada de productos: Lo que lleva / sostiene / otros / fondo. */
function GroupedProductList({
  items,
  keyPrefix,
  frameUrl,
  selectedKey,
  onSelectItem,
  onSearchExternal,
  maxVisibleCandidates,
}: {
  items: DetectedItem[];
  keyPrefix: string;
  frameUrl?: string | null;
  selectedKey?: string | null;
  onSelectItem?: (item: DetectedItem) => void;
  onSearchExternal?: (detectionId: string) => void;
  maxVisibleCandidates?: number;
}) {
  const t = useTranslations("studio.resultsPanel");
  const groups = groupByRelationship(items);

  /**
   * Una detección = una tarjeta con sus dos bloques (catálogo / Internet).
   * El `rank` numérico de la UI anterior desaparece a propósito: numerar del 1
   * al N sugiere un único ranking global, que es justo lo que aquí NO hay.
   */
  const renderCard = (item: DetectedItem, key: string) => (
    <DetectionResultCard
      key={key}
      item={item}
      detection={item.detection_result ?? null}
      frameUrl={frameUrl}
      loading={item.matchingStatus === "searching" || item.matchingStatus === "pending"}
      externalLoading={item.external_loading}
      failureDetail={item.matching_debug?.detail}
      matchingStatus={item.matchingStatus}
      matchingPhase={item.matching_phase}
      matchingStartedAt={item.matching_started_at}
      selected={Boolean(selectedKey) && itemKey(item) === selectedKey}
      onSelect={onSelectItem}
      onSearchExternal={onSearchExternal}
      maxVisibleCandidates={maxVisibleCandidates}
    />
  );

  const renderGroup = (title: string, list: DetectedItem[]) =>
    list.length > 0 && (
      <div key={title}>
        <SectionLabel className="mb-2.5">
          {title} · {list.length}
        </SectionLabel>
        <div className="space-y-3">
          {list.map((item, idx) =>
            renderCard(item, `${keyPrefix}-${title}-${item.name}-${idx}`)
          )}
        </div>
      </div>
    );

  const hasGroups =
    groups.worn.length + groups.heldOrUsed.length > 0 || groups.background.length > 0;

  if (!hasGroups) {
    // Sin metadatos de relación (datos antiguos): lista plana.
    return (
      <div className="space-y-3">
        {items.map((item, idx) =>
          renderCard(item, `${keyPrefix}-${item.name}-${idx}`)
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {renderGroup(t("groups.worn"), groups.worn)}
      {renderGroup(t("groups.heldOrUsed"), groups.heldOrUsed)}
      {renderGroup(t("groups.nearPerson"), groups.other)}
      {groups.background.length > 0 && (
        <details className="group rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5">
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase transition-colors select-none hover:text-ink-muted">
            {t("groups.otherObjects", { count: groups.background.length })}
            <span className="text-[9px] normal-case">{t("groups.lowPriority")}</span>
          </summary>
          <div className="mt-3 space-y-3">
            {groups.background.map((item, idx) =>
              renderCard(item, `${keyPrefix}-bg-${item.name}-${idx}`)
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export default function ProductResultsPanel({
  loading,
  streaming = false,
  error,
  errorDetail,
  warning,
  analysis,
  items,
  sessionItems = [],
  frameDataUrl,
  mock,
  persisted,
  persistence,
  savedCount = 0,
  videoId,
  onReanalyze,
  canReanalyze,
  selectedKey,
  onSelectItem,
  onSearchExternal,
  maxVisibleCandidates,
  catalogMatchedCount = 0,
}: Props) {
  const t = useTranslations("studio.resultsPanel");
  const [tab, setTab] = useState<Tab>("frame");
  const vibe = normalizeStyle(analysis?.style_vibe);
  const catalogHref = videoId ? `/catalog?videoId=${videoId}` : "/catalog";
  const showSessionTab = sessionItems.length > 0;

  return (
    <aside className="panel flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{t("title")}</h2>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {t("subtitle")}
          </p>
        </div>
        {onReanalyze && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReanalyze}
            disabled={!canReanalyze || loading}
            title={t("reanalyzeTooltip")}
          >
            <RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
            {t("reanalyzeAction")}
          </Button>
        )}
      </header>

      {showSessionTab && (
        <div className="border-b border-line px-5 py-3">
          <Segmented
            size="sm"
            ariaLabel={t("scopeAriaLabel")}
            value={tab}
            onChange={setTab}
            className="w-full"
            options={[
              { value: "frame", label: t("thisFrame"), icon: ScanSearch, count: items.length },
              {
                value: "session",
                label: t("wholeVideo"),
                icon: Film,
                count: sessionItems.length,
              },
            ]}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {mock && (
          <Callout tone="warning" icon={TriangleAlert}>
            {t.rich("demoModeNotice", {
              code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
            })}
          </Callout>
        )}

        {/* Lo guardado son DETECCIONES, no productos del catálogo validados.
            El mensaje anterior ("N elementos guardados en el catálogo") hacía
            creer que el catálogo había crecido en N productos cuando lo único
            guardado eran objetos detectados; cuántos tienen de verdad un
            producto asociado se dice aparte. */}
        {savedCount > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/25 bg-brand/8 px-3.5 py-2.5">
            <p className="text-xs text-ink-muted">
              <CircleCheck className="mr-1.5 inline size-3.5 text-brand-bright" aria-hidden />
              <span className="font-medium text-brand-bright">
                {t("savedDetections", { count: savedCount })}
              </span>
              {catalogMatchedCount > 0 ? (
                <span className="ml-1 font-medium text-success">
                  · {t("withCatalogProduct", { count: catalogMatchedCount })}
                </span>
              ) : null}
              <span className="ml-1 text-ink-faint">{t("savedDetectionsHint")}</span>
              <PersistenceHint persisted={persisted} persistence={persistence} />
            </p>
            <Link
              href={catalogHref}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand/30 px-2 py-1 text-[11px] font-medium text-brand-bright transition-colors hover:bg-brand/15"
            >
              {t("view")}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </div>
        )}

        {warning && (
          <Callout tone="warning" icon={TriangleAlert}>
            {IS_PRESENTATION ? t("localSaveNotice") : warning}
          </Callout>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="space-y-4"
          >
            {tab === "session" && showSessionTab && (
              <>
                <Callout tone="brand" icon={Layers}>
                  {t("sessionSummary", { count: sessionItems.length })}
                </Callout>
                <GroupedProductList
                  items={sessionItems}
                  keyPrefix="session"
                  onSearchExternal={onSearchExternal}
                  maxVisibleCandidates={maxVisibleCandidates}
                />
              </>
            )}

            {tab === "frame" && (
              <>
                {frameDataUrl && <FramePreview dataUrl={frameDataUrl} items={items} />}

                {error && (
                  <Callout tone="danger" icon={TriangleAlert} title={t("analyzeErrorTitle")}>
                    <p>{error}</p>
                    {errorDetail && !IS_PRESENTATION && (
                      <details className="mt-2 text-[11px] text-danger/80">
                        <summary className="cursor-pointer select-none font-medium hover:text-danger">
                          {t("technicalDetails")}
                        </summary>
                        <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-danger/20 bg-black/20 p-2 font-mono text-[10px] leading-relaxed text-ink-muted">
                          {errorDetail}
                        </pre>
                      </details>
                    )}
                  </Callout>
                )}

                {/* Skeleton solo si aún no hay NADA: con streaming los items
                    parciales se pintan según llegan. */}
                {loading && !analysis?.items?.length && <LoadingAnalysis />}

                {(streaming || (loading && Boolean(analysis?.items?.length))) && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-brand/25 bg-brand/8 px-3.5 py-2.5 text-xs text-brand-bright">
                    <span className="relative flex size-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-brand-bright opacity-70" />
                      <span className="relative size-1.5 rounded-full bg-brand-bright" />
                    </span>
                    {t("detectingMore")}
                  </div>
                )}

                {analysis && Boolean(analysis.items.length || !loading) && (
                  <>
                    {analysis.summary && (
                      <p className="text-[13px] leading-relaxed text-ink-muted">
                        {analysis.summary}
                      </p>
                    )}

                    {items.length > 0 && (
                      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-linear-to-r from-brand/10 to-accent/5 px-3.5 py-2.5">
                        <Sparkles className="size-3.5 shrink-0 text-brand-bright" aria-hidden />
                        <p className="text-xs text-ink-muted">
                          {t("styleDetectedLabel")}{" "}
                          <span className="font-semibold text-ink">
                            {prettyStyleLabel(vibe)}
                          </span>
                        </p>
                      </div>
                    )}

                    {items.length > 0 ? (
                      <GroupedProductList
                        items={items}
                        keyPrefix="frame"
                        frameUrl={frameDataUrl}
                        selectedKey={selectedKey}
                        onSelectItem={onSelectItem}
                        onSearchExternal={onSearchExternal}
                        maxVisibleCandidates={maxVisibleCandidates}
                      />
                    ) : (
                      <EmptyState
                        icon={Search}
                        title={t("noItemsTitle")}
                        description={t("noItemsDescription")}
                      />
                    )}
                  </>
                )}

                {!loading && !analysis && !error && (
                  <EmptyState
                    icon={ScanSearch}
                    title={t("readyTitle")}
                    description={t("readyDescription")}
                  />
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="flex items-start gap-2 border-t border-line px-5 py-3">
        <Lock className="mt-px size-3 shrink-0 text-ink-faint" aria-hidden />
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t("privacyNote")}
        </p>
      </footer>
    </aside>
  );
}

/** Matiz del estado de guardado según el modo de persistencia real. */
function PersistenceHint({
  persisted,
  persistence,
}: {
  persisted?: boolean;
  persistence?: PersistenceStatus | null;
}) {
  const t = useTranslations("studio.resultsPanel");
  if (persisted) return null;
  if (persistence === "memory_fallback") {
    return <span className="text-warning/80">{t("memoryFallbackNote")}</span>;
  }
  if (IS_PRESENTATION) return <span className="text-ink-faint">{t("localSessionNote")}</span>;
  return (
    <span className="text-ink-faint">
      {t.rich("memoryNote", {
        code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
      })}
    </span>
  );
}
