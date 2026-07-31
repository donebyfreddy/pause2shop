"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  CircleAlert,
  ExternalLink,
  FlaskConical,
  Info,
  KeyRound,
  Pause,
  Play,
  Plug,
  RadioTower,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  DataRow,
  Drawer,
  EmptyState,
  SearchInput,
  SectionLabel,
  Segmented,
  Select,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
  SkeletonRows,
  useToast,
} from "@/components/ui";
import { adminPost, useAdminResource } from "@/lib/admin/client";
import {
  ACCESS_META,
  COMPLIANCE_META,
  HEALTH_META,
  JOB_META,
  JOB_TYPE_LABEL,
  LIFECYCLE_META,
  TIER_LABEL,
  VERIFICATION_META,
  formatDuration,
  metaFor,
  EFFECTIVE_STATUS_META,
  timeAgo,
} from "@/lib/admin/status";
import type {
  Connector,
  ConnectorDetail,
  ConnectorsResponse,
  ConnectorTestResult,
} from "@/lib/catalogService/types";

/**
 * Conectores. Es la pantalla donde el registro tiene que ser HONESTO: se
 * muestran los dos ejes por fila (madurez de la implementación y salud medida),
 * y las credenciales que faltan se listan explícitamente.
 */

type GroupFilter = "all" | "syncable" | "partner" | "paused" | "problem";

