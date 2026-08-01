"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity, Boxes, ExternalLink, History, ImageIcon, Trash2, Users, Video,
} from "lucide-react";
import VideoProviderAnalyzer, {
  type PausedFrameContext,
} from "@/components/VideoProviderAnalyzer";
import AnalysisConfigSelector from "@/components/AnalysisConfigSelector";
import ImageAnalyzer from "@/components/ImageAnalyzer";
import ProductResultsPanel from "@/components/ProductResultsPanel";
import CostPanel from "@/components/CostPanel";
import { useAnalysisSettings } from "@/hooks/useAnalysisSettings";
import { useFrameAnalysis } from "@/hooks/useFrameAnalysis";
import { useObjectMatching, clientFingerprint } from "@/hooks/useObjectMatching";
import {
  activeTrackCount,
  associateDetections,
  createTrackerState,
} from "@/lib/video/tracker";
import {
  clearHistory,
  loadHistory,
  loadPreferences,
  personalizeRanking,
  pushHistory,
  recordClick,
} from "@/lib/storage";
import type {
  DetectedItem,
  HistoryEntry,
  Preferences,
  ProductLink,
} from "@/lib/types";
import { isCategoryAllowed } from "@/lib/analysis/categories";
import type { FrameMeta } from "@/lib/api/types";
import { IS_PRESENTATION } from "@/lib/presentation";
import { formatTimestamp, itemKey } from "@/lib/utils";
import { Badge, Button, Drawer, SectionLabel, Segmented } from "@/components/ui";
import CommerceSidePanel from "@/components/click-to-shop/CommerceSidePanel";
import {
  EMPTY_PAUSE_METRICS,
  pruneAnalyzedFrames,
  type AnalysisIdentity,
  type AnalyzedVideoFrame,
  type PausePerformanceMetrics,
} from "@/lib/video/pauseAnalysis";

/**
 * Estudio de análisis: la herramienta real.
 *
 * Vive en un componente propio (y no en `app/page.tsx`) porque se monta en DOS
 * sitios: embebido al final de la landing (#studio) y como página completa en
 * `/studio`. La lógica de análisis es exactamente la misma en ambos.
 */

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

type Mode = "video" | "image";

type CostData = {
  openaiVisionCalls: number;
  openaiVisionCostUsd: number;
  openaiProductCalls: number;
  openaiProductCostUsd: number;
  mockCalls: number;
  cacheHits: number;
  totalCostUsd: number;
};

const COST_POLL_MS = 8000;

function metaFromHistory(entry: HistoryEntry): FrameMeta {
  const key = entry.videoKey;
  const sourceType: FrameMeta["sourceType"] = key.startsWith("yt:")
    ? "youtube"
    : key.startsWith("local:")
      ? "uploaded"
      : key.startsWith("img:")
        ? "image_upload"
        : "external_url";
  return {
    sourceType,
    videoKey: key,
    videoUrl: key.startsWith("yt:")
      ? `https://www.youtube.com/watch?v=${key.slice(3)}`
      : undefined,
    timestampSeconds: entry.timestampSeconds,
    cacheKey: `${key}:${entry.timestampSeconds}`,
  };
}

/** Fingerprint de sesión: 4 primeras palabras + categoría + color. */
function sessionFingerprint(item: DetectedItem): string {
  const normName = (item.name ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 4)
    .join(" ");
  return `${normName}|${(item.category ?? "").toLowerCase().trim()}|${(item.color ?? "").toLowerCase().trim()}`;
}

