"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Binary,
  Boxes,
  CircleAlert,
  Clock,
  Copy,
  Gauge,
  ListChecks,
  Plug,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Progress,
  SectionLabel,
  StatCard,
} from "@/components/ui";
import { useAdminResource } from "@/lib/admin/client";
import {
  JOB_META,
  JOB_TYPE_LABEL,
  LIFECYCLE_META,
  formatDuration,
  metaFor,
  timeAgo,
} from "@/lib/admin/status";
import type { Overview } from "@/lib/catalogService/types";
import { cn } from "@/lib/ui/cn";

/**
 * Resumen de operaciones. Una sola llamada (`/overview`) alimenta toda la
 * pantalla, con refresco cada 10 s que NO vacía los datos ya pintados.
 */

const POLL_MS = 10_000;

export function OverviewView() {
  const t = useTranslations("overview");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const { data, error, loading, refreshing, lastUpdatedAt, reload } =
    useAdminResource<Overview>("overview", { pollMs: POLL_MS });

  if (error && !data) {
    return (
      <Card>
        <EmptyState
          icon={CircleAlert}
          title={t("errorState.title")}
          description={t.rich("errorState.description", {
            message: error.message,
            code: (chunks) => (
              <code className="font-mono text-[11px]">{chunks}</code>
            ),
          })}
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              <RefreshCw className="size-3.5" aria-hidden />
              {tCommon("retry")}
            </Button>
          }
        />
      </Card>
    );
  }

  const catalog = data?.catalog;
  const connectors = data?.connectors;
  const queue = data?.queue;

  const errorRate = data?.errorRate ?? 0;
  const errorTone = errorRate > 25 ? "danger" : errorRate > 5 ? "warning" : "success";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>{t("sectionLabel.status")}</SectionLabel>
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          {refreshing && <RefreshCw className="size-3 animate-spin" aria-hidden />}
          {lastUpdatedAt
            ? t("status.updated", { time: format.dateTime(lastUpdatedAt, "time") })
            : t("status.loading")}
        </span>
      </div>

      {/* ------------------------- métricas ------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("kpi.products")}
          value={format.number(catalog?.totalProducts ?? 0)}
          hint={t("kpi.productsHint", {
            active: format.number(catalog?.activeProducts ?? 0),
            withImages: format.number(catalog?.withImages ?? 0),
          })}
          icon={Boxes}
          tone="brand"
          loading={loading}
        />
        <StatCard
          label={t("kpi.connectors")}
          value={connectors?.total ?? 0}
          hint={t("kpi.connectorsHint", {
            syncable: connectors?.syncable ?? 0,
            paused: connectors?.paused ?? 0,
          })}
          icon={Plug}
          tone="accent"
          loading={loading}
        />
        <StatCard
          label={t("kpi.throughput")}
          value={t("kpi.throughputValue", { perMinute: format.number(data?.throughput.perMinute ?? 0) })}
          hint={t("kpi.throughputHint", {
            products: format.number(data?.throughput.products ?? 0),
            minutes: data?.throughput.windowMinutes ?? 15,
          })}
          icon={Gauge}
          loading={loading}
        />
        <StatCard
          label={t("kpi.errorRate")}
          value={`${format.number(errorRate)}%`}
          hint={t("kpi.errorRateHint")}
          icon={errorRate > 5 ? TriangleAlert : ShieldCheck}
          tone={errorTone}
          loading={loading}
        />
      </div>

      {/* Aviso honesto sobre el backend degradado. */}
      {data?.backend === "file" && (
        <Callout tone="warning" icon={AlertTriangle} title={t("degraded.title")}>
          {t.rich("degraded.body", {
            code: (chunks) => <code className="font-mono text-[11px]">{chunks}</code>,
          })}
        </Callout>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        {/* ------------------------- embeddings + cola ------------------------- */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              actions={
                <Badge tone={data?.embeddings.provider === "local" ? "success" : "muted"}>
                  {data?.embeddings.provider ?? "—"}
                </Badge>
              }
            >
              <CardTitle>{t("embeddings.title")}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-2xl font-semibold text-ink tabular-nums">
                    {format.number(data?.embeddings.coverage ?? 0)}%
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">
                    {t("embeddings.indexedOf", {
                      indexed: format.number(catalog?.withEmbeddings ?? 0),
                      total: format.number(catalog?.totalProducts ?? 0),
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[11px] text-ink-muted">
                    {data?.embeddings.model ?? "—"}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {t("embeddings.dimensions", { count: data?.embeddings.dimension ?? 0 })}
                  </p>
                </div>
              </div>
              <Progress
                value={data?.embeddings.coverage ?? 0}
                tone={(data?.embeddings.coverage ?? 0) > 90 ? "success" : "brand"}
                label={t("embeddings.coverageLabel")}
              />
              {data?.embeddings.provider === "hash" && (
                <p className="text-[11px] leading-relaxed text-ink-faint">
                  {t.rich("embeddings.hashNote", {
                    code: (chunks) => <code className="font-mono">{chunks}</code>,
                  })}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              actions={
                <Link
                  href="/admin/jobs"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted transition-colors hover:text-brand-bright"
                >
                  {t("queue.viewAll")}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              }
            >
              <CardTitle>{t("queue.title")}</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(queue?.byStatus ?? {}).length === 0 ? (
                  <p className="text-xs text-ink-subtle">{t("queue.noJobsYet")}</p>
                ) : (
                  Object.entries(queue?.byStatus ?? {}).map(([status, count]) => {
                    const meta = metaFor(JOB_META, status);
                    return (
                      <Badge key={status} tone={meta.tone} size="md" dot>
                        {meta.label} · {count}
                      </Badge>
                    );
                  })
                )}
              </div>

              {(queue?.recent.length ?? 0) > 0 ? (
                <ul className="space-y-2">
                  {queue!.recent.slice(0, 5).map((job) => {
                    const meta = metaFor(JOB_META, job.status);
                    return (
                      <li
                        key={job.jobId}
                        className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-medium text-ink">
                            {JOB_TYPE_LABEL[job.type] ?? job.type}
                            {job.source && (
                              <span className="text-ink-subtle"> · {job.source}</span>
                            )}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
                            {t("queue.progressLine", {
                              new: job.progress.new,
                              updated: job.progress.updated,
                              duplicates: job.progress.duplicates,
                              errors: job.progress.errors,
                            })}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-[10px] text-ink-faint tabular-nums">
                            {formatDuration(job.durationMs)}
                          </span>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  icon={ListChecks}
                  title={t("queue.emptyTitle")}
                  description={t("queue.emptyDescription")}
                  action={
                    <Link
                      href="/admin/connectors"
                      className="text-[11px] font-medium text-brand-bright hover:underline"
                    >
                      {t("queue.goToConnectors")}
                    </Link>
                  }
                />
              )}
            </CardBody>
          </Card>
        </div>

        {/* ------------------------- registro + logs ------------------------- */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("registry.title")}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {Object.entries(connectors?.byLifecycle ?? {})
                .sort((a, b) => b[1] - a[1])
                .map(([lifecycle, count]) => {
                  const meta = metaFor(LIFECYCLE_META, lifecycle);
                  const pct = connectors?.total ? (count / connectors.total) * 100 : 0;
                  return (
                    <div key={lifecycle}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-[12px] text-ink-muted">{meta.label}</span>
                        <span className="text-[11px] text-ink-faint tabular-nums">
                          {count} · {Math.round(pct)}%
                        </span>
                      </div>
                      <Progress
                        value={pct}
                        tone={
                          meta.tone === "success"
                            ? "success"
                            : meta.tone === "warning"
                              ? "warning"
                              : "brand"
                        }
                      />
                    </div>
                  );
                })}
              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-[11px] text-ink-subtle">{t("registry.lastSync")}</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-ink">
                  <Clock className="size-3 text-ink-faint" aria-hidden />
                  {timeAgo(connectors?.lastSyncAt)}
                </span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              actions={
                <Link
                  href="/admin/logs"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-muted transition-colors hover:text-brand-bright"
                >
                  {t("logs.viewAll")}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              }
            >
              <CardTitle>{t("recentActivity")}</CardTitle>
            </CardHeader>
            <CardBody>
              {(data?.logs.recent.length ?? 0) > 0 ? (
                <ul className="space-y-2">
                  {data!.logs.recent.slice(0, 6).map((entry) => (
                    <motion.li
                      key={entry.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-2.5"
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          entry.level === "error"
                            ? "bg-danger"
                            : entry.level === "warn"
                              ? "bg-warning"
                              : "bg-ink-faint"
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-ink-muted">{entry.msg}</p>
                        <p className="font-mono text-[10px] text-ink-faint">
                          {format.dateTime(new Date(entry.ts), "time")}
                          {typeof entry.context.connector === "string" &&
                            ` · ${entry.context.connector}`}
                        </p>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={ScrollText}
                  title={t("logs.emptyTitle")}
                  description={t("logs.emptyDescription")}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted">
                  <Copy className="size-3.5 text-ink-faint" aria-hidden />
                  {t("misc.duplicatesDetected")}
                </span>
                <span className="text-[13px] font-semibold text-ink tabular-nums">
                  {format.number(catalog?.duplicatesDetected ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted">
                  <Binary className="size-3.5 text-ink-faint" aria-hidden />
                  {t("misc.externalOrigin")}
                </span>
                <span className="text-[13px] font-semibold text-ink tabular-nums">
                  {format.number(catalog?.byOrigin.externally_discovered ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted">
                  <Activity className="size-3.5 text-ink-faint" aria-hidden />
                  {t("misc.serviceUptime")}
                </span>
                <span className="text-[13px] font-semibold text-ink tabular-nums">
                  {formatDuration((data?.uptimeSeconds ?? 0) * 1000)}
                </span>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
