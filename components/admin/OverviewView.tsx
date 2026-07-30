"use client";

import Link from "next/link";
import { motion } from "motion/react";
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
  const { data, error, loading, refreshing, lastUpdatedAt, reload } =
    useAdminResource<Overview>("overview", { pollMs: POLL_MS });

  if (error && !data) {
    return (
      <Card>
        <EmptyState
          icon={CircleAlert}
          title="No se puede leer el servicio de catálogo"
          description={
            <>
              {error.message}. El motor de catálogo corre integrado en esta misma app: revisa
              que <code className="font-mono text-[11px]">DATABASE_URL</code> apunte a un
              Postgres válido y que las migraciones estén aplicadas (
              <code className="font-mono text-[11px]">npm run db:migrate</code>).
            </>
          }
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              <RefreshCw className="size-3.5" aria-hidden />
              Reintentar
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
        <SectionLabel>Estado general</SectionLabel>
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          {refreshing && <RefreshCw className="size-3 animate-spin" aria-hidden />}
          {lastUpdatedAt
            ? `actualizado ${lastUpdatedAt.toLocaleTimeString("es-ES")}`
            : "cargando…"}
        </span>
      </div>

      {/* ------------------------- métricas ------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Productos"
          value={(catalog?.totalProducts ?? 0).toLocaleString("es-ES")}
          hint={`${(catalog?.activeProducts ?? 0).toLocaleString("es-ES")} activos · ${(
            catalog?.withImages ?? 0
          ).toLocaleString("es-ES")} con imagen`}
          icon={Boxes}
          tone="brand"
          loading={loading}
        />
        <StatCard
          label="Conectores"
          value={connectors?.total ?? 0}
          hint={`${connectors?.syncable ?? 0} sincronizables · ${
            connectors?.paused ?? 0
          } pausados`}
          icon={Plug}
          tone="accent"
          loading={loading}
        />
        <StatCard
          label="Throughput"
          value={`${data?.throughput.perMinute ?? 0}/min`}
          hint={`${data?.throughput.products ?? 0} productos nuevos en ${
            data?.throughput.windowMinutes ?? 15
          } min`}
          icon={Gauge}
          loading={loading}
        />
        <StatCard
          label="Tasa de error"
          value={`${errorRate}%`}
          hint="fetches fallidos sobre intentos, en los jobs recientes"
          icon={errorRate > 5 ? TriangleAlert : ShieldCheck}
          tone={errorTone}
          loading={loading}
        />
      </div>

      {/* Aviso honesto sobre el backend degradado. */}
      {data?.backend === "file" && (
        <Callout tone="warning" icon={AlertTriangle} title="Persistencia en modo degradado">
          El servicio usa el store en fichero porque no hay una{" "}
          <code className="font-mono text-[11px]">DATABASE_URL</code> Postgres válida. Todo
          funciona, pero sin pgvector la búsqueda vectorial se hace en memoria y no escala.
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
              <CardTitle>Embeddings</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-2xl font-semibold text-ink tabular-nums">
                    {data?.embeddings.coverage ?? 0}%
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">
                    {(catalog?.withEmbeddings ?? 0).toLocaleString("es-ES")} de{" "}
                    {(catalog?.totalProducts ?? 0).toLocaleString("es-ES")} productos
                    indexados
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[11px] text-ink-muted">
                    {data?.embeddings.model ?? "—"}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {data?.embeddings.dimension ?? 0} dimensiones
                  </p>
                </div>
              </div>
              <Progress
                value={data?.embeddings.coverage ?? 0}
                tone={(data?.embeddings.coverage ?? 0) > 90 ? "success" : "brand"}
                label="Cobertura de embeddings"
              />
              {data?.embeddings.provider === "hash" && (
                <p className="text-[11px] leading-relaxed text-ink-faint">
                  Proveedor <code className="font-mono">hash</code>: vectores deterministas de
                  64 dimensiones, válidos para demo y tests pero no para similitud visual real.
                  Instala el proveedor local (CLIP) y reindexa para producción.
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
                  Ver todos
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              }
            >
              <CardTitle>Cola de ingesta</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(queue?.byStatus ?? {}).length === 0 ? (
                  <p className="text-xs text-ink-subtle">Todavía no se ha ejecutado ningún job.</p>
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
                            {job.progress.new} nuevos · {job.progress.updated} act. ·{" "}
                            {job.progress.duplicates} dup · {job.progress.errors} err
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
                  title="Sin jobs todavía"
                  description="Lanza un sync desde Conectores para llenar el catálogo."
                  action={
                    <Link
                      href="/admin/connectors"
                      className="text-[11px] font-medium text-brand-bright hover:underline"
                    >
                      Ir a conectores →
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
              <CardTitle>Madurez del registro de fuentes</CardTitle>
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
                <span className="text-[11px] text-ink-subtle">Último sync</span>
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
                  Ver logs
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              }
            >
              <CardTitle>Actividad reciente</CardTitle>
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
                          {new Date(entry.ts).toLocaleTimeString("es-ES")}
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
                  title="Sin actividad registrada"
                  description="El buffer de logs se llena cuando el servicio empieza a trabajar."
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted">
                  <Copy className="size-3.5 text-ink-faint" aria-hidden />
                  Duplicados detectados
                </span>
                <span className="text-[13px] font-semibold text-ink tabular-nums">
                  {(catalog?.duplicatesDetected ?? 0).toLocaleString("es-ES")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted">
                  <Binary className="size-3.5 text-ink-faint" aria-hidden />
                  Origen externo
                </span>
                <span className="text-[13px] font-semibold text-ink tabular-nums">
                  {(catalog?.byOrigin.externally_discovered ?? 0).toLocaleString("es-ES")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted">
                  <Activity className="size-3.5 text-ink-faint" aria-hidden />
                  Uptime del servicio
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
