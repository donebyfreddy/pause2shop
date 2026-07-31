"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  CircleAlert,
  Info,
  Pause,
  Play,
  RefreshCw,
  ScrollText,
  TriangleAlert,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
} from "@/components/ui";
import { useAdminResource } from "@/lib/admin/client";
import type {
  ConnectorsResponse,
  LogEntry,
  LogsResponse,
  ScraperStatus,
} from "@/lib/catalogService/types";
import { cn } from "@/lib/ui/cn";
import { ConsoleTransportNote, ScraperConsole } from "./ScraperConsole";

/**
 * Monitorización. Lee el buffer circular del servicio y es explícita sobre lo
 * que ese buffer ES: una ventana de diagnóstico en memoria, no un sistema de
 * logs. Prometer retención que no existe sería el peor tipo de "panel bonito".
 */

const POLL_MS = 4000;

const LEVEL_VALUES = ["all", "info", "warn", "error"] as const;

type LevelFilter = (typeof LEVEL_VALUES)[number];

const LEVEL_DOT_STYLES: Record<LogEntry["level"], { dot: string; text: string }> = {
  debug: { dot: "bg-ink-faint", text: "text-ink-faint" },
  info: { dot: "bg-info", text: "text-info" },
  warn: { dot: "bg-warning", text: "text-warning" },
  error: { dot: "bg-danger", text: "text-danger" },
};

/**
 * Dos vistas distintas, porque son dos cosas distintas:
 *
 *  - «Ingesta» — el pipeline del scraper etapa por etapa, persistido y con
 *    detalle por ficha. Es lo que se mira cuando un sync va mal.
 *  - «Proceso» — el buffer circular en memoria del servicio entero. Diagnóstico
 *    general, sin retención.
 */
const VIEW_VALUES = ["ingest", "process"] as const;

export function LogsView() {
  const t = useTranslations("logs");
  const [view, setView] = useState<"ingest" | "process">("ingest");
  const scraper = useAdminResource<ScraperStatus>("scraper/status", { pollMs: 15000 });
  const connectorsForConsole = useAdminResource<ConnectorsResponse>("connectors");

  const views = useMemo(
    () => VIEW_VALUES.map((value) => ({ value, label: t(`views.${value}`) })),
    [t]
  );

  return (
    <div className="space-y-5">
      <Segmented
        ariaLabel={t("ariaLabels.logType")}
        value={view}
        onChange={setView}
        options={views}
      />
      {view === "ingest" ? (
        <div className="space-y-5">
          <ScraperStatusPanel status={scraper.data} />
          <ConsoleTransportNote
            persistent={scraper.data?.persistence.jobLogsPersistent ?? false}
          />
          <ScraperConsole
            connectorIds={(connectorsForConsole.data?.connectors ?? [])
              .filter((c) => c.canSync)
              .map((c) => c.id)}
          />
        </div>
      ) : (
        <ProcessLogsView />
      )}
    </div>
  );
}

/**
 * Estado real del subsistema: qué está disponible y, si no lo está, POR QUÉ.
 * Un panel que dijera solo "IA: no" obligaría a ir al servidor a averiguarlo.
 */
function ScraperStatusPanel({ status }: { status: ScraperStatus | null }) {
  const t = useTranslations("logs");
  if (!status) {
    return <Skeleton className="h-24" />;
  }
  const openCircuits = status.browser.circuits.filter((c) => c.open);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile
          label={t("status.aiExtractor")}
          value={status.ai.enabled ? status.ai.model : t("status.disabled")}
          tone={status.ai.enabled ? "success" : "muted"}
          detail={
            status.ai.unavailableReason ??
            t("status.aiDetailFallback", {
              cache: status.ai.cachePersistent
                ? t("status.cachePersistent")
                : t("status.cacheInMemory"),
            })
          }
        />
        <StatusTile
          label={t("status.browser")}
          value={
            status.browser.enabled
              ? status.browser.connected
                ? t("status.connected")
                : t("status.available")
              : t("status.disabled")
          }
          tone={
            status.browser.enabled && !status.browser.unavailableReason ? "success" : "muted"
          }
          detail={
            status.browser.unavailableReason ??
            t("status.browserDetail", {
              contexts: status.browser.contexts,
              pages: status.browser.openPages,
            })
          }
        />
        <StatusTile
          label={t("status.catalog")}
          value={status.persistence.catalogBackend}
          tone={status.persistence.productionGrade ? "success" : "warning"}
          detail={
            status.persistence.productionGrade
              ? t("status.productionPersistence")
              : t("status.fileStoreWarning")
          }
        />
        <StatusTile
          label="robots.txt"
          value={t("status.respected")}
          tone="success"
          detail={t("status.rateLimitDetail", {
            delay: status.limits.requestDelayMs,
            concurrency: status.limits.maxConcurrency,
          })}
        />
      </div>

      {openCircuits.length > 0 && (
        <Callout tone="danger" icon={TriangleAlert} title={t("status.circuitBreakersOpen")}>
          {openCircuits.map((c) => (
            <span key={c.host} className="block font-mono text-[11px]">
              {c.host}: {c.lastError}
            </span>
          ))}
        </Callout>
      )}

      {status.warnings.length > 0 && (
        <Callout tone="warning" icon={TriangleAlert} title={t("status.subsystemWarnings")}>
          <ul className="list-disc space-y-1 pl-4">
            {status.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}
    </div>
  );
}

function StatusTile({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "muted";
  detail: string;
}) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
        {label}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <Badge tone={tone}>{value}</Badge>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-ink-subtle">{detail}</p>
    </div>
  );
}