export function ConnectorsView() {
  const t = useTranslations("connectors");
  const tActions = useTranslations("actions");
  const tToast = useTranslations("toast.connectors");
  const toast = useToast();
  const router = useRouter();

  const GROUP_OPTIONS = useMemo(
    () => [
      { value: "all" as const, label: t("filters.group.all") },
      { value: "syncable" as const, label: t("filters.group.syncable") },
      { value: "partner" as const, label: t("filters.group.partner") },
      { value: "paused" as const, label: t("filters.group.paused") },
      { value: "problem" as const, label: t("filters.group.problem") },
    ],
    [t]
  );
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GroupFilter>("all");
  const [tier, setTier] = useState("all");
  const [live, setLive] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, refreshing, reload } = useAdminResource<ConnectorsResponse>(
    `connectors${live ? "?health=live" : ""}`,
    { pollMs: 30_000 }
  );

  // Memoizado para que `filtered` no se recalcule en cada render por culpa de
  // un array nuevo salido del `?? []`.
  const connectors = useMemo(() => data?.connectors ?? [], [data?.connectors]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return connectors.filter((c) => {
      if (needle) {
        const haystack = `${c.label} ${c.brand} ${c.group ?? ""} ${c.id} ${c.region} ${c.categories.join(" ")}`;
        if (!haystack.toLowerCase().includes(needle)) return false;
      }
      if (tier !== "all" && c.tier !== tier) return false;
      switch (group) {
        case "syncable":
          return c.canSync && !c.paused;
        case "partner":
          return c.lifecycle === "partner_required" || c.lifecycle === "needs_credentials";
        case "paused":
          return c.paused;
        case "problem":
          return ["blocked", "disallowed", "error"].includes(c.health);
        default:
          return true;
      }
    });
  }, [connectors, query, group, tier]);

  const act = async (
    id: string,
    action: "pause" | "resume" | "test" | "health",
    label: string
  ) => {
    setBusy(`${id}:${action}`);
    const res = await adminPost<ConnectorTestResult | { status: string }>(
      `connectors/${id}/${action}`
    );
    setBusy(null);
    if (!res.ok) {
      toast.error(tToast("actionFailed", { action: label }), res.error.message);
      return;
    }
    if (action === "test") {
      const result = res.data as ConnectorTestResult;
      if (result.ok) {
        toast.success(
          t("toast.testSucceeded", { label: result.label }),
          t("toast.testSample", {
            sampleTitle: result.sampleTitle ?? "—",
            duration: formatDuration(result.durationMs),
          })
        );
      } else {
        const failed = result.steps.find((s) => !s.ok);
        toast.error(
          t("toast.testFailed", { label: result.label, step: failed?.step ?? "?" }),
          failed?.detail ?? t("toast.noDetail")
        );
      }
    } else if (action === "health") {
      const health = res.data as unknown as { status: string; note: string };
      const meta = metaFor(HEALTH_META, health.status);
      toast.info(t("toast.healthChecked", { id, label: meta.label }), health.note);
    } else {
      toast.success(
        action === "pause" ? tToast("paused", { id }) : tToast("resumed", { id })
      );
    }
    reload();
  };

  const launchSync = async (id: string, mode: "full" | "incremental") => {
    setBusy(`${id}:sync`);
    // Sin `limit`: el servidor decide con SCRAPER_MAX_PRODUCTS_PER_SOURCE
    // (0 = sin límite funcional, siempre por lotes). Un límite bajo fijo aquí
    // era exactamente el "límite oculto" que impedía un full sync real.
    const res = await adminPost<{ jobId: string }>("jobs/sync", { source: id, mode });
    setBusy(null);
    if (!res.ok) {
      toast.error(tToast("syncFailed"), res.error.message);
      return;
    }
    toast.success(
      t("toast.syncQueued", {
        mode: mode === "full" ? t("syncMode.full") : t("syncMode.incremental"),
        source: id,
      }),
      t("toast.syncQueuedDetail", { jobId: res.data.jobId.slice(0, 8) })
    );
    // Abre el detalle del job recién creado en vez de dejar que el operador lo
    // busque a mano en la lista: es la diferencia entre "parece que no ha
    // pasado nada" y ver "En cola" en el momento.
    router.push(`/admin/jobs?open=${res.data.jobId}`);
  };

  const summary = data?.summary;

  return (
    <div className="space-y-5">
      {/* ------------------------- resumen ------------------------- */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryTile
            icon={Plug}
            label={t("kpi.registered")}
            value={summary.total}
            hint={t("kpi.registeredHint")}
          />
          <SummaryTile
            icon={Rocket}
            label={t("kpi.syncable")}
            value={summary.syncable}
            hint={t("kpi.syncableHint")}
            tone="success"
          />
          <SummaryTile
            icon={ShieldCheck}
            label={t("kpi.verifiedLive")}
            value={connectors.filter((c) => c.verifiedLive).length}
            hint={t("kpi.verifiedLiveHint")}
            tone="brand"
          />
          <SummaryTile
            icon={KeyRound}
            label={t("kpi.requireAgreement")}
            value={
              (summary.byLifecycle.partner_required ?? 0) +
              (summary.byLifecycle.needs_credentials ?? 0)
            }
            hint={t("kpi.requireAgreementHint")}
            tone="warning"
          />
        </div>
      )}

      <Callout tone="info" icon={Info} title={t("callout.title")}>
        {t.rich("callout.body", {
          muted: (chunks) => <span className="text-ink-muted">{chunks}</span>,
          em: (chunks) => <em>{chunks}</em>,
        })}
      </Callout>

      {/* ------------------------- filtros ------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          placeholder={t("filters.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-56 flex-1"
        />
        <Segmented
          size="sm"
          ariaLabel={t("filters.filterAriaLabel")}
          value={group}
          onChange={setGroup}
          options={GROUP_OPTIONS}
        />
        <Select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="w-auto min-w-40"
          aria-label={t("filters.segmentLabel")}
        >
          <option value="all">{t("filters.allSegments")}</option>
          {Object.entries(TIER_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Button
          variant={live ? "success" : "outline"}
          size="sm"
          onClick={() => setLive((v) => !v)}
          title={t("actions.healthLiveTitle")}
        >
          <RadioTower className="size-3.5" aria-hidden />
          {live ? t("actions.healthLiveActive") : t("actions.healthLiveCheck")}
        </Button>
        <Button variant="ghost" size="sm" icon onClick={reload} aria-label={t("actions.refresh")}>
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} aria-hidden />
        </Button>
      </div>

      {/* ------------------------- tabla ------------------------- */}
      <Card className="overflow-hidden">
        <TableWrap className="max-h-[68vh] overflow-y-auto">
          <Table className="min-w-[1080px]">
            <THead>
              <TR>
                <TH>{t("table.source")}</TH>
                <TH>{t("table.realStatus")}</TH>
                <TH>{t("table.health")}</TH>
                <TH>{t("table.discovery")}</TH>
                <TH>{t("table.compliance")}</TH>
                <TH className="text-right">{t("table.products")}</TH>
                <TH className="text-right">{t("table.extraction")}</TH>
                <TH>{t("table.lastSync")}</TH>
                <TH className="text-right">{t("table.actions")}</TH>
              </TR>
            </THead>
            <TBody>
              {loading && <SkeletonRows rows={8} cols={8} />}

              {!loading && error && (
                <TableEmpty colSpan={8}>
                  <EmptyState
                    icon={CircleAlert}
                    title={t("errors.loadFailed")}
                    description={error.message}
                    action={
                      <Button variant="secondary" size="sm" onClick={reload}>
                        {tActions("retryJob")}
                      </Button>
                    }
                  />
                </TableEmpty>
              )}

              {!loading && !error && filtered.length === 0 && (
                <TableEmpty colSpan={8}>
                  <EmptyState
                    icon={Search}
                    title={t("empty.noMatchTitle")}
                    description={t("empty.noMatchDescription")}
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setQuery("");
                          setGroup("all");
                          setTier("all");
                        }}
                      >
                        {t("empty.clearFilters")}
                      </Button>
                    }
                  />
                </TableEmpty>
              )}

              {!loading &&
                filtered.map((connector) => (
                  <ConnectorRow
                    key={connector.id}
                    connector={connector}
                    busy={busy}
                    onOpen={() => setOpenId(connector.id)}
                    onAction={act}
                    onSync={launchSync}
                  />
                ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <p className="text-[11px] text-ink-faint">
        {t("footer.showingCount", { filtered: filtered.length, total: connectors.length })}
      </p>

      <ConnectorDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onAction={act}
        onSync={launchSync}
        busy={busy}
      />
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: typeof Plug;
  label: string;
  value: number;
  hint: string;
  tone?: "neutral" | "success" | "warning" | "brand";
}) {
  const tones = {
    neutral: "text-ink-subtle",
    success: "text-success",
    warning: "text-warning",
    brand: "text-brand-bright",
  }[tone];
  return (
    <div className="panel px-4 py-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
          {label}
        </p>
        <Icon className={`size-4 ${tones}`} aria-hidden />
      </div>
      <p className="mt-1.5 text-2xl font-semibold text-ink tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-subtle">{hint}</p>
    </div>
  );
}

function ConnectorRow({
  connector,
  busy,
  onOpen,
  onAction,
  onSync,
}: {
  connector: Connector;
  busy: string | null;
  onOpen: () => void;
  onAction: (id: string, action: "pause" | "resume" | "test" | "health", label: string) => void;
  onSync: (id: string, mode: "full" | "incremental") => void;
}) {
  const lifecycle = metaFor(LIFECYCLE_META, connector.lifecycle);
  const health = metaFor(HEALTH_META, connector.health);
  const access = metaFor(ACCESS_META, connector.access);
  const compliance = metaFor(COMPLIANCE_META, connector.compliance);
  const verification = metaFor(
    VERIFICATION_META,
    // `verifiedLive` lo deriva el servidor de los productos REALES que hay en
    // catálogo; pisa lo que declare el spec, que es solo una intención.
    connector.verifiedLive ? "live" : connector.verification
  );
  const effective = metaFor(EFFECTIVE_STATUS_META, connector.effectiveStatus);
  const isBusy = (action: string) => busy === `${connector.id}:${action}`;
  const t = useTranslations("connectors");
  const format = useFormatter();

  return (
    <TR interactive onClick={onOpen}>
      <TD>
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-[11px] font-semibold text-ink-muted">
            {connector.label.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{connector.label}</p>
            <p className="truncate text-[11px] text-ink-faint">
              {connector.group ? `${connector.group} · ` : ""}
              {TIER_LABEL[connector.tier] ?? connector.tier} · {connector.region}
            </p>
          </div>
        </div>
      </TD>
      <TD>
        {/* El estado EFECTIVO manda: combina madurez y salud en una etiqueta
            que no promete nada que no se haya comprobado. */}
        <div className="flex flex-col items-start gap-1">
          <Badge tone={effective.tone} title={effective.description}>
            {effective.label}
          </Badge>
          <span className="text-[10px] text-ink-faint">
            {lifecycle.label}
            {connector.verification !== "none" ? ` · ${verification.label}` : ""}
          </span>
        </div>
      </TD>
      <TD>
        <Badge tone={health.tone} dot pulse={connector.health === "available"}>
          {health.label}
        </Badge>
      </TD>
      <TD>
        <span className="text-[11px] text-ink-muted">{access.label}</span>
        {connector.discoveryKinds.length > 0 && (
          <p className="font-mono text-[10px] text-ink-faint">
            {connector.discoveryKinds.join(", ")}
          </p>
        )}
      </TD>
      <TD>
        <Badge tone={compliance.tone}>{compliance.label}</Badge>
      </TD>
      <TD className="text-right font-medium text-ink tabular-nums">
        {format.number(connector.productCount)}
      </TD>
      <TD className="text-right">
        {/* % con IA / sin IA: medido sobre los productos ya guardados. */}
        {connector.extraction.total > 0 ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-[11px] text-ink-muted tabular-nums">
              {t("extraction.withoutAiPct", {
                pct: Math.round((1 - (connector.extraction.aiRatio ?? 0)) * 100),
              })}
            </span>
            <span className="font-mono text-[10px] text-ink-faint tabular-nums">
              {connector.extraction.withAi > 0
                ? t("extraction.withAiCost", {
                    count: connector.extraction.withAi,
                    cost: format.number(connector.extraction.aiCostUsd, "usdCost"),
                  })
                : t("extraction.noAiCalls")}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-ink-faint">—</span>
        )}
      </TD>
      <TD className="text-[11px] whitespace-nowrap">{timeAgo(connector.lastSyncAt)}</TD>
      <TD onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {connector.canSync && !connector.paused && (
            <Button
              variant="primary"
              size="xs"
              loading={isBusy("sync")}
              onClick={() => onSync(connector.id, "full")}
              title={t("actions.syncFullTitle")}
            >
              {t("actions.syncShort")}
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            icon
            loading={isBusy("test")}
            onClick={() => onAction(connector.id, "test", t("actionLabels.test"))}
            title={t("actions.testTitle")}
          >
            <FlaskConical className="size-3.5" aria-hidden />
          </Button>
          {connector.paused ? (
            <Button
              variant="success"
              size="xs"
              icon
              loading={isBusy("resume")}
              onClick={() => onAction(connector.id, "resume", t("actionLabels.resume"))}
              title={t("actions.resumeTitle")}
            >
              <Play className="size-3.5" aria-hidden />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              icon
              loading={isBusy("pause")}
              onClick={() => onAction(connector.id, "pause", t("actionLabels.pause"))}
              title={t("actions.pauseTitle")}
            >
              <Pause className="size-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </TD>
    </TR>
  );
}

function ConnectorDrawer({
  id,
  onClose,
  onAction,
  onSync,
  busy,
}: {
  id: string | null;
  onClose: () => void;
  onAction: (id: string, action: "pause" | "resume" | "test" | "health", label: string) => void;
  onSync: (id: string, mode: "full" | "incremental") => void;
  busy: string | null;
}) {
  const { data, loading, error } = useAdminResource<ConnectorDetail>(
    id ? `connectors/${id}` : null
  );
  const t = useTranslations("connectors");
  const format = useFormatter();

  const lifecycle = metaFor(LIFECYCLE_META, data?.lifecycle);
  const health = metaFor(HEALTH_META, data?.health);
  const access = metaFor(ACCESS_META, data?.access);
  const compliance = metaFor(COMPLIANCE_META, data?.compliance);

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      width="xl"
      title={data?.label ?? id ?? ""}
      subtitle={data ? `${data.brand}${data.group ? ` · ${data.group}` : ""} · ${data.id}` : undefined}
      footer={
        data && (
          <>
            <Button
              variant="outline"
              size="sm"
              loading={busy === `${data.id}:health`}
              onClick={() => onAction(data.id, "health", t("actionLabels.checkHealth"))}
            >
              <RadioTower className="size-3.5" aria-hidden />
              {t("drawer.checkStatusButton")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={busy === `${data.id}:test`}
              onClick={() => onAction(data.id, "test", t("actionLabels.test"))}
            >
              <FlaskConical className="size-3.5" aria-hidden />
              {t("drawer.testPipelineButton")}
            </Button>
            {data.canSync && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSync(data.id, "incremental")}
                >
                  {t("drawer.syncIncrementalButton")}
                </Button>
                <Button variant="primary" size="sm" onClick={() => onSync(data.id, "full")}>
                  {t("drawer.syncFullButton")}
                </Button>
              </>
            )}
          </>
        )
      }
    >
      <AnimatePresence mode="wait">
        {loading && (
          <motion.p key="loading" className="text-xs text-ink-subtle">
            {t("drawer.loading")}
          </motion.p>
        )}
        {error && !data && (
          <Callout key="error" tone="danger" icon={CircleAlert}>
            {error.message}
          </Callout>
        )}
        {data && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex flex-wrap gap-2">
              <Badge tone={lifecycle.tone} size="md">{lifecycle.label}</Badge>
              <Badge tone={health.tone} size="md" dot>{health.label}</Badge>
              <Badge tone={compliance.tone} size="md">{compliance.label}</Badge>
              {data.paused && <Badge tone="warning" size="md">{t("badges.paused")}</Badge>}
            </div>

            <Callout
              tone={data.canSync ? "info" : "warning"}
              icon={data.canSync ? Info : KeyRound}
              title={data.canSync ? t("drawer.sourceStatusTitle") : t("drawer.missingTitle")}
            >
              {data.note || data.notes}
            </Callout>

            {data.missingEnv.length > 0 && (
              <div>
                <SectionLabel>{t("drawer.missingEnvLabel")}</SectionLabel>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {data.missingEnv.map((key) => (
                    <li
                      key={key}
                      className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1 font-mono text-[11px] text-warning"
                    >
                      {key}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.lastError && (
              <Callout tone="danger" icon={CircleAlert} title={t("drawer.lastErrorTitle")}>
                <span className="block text-[12px]">{data.lastError.message}</span>
                {data.lastError.url && (
                  <span className="mt-1 block font-mono text-[10px] text-ink-faint">
                    {data.lastError.url}
                  </span>
                )}
                <span className="mt-1 block text-[10px] text-ink-faint">
                  {timeAgo(data.lastError.at)}
                </span>
              </Callout>
            )}

            {/* Cómo se está extrayendo de VERDAD en esta fuente. Es la prueba
                de que la IA es un fallback y no la vía por defecto. */}
            <div>
              <SectionLabel>{t("drawer.extractionLabel")}</SectionLabel>
              <div className="mt-2">
                {data.extraction.total === 0 ? (
                  <p className="text-[12px] text-ink-faint">{t("drawer.extractionEmpty")}</p>
                ) : (
                  <>
                    <DataRow label={t("drawer.productsWithMetadata")}>
                      {data.extraction.total}
                    </DataRow>
                    <DataRow label={t("drawer.resolvedWithoutAi")}>
                      {data.extraction.withoutAi} ·{" "}
                      {Math.round((1 - (data.extraction.aiRatio ?? 0)) * 100)}%
                    </DataRow>
                    <DataRow label={t("drawer.resolvedWithAi")}>
                      {data.extraction.withAi} ·{" "}
                      {Math.round((data.extraction.aiRatio ?? 0) * 100)}%
                    </DataRow>
                    <DataRow label={t("drawer.neededBrowser")}>
                      {data.extraction.withBrowser}
                    </DataRow>
                    <DataRow label={t("drawer.avgConfidence")}>
                      {data.extraction.avgConfidence ?? "—"}
                    </DataRow>
                    <DataRow label={t("drawer.estimatedAiCost")} mono>
                      {format.number(data.extraction.aiCostUsd, "usdCost")}
                    </DataRow>
                    <DataRow label={t("drawer.primaryExtractor")} mono>
                      {Object.entries(data.extraction.byPrimaryExtractor)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ") || "—"}
                    </DataRow>
                  </>
                )}
              </div>
            </div>

            <div>
              <SectionLabel>{t("drawer.techSheetLabel")}</SectionLabel>
              <div className="mt-2">
                <DataRow label={t("table.realStatus")}>
                  {metaFor(EFFECTIVE_STATUS_META, data.effectiveStatus).label}
                  <span className="block text-[10px] text-ink-faint">
                    {metaFor(EFFECTIVE_STATUS_META, data.effectiveStatus).description}
                  </span>
                </DataRow>
                <DataRow label={t("drawer.implementation")}>{data.implementation}</DataRow>
                <DataRow label={t("drawer.robotsPolicy")}>
                  {data.robotsPolicy === "respect" ? t("drawer.robotsAlwaysRespected") : data.robotsPolicy}
                  {data.crawlDelaySeconds != null && (
                    <span className="block text-[10px] text-ink-faint">
                      {t("drawer.crawlDelay", { seconds: data.crawlDelaySeconds })}
                    </span>
                  )}
                </DataRow>
                <DataRow label={t("table.discovery")} mono>
                  {data.discoveryKinds.join(", ") || "—"}
                </DataRow>
                <DataRow label={t("drawer.declaredSelectors")} mono>
                  {data.selectorFields.length > 0
                    ? data.selectorFields.join(", ")
                    : t("drawer.none")}
                </DataRow>
                <DataRow label={t("drawer.urlPattern")} mono>
                  {data.allProductUrlPatterns[0] ?? "—"}
                </DataRow>
                <DataRow label={t("drawer.accessMethod")}>
                  {access.label}
                  <span className="block text-[10px] text-ink-faint">{access.description}</span>
                </DataRow>
                <DataRow label={t("drawer.verification")}>
                  {metaFor(VERIFICATION_META, data.verification).label}
                </DataRow>
                <DataRow label={t("drawer.syncModes")}>
                  {data.syncModes.length ? data.syncModes.join(", ") : "—"}
                </DataRow>
                <DataRow label={t("drawer.segments")}>{data.segments.join(", ") || "—"}</DataRow>
                <DataRow label={t("drawer.categories")}>{data.categories.join(", ") || "—"}</DataRow>
                <DataRow label={t("drawer.markets")}>{data.markets.join(", ") || "—"}</DataRow>
                <DataRow label={t("drawer.productsInCatalog")}>
                  {format.number(data.productCount)}
                </DataRow>
                <DataRow label={t("table.lastSync")}>{timeAgo(data.lastSyncAt)}</DataRow>
                <DataRow label={t("drawer.healthCheckedAt")}>
                  {timeAgo(data.healthCheckedAt)}
                </DataRow>
                <DataRow label={t("drawer.store")} mono>
                  <a
                    href={data.homeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-brand-bright hover:underline"
                  >
                    {new URL(data.homeUrl).host}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </DataRow>
                {data.docsUrl && (
                  <DataRow label={t("drawer.program")} mono>
                    <a
                      href={data.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-brand-bright hover:underline"
                    >
                      {new URL(data.docsUrl).host}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  </DataRow>
                )}
              </div>
            </div>

            {data.sitemapUrls.length > 0 && (
              <div>
                <SectionLabel>{t("drawer.sitemapsLabel")}</SectionLabel>
                <ul className="mt-2 space-y-1">
                  {data.sitemapUrls.map((url) => (
                    <li key={url} className="truncate font-mono text-[11px] text-ink-subtle">
                      {url}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-ink-faint">{t("drawer.sitemapsHint")}</p>
              </div>
            )}

            <div>
              <SectionLabel>{t("drawer.recentJobsLabel")}</SectionLabel>
              {data.recentJobs.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {data.recentJobs.map((job) => {
                    const meta = metaFor(JOB_META, job.status);
                    return (
                      <li
                        key={job.jobId}
                        className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-[12px] text-ink">
                            {JOB_TYPE_LABEL[job.type] ?? job.type}
                          </p>
                          <p className="font-mono text-[10px] text-ink-faint">
                            {job.progress.new}n · {job.progress.updated}u ·{" "}
                            {job.progress.errors}e · {formatDuration(job.durationMs)}
                          </p>
                        </div>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-ink-subtle">{t("drawer.noJobs")}</p>
              )}
            </div>

            <div>
              <SectionLabel>{t("drawer.logsLabel")}</SectionLabel>
              {data.logs.length > 0 ? (
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-ink-muted">
                  {data.logs
                    .map(
                      (l) =>
                        `${format.dateTime(new Date(l.ts), "time")} [${l.level}] ${l.msg}` +
                        (Object.keys(l.context).length
                          ? ` ${JSON.stringify(l.context)}`
                          : "")
                    )
                    .join("\n")}
                </pre>
              ) : (
                <p className="mt-2 text-xs text-ink-subtle">{t("drawer.noLogs")}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Drawer>
  );
}