export default function StudioExperience({
  variant = "page",
}: {
  /** `embedded` se usa dentro de la landing: sin cabecera propia de página. */
  variant?: "page" | "embedded";
}) {
  const t = useTranslations("studio");
  const [mode, setMode] = useState<Mode>("video");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [prefs, setPrefs] = useState<Preferences>({ categoryClicks: {}, styleClicks: {} });
  const [sessionItems, setSessionItems] = useState<DetectedItem[]>([]);
  const [selectedOverlayItem, setSelectedOverlayItem] = useState<DetectedItem | null>(null);
  const [activePausedFrame, setActivePausedFrame] = useState<PausedFrameContext | null>(null);
  const [preanalyzedFrames, setPreanalyzedFrames] = useState<AnalyzedVideoFrame[]>([]);
  const [pauseMetrics, setPauseMetrics] = useState<PausePerformanceMetrics>(
    EMPTY_PAUSE_METRICS
  );
  // Sincroniza el hotspot de la imagen analizada con su card en el panel lateral.
  /**
   * Objeto resaltado, COMPARTIDO por imagen y vídeo.
   *
   * Antes solo existía en modo imagen, así que en vídeo un clic en un recuadro
   * abría un cajón aparte y la tarjeta correspondiente no se enteraba. Con una
   * única clave, recuadro y tarjeta se resaltan juntos en los dos modos.
   */
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [costs, setCosts] = useState<CostData | null>(null);
  const currentVideoKeyRef = useRef<string | null>(null);
  // Tracker de productos entre pasadas de detección: trackIds persistentes.
  const trackerRef = useRef(createTrackerState());
  const [trackedObjects, setTrackedObjects] = useState(0);
  // Configuración elegida ANTES de analizar; se propaga al backend en cada
  // petición vía un ref siempre fresco. Persiste en localStorage: la fuente de
  // coincidencias elegida sobrevive al cambio imagen↔vídeo y a navegar a /demo.
  const {
    settings: analysisConfig,
    setSettings: setAnalysisConfig,
    settingsRef: analysisConfigRef,
  } = useAnalysisSettings();

  const analysisHook = useFrameAnalysis();
  const matching = useObjectMatching();
  const {
    analyze, analysis, loading, error, errorDetail, warning, mock, frameDataUrl,
    videoId: analyzedVideoId, savedItems, persisted, persistence,
  } = analysisHook;
  const [lastFrame, setLastFrame] = useState<{ url: string; meta: FrameMeta } | null>(null);

  useEffect(() => {
    // Diferido a un macrotask para no encadenar renders síncronos dentro del
    // propio efecto (regla react-hooks en React 19).
    const id = setTimeout(() => {
      setHistory(loadHistory());
      setPrefs(loadPreferences());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    async function fetchCosts() {
      try {
        const res = await fetch("/api/catalog/costs");
        if (res.ok) {
          const data = (await res.json()) as CostData & { ok: boolean };
          if (data.ok) setCosts(data);
        }
      } catch {
        /* el panel de coste es informativo: nunca rompe la pantalla */
      }
    }
    void fetchCosts();
    const id = setInterval(fetchCosts, COST_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const handleRequestAnalysis = useCallback(
    async (
      dataUrl: string,
      meta: FrameMeta,
      identity: AnalysisIdentity | null = null
    ) => {
      setLastFrame({ url: dataUrl, meta });
      if (meta.analysisTrigger === "pause" || meta.analysisTrigger === "image") {
        setSelectedItemKey(null);
      }

      // Cambio de fuente de vídeo: se reinicia la sesión de detección.
      if (currentVideoKeyRef.current !== meta.videoKey) {
        currentVideoKeyRef.current = meta.videoKey;
        setSessionItems([]);
        matching.reset();
        trackerRef.current = createTrackerState();
        setTrackedObjects(0);
        setPreanalyzedFrames([]);
      }

      const cfg = analysisConfigRef.current;
      const result = await analyze(dataUrl, meta, cfg, identity);
      if (!result) return;

      // Defensa en cliente: aunque el backend ya filtra, no dejamos entrar un
      // objeto fuera de categoría en el catálogo de sesión.
      result.analysis.items = result.analysis.items.filter((it) =>
        isCategoryAllowed(it, cfg.categories)
      );
      // La misma camisa conserva su trackId entre pasadas; dos tazas distintas
      // son dos tracks.
      associateDetections(trackerRef.current, result.analysis.items, Date.now());
      setTrackedObjects(activeTrackCount(trackerRef.current));

      // Mapa fingerprint→id de catálogo de lo recién persistido: permite que
      // match-object asocie crop y recomendaciones a la fila correcta.
      const itemIdByFingerprint = new Map<string, string>();
      for (const saved of result.savedItems) {
        itemIdByFingerprint.set(clientFingerprint(saved.item), saved.item.id);
      }
      // En vídeo el matching es BAJO DEMANDA: detectar no inicia catálogo ni
      // Internet. En imagen se conserva el flujo automático existente.
      if (meta.sourceType === "image_upload") {
        matching.enqueue(result.analysis.items, dataUrl, {
          videoKey: meta.videoKey,
          itemIdByFingerprint,
          matchingMode: cfg.matchingMode,
          timestampSeconds: meta.timestampSeconds,
        });
      } else {
        setPreanalyzedFrames((previous) =>
          pruneAnalyzedFrames(
            [
              ...previous,
              {
                videoId: meta.videoKey,
                frameId: meta.frameId ?? identity?.frameId ?? crypto.randomUUID(),
                mediaTime: meta.mediaTime ?? meta.timestampSeconds,
                frameHash:
                  meta.frameHash ?? meta.cacheKey ?? `${meta.videoKey}:${meta.timestampSeconds}`,
                detections: result.analysis.items,
                tracks: result.analysis.items.map(clientFingerprint),
                analyzedAt: Date.now(),
              },
            ],
            meta.mediaTime ?? meta.timestampSeconds
          )
        );
      }

      setHistory(
        pushHistory({
          videoKey: meta.videoKey,
          timestampSeconds: meta.timestampSeconds,
          analysis: result.analysis,
          frameDataUrl: dataUrl,
        })
      );

      // Acumulado de objetos únicos con seenCount.
      setSessionItems((prev) => {
        const now = Date.now();
        const indexMap = new Map(prev.map((it, i) => [sessionFingerprint(it), i]));
        const next = [...prev];
        let changed = false;

        for (const item of result.analysis.items) {
          const key = sessionFingerprint(item);
          const idx = indexMap.get(key);
          if (idx != null) {
            const ex = next[idx];
            next[idx] = {
              ...ex,
              seenCount: (ex.seenCount ?? 1) + 1,
              lastSeenAt: now,
              confidence: Math.max(ex.confidence, item.confidence),
              visible_brand: item.visible_brand ?? ex.visible_brand,
              logo_description: item.logo_description ?? ex.logo_description,
              visible_text: item.visible_text ?? ex.visible_text,
              description: item.description || ex.description,
            };
          } else {
            next.push({ ...item, seenCount: 1, firstSeenAt: now, lastSeenAt: now });
            indexMap.set(key, next.length - 1);
          }
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matching.enqueue/reset son estables
    [analyze, matching.enqueue, matching.reset]
  );

  const handleReanalyze = useCallback(() => {
    if (!lastFrame) return;
    void handleRequestAnalysis(lastFrame.url, {
      ...lastFrame.meta,
      cacheKey: `${lastFrame.meta.cacheKey}:r${Date.now()}`,
    });
  }, [lastFrame, handleRequestAnalysis]);

  const handleLinkClick = useCallback((item: DetectedItem, link: ProductLink) => {
    void link;
    setPrefs(recordClick(item));
  }, []);

  /** Fusiona los resultados de matching (cola async) en cada item. */
  const applyMatching = useCallback(
    (items: DetectedItem[]): DetectedItem[] =>
      items.map((item) => {
        const entry = matching.results.get(clientFingerprint(item));
        if (!entry) return item;
        return {
          ...item,
          matchingStatus: entry.status,
          // Contrato nuevo: dos bloques con procedencia explícita.
          detection_result: entry.detection ?? item.detection_result,
          external_loading: entry.externalLoading,
          matching_phase: entry.phase,
          matching_started_at: entry.startedAt,
          visual_match: entry.match ?? item.visual_match,
          similar_candidates: entry.similarCandidates.length
            ? entry.similarCandidates
            : item.similar_candidates,
          matching_debug: {
            providerUsed: entry.providerUsed,
            fallbackUsed: entry.fallbackUsed,
            cached: entry.cached,
            totalMs: entry.totalMs,
            detail: entry.detail,
            matchingMode: entry.matchingMode,
            externalFallbackUsed: entry.externalFallbackUsed,
          },
        };
      }),
    [matching.results]
  );

  const personalizedItems = useMemo(
    () => (analysis ? applyMatching(personalizeRanking(analysis, prefs)) : []),
    [analysis, prefs, applyMatching]
  );
  const mergedSessionItems = useMemo(
    () => applyMatching(sessionItems),
    [sessionItems, applyMatching]
  );

  const switchMode = (next: Mode) => {
    setMode(next);
    analysisHook.reset();
    matching.reset();
    setLastFrame(null);
    setSessionItems([]);
    currentVideoKeyRef.current = null;
    trackerRef.current = createTrackerState();
    setTrackedObjects(0);
    setSelectedItemKey(null);
    setSelectedOverlayItem(null);
    setActivePausedFrame(null);
    setPreanalyzedFrames([]);
    setPauseMetrics(EMPTY_PAUSE_METRICS);
  };

  const overlayItems = personalizedItems;
  const personCount = new Set(
    overlayItems.map((it) => it.person_index).filter((p): p is number => typeof p === "number")
  ).size;
  /**
   * Objetos con coincidencia fiable en ALGUNA fuente. Cuenta los dos bloques
   * por separado y no un `visual_match` genérico, que no distinguía si el
   * producto venía del catálogo o de Internet.
   */
  const matchedCount = mergedSessionItems.filter((it) => {
    const d = it.detection_result;
    if (d) return d.catalog.status === "matched" || d.external.status === "matched";
    return it.visual_match && it.visual_match.match_type !== "similar";
  }).length;
  /** Solo los resueltos por el CATÁLOGO propio: es lo que se puede afirmar. */
  const catalogMatchedCount = mergedSessionItems.filter(
    (it) => it.detection_result?.catalog.status === "matched"
  ).length;

  /**
   * Selección de una tarjeta: resalta su recuadro y registra la preferencia
   * (personalización del ranking). Es el reemplazo del antiguo `onLinkClick`,
   * que solo se disparaba al abrir un enlace de compra.
   */
  const handleSelectItem = useCallback((item: DetectedItem) => {
    setSelectedItemKey(itemKey(item));
    setPrefs(recordClick(item));
  }, []);

  /** Clic en un recuadro: resalta su tarjeta (que hace scroll) y abre el detalle. */
  const handleOverlayItemClick = useCallback((item: DetectedItem) => {
    setSelectedItemKey(itemKey(item));
    setSelectedOverlayItem(item);
  }, []);

  const handleVideoDetectionSelect = useCallback(
    (item: DetectedItem, context: PausedFrameContext) => {
      handleOverlayItemClick(item);
      const itemIdByFingerprint = new Map<string, string>();
      for (const saved of savedItems) {
        itemIdByFingerprint.set(clientFingerprint(saved.item), saved.item.id);
      }
      matching.matchNow(item, context.dataUrl, {
        videoKey: context.meta.videoKey,
        frameId: context.identity.frameId,
        frameHash: context.meta.frameHash,
        mediaTime: context.identity.mediaTime,
        sessionId: context.identity.sessionId,
        itemIdByFingerprint,
        matchingMode: analysisConfigRef.current.matchingMode,
        timestampSeconds: context.identity.mediaTime,
      });
    },
    [handleOverlayItemClick, matching, savedItems, analysisConfigRef]
  );

  const selectedCommerceItem = useMemo(
    () => (selectedOverlayItem ? applyMatching([selectedOverlayItem])[0] : null),
    [selectedOverlayItem, applyMatching]
  );
  const selectedMatchingEntry = selectedOverlayItem
    ? matching.results.get(clientFingerprint(selectedOverlayItem))
    : undefined;
  const commerceMetrics = useMemo<PausePerformanceMetrics>(
    () => ({
      ...pauseMetrics,
      cropMs: selectedMatchingEntry?.timings?.cropMs ?? pauseMetrics.cropMs,
      embeddingMs:
        selectedMatchingEntry?.timings?.embeddingMs ?? pauseMetrics.embeddingMs,
      vectorSearchMs:
        selectedMatchingEntry?.timings?.vectorSearchMs ?? pauseMetrics.vectorSearchMs,
      rankingMs: selectedMatchingEntry?.timings?.rankingMs ?? pauseMetrics.rankingMs,
      catalogFirstResultMs:
        selectedMatchingEntry?.timings?.catalogFirstResultMs ??
        pauseMetrics.catalogFirstResultMs,
      externalSearchMs:
        selectedMatchingEntry?.timings?.externalSearchMs ?? pauseMetrics.externalSearchMs,
      totalMs: selectedMatchingEntry?.timings?.totalMs ?? pauseMetrics.totalMs,
    }),
    [pauseMetrics, selectedMatchingEntry]
  );

  return (
    <div className="w-full">
      {/* ---------------- barra de estado del estudio ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            ariaLabel={t("analysisType.label")}
            value={mode}
            onChange={switchMode}
            options={[
              { value: "video", label: t("analysisType.video"), icon: Video },
              { value: "image", label: t("analysisType.image"), icon: ImageIcon },
            ]}
          />
          {IS_DEMO && (
            <Badge tone="warning" size="md" dot pulse>
              {t("demoBadge")}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LiveStat icon={Users}>
            {t.rich("liveStats.peopleDetected", {
              count: personCount,
              value: (chunks) => <AnimatedCount>{chunks}</AnimatedCount>,
            })}
          </LiveStat>
          <LiveStat icon={Activity}>
            {t.rich("liveStats.tracking", {
              count: trackedObjects,
              value: (chunks) => <AnimatedCount>{chunks}</AnimatedCount>,
            })}
          </LiveStat>
          <LiveStat icon={Boxes}>
            {t.rich("liveStats.uniqueProducts", {
              count: sessionItems.length,
              value: (chunks) => <AnimatedCount>{chunks}</AnimatedCount>,
            })}
          </LiveStat>
          <LiveStat icon={ExternalLink} tone={matchedCount > 0 ? "success" : "neutral"}>
            <AnimatedCount>{matchedCount}</AnimatedCount>
            <span className="text-[11px] text-ink-subtle">{t("liveStats.withMatch")}</span>
          </LiveStat>
        </div>
      </div>

      {/* ---------------- área de trabajo ---------------- */}
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 space-y-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="space-y-5"
            >
              {mode === "video" ? (
                <>
                  <AnalysisConfigSelector config={analysisConfig} onChange={setAnalysisConfig} />
                  <VideoProviderAnalyzer
                    onRequestAnalysis={handleRequestAnalysis}
                    analyzing={loading}
                    overlayItems={overlayItems}
                    onOverlayItemClick={handleOverlayItemClick}
                    selectedKey={selectedItemKey}
                    analysisStats={{
                      persons: personCount,
                      trackedObjects,
                      uniqueProducts: sessionItems.length,
                      matchedProducts: matchedCount,
                    }}
                    analysisIdentity={analysisHook.identity}
                    preanalyzedFrames={preanalyzedFrames}
                    onPauseStart={() => {
                      analysisHook.cancel(true);
                      setSelectedItemKey(null);
                      setSelectedOverlayItem(null);
                    }}
                    onPausedFrameChange={(context) => {
                      setActivePausedFrame(context);
                      if (!context) {
                        setSelectedItemKey(null);
                        setSelectedOverlayItem(null);
                      }
                    }}
                    onDetectionSelect={handleVideoDetectionSelect}
                    onMetricsChange={setPauseMetrics}
                    selectedItemDetails={selectedCommerceItem}
                  />
                </>
              ) : (
                <ImageAnalyzer
                  onRequestAnalysis={handleRequestAnalysis}
                  analyzing={loading}
                  onReset={() => {
                    analysisHook.reset();
                    setSelectedItemKey(null);
                  }}
                  items={personalizedItems}
                  selectedKey={selectedItemKey}
                  onItemClick={(item) => setSelectedItemKey(itemKey(item))}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {history.length > 0 && (
            <HistoryStrip
              history={history}
              onClear={() => {
                clearHistory();
                setHistory([]);
              }}
              onSelect={(entry) =>
                entry.frameDataUrl &&
                handleRequestAnalysis(entry.frameDataUrl, metaFromHistory(entry))
              }
            />
          )}

          {/* Panel técnico: plegado en modo presentación para no distraer. */}
          {IS_PRESENTATION ? (
            <details className="panel px-4 py-3">
              <summary className="cursor-pointer text-xs font-medium text-ink-muted select-none">
                {t("technicalPanel")}
              </summary>
              <div className="mt-3">
                <CostPanel costs={costs} itemsDetected={sessionItems.length} />
              </div>
            </details>
          ) : (
            <CostPanel costs={costs} itemsDetected={sessionItems.length} />
          )}
        </section>

        {/* ---------------- resultados ---------------- */}
        <div
          className={
            variant === "page"
              ? "xl:sticky xl:top-20 xl:h-[calc(100vh-6rem)]"
              : "xl:sticky xl:top-20 xl:h-[calc(100vh-8rem)]"
          }
        >
          {mode === "video" ? (
            <CommerceSidePanel
              selectedItem={selectedCommerceItem}
              frameDataUrl={activePausedFrame?.dataUrl ?? null}
              paused={Boolean(activePausedFrame)}
              metrics={commerceMetrics}
              debug={!IS_PRESENTATION}
              onClose={() => {
                setSelectedItemKey(null);
                setSelectedOverlayItem(null);
              }}
              onSearchExternal={matching.requestExternal}
            />
          ) : (
          <ProductResultsPanel
            loading={loading}
            streaming={analysisHook.streaming}
            error={error}
            errorDetail={errorDetail}
            warning={warning}
            analysis={analysis}
            items={personalizedItems}
            sessionItems={mergedSessionItems}
            frameDataUrl={frameDataUrl}
            mock={mock}
            persisted={persisted}
            persistence={persistence}
            savedCount={savedItems.length}
            videoId={analyzedVideoId}
            catalogMatchedCount={catalogMatchedCount}
            onReanalyze={handleReanalyze}
            canReanalyze={Boolean(lastFrame)}
            selectedKey={selectedItemKey}
            onSelectItem={handleSelectItem}
            onSearchExternal={matching.requestExternal}
          />
          )}
        </div>
      </div>

      {/* Detalle del objeto clicado en el overlay del reproductor. */}
      <Drawer
        open={mode === "image" && Boolean(selectedOverlayItem)}
        onClose={() => setSelectedOverlayItem(null)}
        title={selectedOverlayItem?.name ?? t("product.fallbackTitle")}
        subtitle={
          selectedOverlayItem
            ? t("overlayDetail.subtitle", {
                category: selectedOverlayItem.category ?? "—",
                color: selectedOverlayItem.color ?? "—",
                confidence: Math.round(selectedOverlayItem.confidence * 100),
              })
            : undefined
        }
      >
        {selectedOverlayItem && (
          <OverlayItemDetail item={selectedOverlayItem} onLinkClick={handleLinkClick} />
        )}
      </Drawer>
    </div>
  );
}

function LiveStat({
  icon: Icon,
  tone = "neutral",
  children,
}: {
  icon: typeof Users;
  tone?: "neutral" | "success";
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.02] px-2.5 py-1.5">
      <Icon
        className={tone === "success" ? "size-3.5 text-success" : "size-3.5 text-ink-faint"}
        aria-hidden
      />
      {children}
    </span>
  );
}

/** Número animado (destaca al cambiar) usado dentro de un LiveStat. */
function AnimatedCount({ children }: { children: React.ReactNode }) {
  return (
    <motion.span
      key={String(children)}
      initial={{ scale: 1.25, color: "rgb(139 127 255)" }}
      animate={{ scale: 1, color: "rgb(242 243 247)" }}
      transition={{ duration: 0.4 }}
      className="text-[13px] font-semibold tabular-nums"
    >
      {children}
    </motion.span>
  );
}

function OverlayItemDetail({
  item,
  onLinkClick,
}: {
  item: DetectedItem;
  onLinkClick: (item: DetectedItem, link: ProductLink) => void;
}) {
  const t = useTranslations("studio");
  const format = useFormatter();
  const similars = item.similar_candidates ?? [];

  return (
    <div className="space-y-5">
      {item.description && (
        <p className="text-[13px] leading-relaxed text-ink-muted">{item.description}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {item.visible_brand && (
          <Badge tone="brand" size="md">{t("product.brand", { brand: item.visible_brand })}</Badge>
        )}
        {item.relationship && <Badge size="md">{item.relationship}</Badge>}
        {item.seenCount != null && (
          <Badge size="md">{t("product.seenCount", { count: item.seenCount })}</Badge>
        )}
      </div>

      <div>
        <SectionLabel>{t("overlayDetail.matchesTitle")}</SectionLabel>
        {similars.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {similars.slice(0, 6).map((candidate) => (
              <li key={candidate.link}>
                <a
                  href={candidate.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    onLinkClick(item, {
                      provider: candidate.store ?? "web",
                      type: "marketplace",
                      url: candidate.link,
                      label: candidate.title,
                      trustLevel: "medium",
                    })
                  }
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-3 transition-colors hover:border-brand/40 hover:bg-surface-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">
                      {candidate.title}
                    </span>
                    {candidate.store && (
                      <span className="block truncate text-[11px] text-ink-subtle">
                        {candidate.store}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {candidate.price != null && (
                      <span className="text-[13px] font-semibold text-ink tabular-nums">
                        {format.number(candidate.price)} €
                      </span>
                    )}
                    <ExternalLink className="size-3.5 text-ink-faint" aria-hidden />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-ink-subtle">
            {t("overlayDetail.searchingMatches")}
          </p>
        )}
      </div>
    </div>
  );
}

function HistoryStrip({
  history,
  onSelect,
  onClear,
}: {
  history: HistoryEntry[];
  onSelect: (entry: HistoryEntry) => void;
  onClear: () => void;
}) {
  const t = useTranslations("studio");
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel className="flex items-center gap-1.5">
          <History className="size-3" aria-hidden />
          {t("history.title")}
        </SectionLabel>
        <Button variant="ghost" size="xs" onClick={onClear}>
          <Trash2 className="size-3" aria-hidden />
          {t("history.clear")}
        </Button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {history.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry)}
            disabled={!entry.frameDataUrl}
            className="group w-32 shrink-0 overflow-hidden rounded-xl border border-line bg-black/40 text-left transition-colors hover:border-brand/40 disabled:opacity-50"
          >
            <div className="aspect-video w-full overflow-hidden">
              {entry.frameDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.frameDataUrl}
                  alt={t("history.frameAlt")}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="grid size-full place-items-center text-ink-faint">—</div>
              )}
            </div>
            <div className="px-2 py-1.5">
              <p className="truncate text-[11px] font-medium text-ink-muted">
                {t("history.itemCount", { count: entry.analysis.items.length })}
              </p>
              <p className="text-[10px] text-ink-faint">
                {entry.videoKey.startsWith("img:")
                  ? t("product.imageAlt")
                  : formatTimestamp(entry.timestampSeconds)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