function ProcessLogsView() {
  const t = useTranslations("logs");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("actions");
  const format = useFormatter();
  const [level, setLevel] = useState<LevelFilter>("all");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);

  const params = new URLSearchParams({ limit: "200" });
  if (level !== "all") params.set("level", level);
  if (source !== "all") params.set("source", source);
  if (query.trim()) params.set("q", query.trim());

  const { data, error, loading, refreshing, reload } = useAdminResource<LogsResponse>(
    `logs?${params.toString()}`,
    { pollMs: paused ? undefined : POLL_MS }
  );
  const connectors = useAdminResource<ConnectorsResponse>("connectors");

  const counts = data?.counts;
  const sourcesWithLogs = useMemo(
    () => (connectors.data?.connectors ?? []).map((c) => c.id),
    [connectors.data]
  );

  const levelFilterOptions = useMemo(
    () => [
      { value: "all" as const, label: t("filters.all") },
      { value: "info" as const, label: t("filters.infoPlus") },
      { value: "warn" as const, label: t("filters.warnPlus") },
      { value: "error" as const, label: t("filters.errors") },
    ],
    [t]
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        {(["error", "warn", "info", "debug"] as const).map((lvl) => (
          <div key={lvl} className="panel px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
                {t(`level.${lvl}`)}
              </p>
              <span className={cn("size-1.5 rounded-full", LEVEL_DOT_STYLES[lvl].dot)} />
            </div>
            <p className="mt-1.5 text-xl font-semibold text-ink tabular-nums">
              {counts?.[lvl] ?? 0}
            </p>
          </div>
        ))}
      </div>

      <Callout tone="info" icon={Info} title={t("about.title")}>
        {data?.retention ?? t("about.defaultRetention")} {t("about.minLevelLabel")}{" "}
        <code className="font-mono text-[11px]">{data?.minLevelEmitted ?? "info"}</code>{" "}
        {t("about.configuredVia")} <code className="font-mono text-[11px]">LOG_LEVEL</code>
        {t("about.stdoutNote")}
      </Callout>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          placeholder={t("filters.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-56 flex-1"
        />
        <Segmented
          size="sm"
          ariaLabel={t("ariaLabels.minLevel")}
          value={level}
          onChange={setLevel}
          options={levelFilterOptions}
        />
        <Select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-auto min-w-40"
          aria-label={t("filters.sourceLabel")}
        >
          <option value="all">{t("filters.allSources")}</option>
          {sourcesWithLogs.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </Select>
        <Button
          variant={paused ? "warning" : "outline"}
          size="sm"
          onClick={() => setPaused((v) => !v)}
        >
          {paused ? (
            <>
              <Play className="size-3.5" aria-hidden />
              {tActions("resume")}
            </>
          ) : (
            <>
              <Pause className="size-3.5" aria-hidden />
              {t("actions.pauseStream")}
            </>
          )}
        </Button>
        <Button variant="ghost" size="sm" icon onClick={reload} aria-label={t("ariaLabels.refresh")}>
          <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} aria-hidden />
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <p className="font-mono text-[11px] text-ink-subtle">
            {t("table.eventsCount", { count: data?.logs.length ?? 0 })}
          </p>
          {!paused && (
            <Badge tone="success" dot pulse>
              {t("table.live")}
            </Badge>
          )}
        </div>

        <div className="max-h-[62vh] overflow-y-auto">
          {loading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${90 - i * 4}%` }} />
              ))}
            </div>
          )}

          {!loading && error && (
            <EmptyState
              icon={CircleAlert}
              title={t("empty.errorTitle")}
              description={error.message}
              action={
                <Button variant="secondary" size="sm" onClick={reload}>
                  {tCommon("retry")}
                </Button>
              }
            />
          )}

          {!loading && !error && (data?.logs.length ?? 0) === 0 && (
            <EmptyState
              icon={ScrollText}
              title={t("empty.noEventsTitle")}
              description={t("empty.noEventsDescription")}
            />
          )}

          <ul className="divide-y divide-line/60">
            <AnimatePresence initial={false}>
              {(data?.logs ?? []).map((entry) => {
                const style = LEVEL_DOT_STYLES[entry.level];
                const contextKeys = Object.keys(entry.context);
                return (
                  <motion.li
                    key={entry.id}
                    initial={{ opacity: 0, backgroundColor: "rgba(109,94,252,0.08)" }}
                    animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
                    transition={{ duration: 0.8 }}
                    className="px-4 py-2.5"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-1 flex shrink-0 items-center gap-2">
                        <span className={cn("size-1.5 rounded-full", style.dot)} />
                        <span className="font-mono text-[10px] text-ink-faint">
                          {format.dateTime(new Date(entry.ts), "time")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "w-12 shrink-0 font-mono text-[10px] font-semibold uppercase",
                          style.text
                        )}
                      >
                        {t(`level.${entry.level}`)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] break-words text-ink-muted">
                          {entry.level === "error" && (
                            <TriangleAlert
                              className="mr-1.5 inline size-3 text-danger"
                              aria-hidden
                            />
                          )}
                          {entry.msg}
                        </p>
                        {contextKeys.length > 0 && (
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-faint">
                            {contextKeys.map((key) => (
                              <span key={key}>
                                {key}=
                                <span className="text-ink-subtle">
                                  {typeof entry.context[key] === "object"
                                    ? JSON.stringify(entry.context[key])
                                    : String(entry.context[key])}
                                </span>
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      </Card>
    </div>
  );
}
