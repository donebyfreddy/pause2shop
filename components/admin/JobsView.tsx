"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Ban,
  ChevronDown,
  CircleAlert,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Progress,
  Segmented,
  Select,
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
import { JOB_META, JOB_TYPE_LABEL, formatDuration, metaFor, timeAgo } from "@/lib/admin/status";
import type { ConnectorsResponse, JobRecord } from "@/lib/catalogService/types";
import { cn } from "@/lib/ui/cn";
import { ScraperConsole } from "./ScraperConsole";

/**
 * Jobs de ingesta. La tabla desglosa el progreso real que persiste el servicio
 * (descubiertos / descargados / nuevos / actualizados / duplicados / errores) y
 * permite cancelar y reintentar desde el checkpoint.
 */

const POLL_MS = 5000;

const STATUS_FILTERS = [
  { value: "all" as const, label: "Todos" },
  { value: "running" as const, label: "En curso" },
  { value: "completed" as const, label: "Completados" },
  { value: "failed" as const, label: "Con fallo" },
];

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

export function JobsView() {
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, refreshing, reload } = useAdminResource<{
    jobs: JobRecord[];
    total: number;
  }>("jobs?limit=60", { pollMs: POLL_MS });

  const connectorsRes = useAdminResource<ConnectorsResponse>("connectors");
  const syncable = connectorsRes.data?.syncable ?? [];

  const jobs = useMemo(() => {
    const all = data?.jobs ?? [];
    return all.filter((job) => {
      if (source !== "all" && job.source !== source) return false;
      if (status === "all") return true;
      if (status === "failed") {
        return ["failed", "partially_completed", "cancelled"].includes(job.status);
      }
      if (status === "running") return ["running", "queued"].includes(job.status);
      return job.status === status;
    });
  }, [data?.jobs, status, source]);

  const act = async (jobId: string, action: "cancel" | "retry") => {
    setBusy(`${jobId}:${action}`);
    const res = await adminPost<{ jobId: string }>(`jobs/${jobId}/${action}`);
    setBusy(null);
    if (!res.ok) {
      toast.error(action === "cancel" ? "No se pudo cancelar" : "No se pudo reintentar", res.error.message);
      return;
    }
    toast.success(
      action === "cancel" ? "Cancelación solicitada" : "Reintento encolado",
      action === "retry"
        ? `Nuevo job ${res.data.jobId.slice(0, 8)} — reanuda desde el checkpoint`
        : undefined
    );
    reload();
  };

  const reindex = async () => {
    setBusy("reindex");
    const res = await adminPost<{ jobId: string }>("products/reindex");
    setBusy(null);
    if (!res.ok) {
      toast.error("No se pudo lanzar el reindexado", res.error.message);
      return;
    }
    toast.success("Reindexado de embeddings encolado", `Job ${res.data.jobId.slice(0, 8)}`);
    reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          ariaLabel="Filtrar por estado"
          value={status}
          onChange={setStatus}
          options={STATUS_FILTERS}
        />
        <Select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-auto min-w-44"
          aria-label="Filtrar por fuente"
        >
          <option value="all">Todas las fuentes</option>
          {syncable.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" loading={busy === "reindex"} onClick={reindex}>
            <Sparkles className="size-3.5" aria-hidden />
            Reindexar embeddings
          </Button>
          <Button variant="ghost" size="sm" icon onClick={reload} aria-label="Refrescar">
            <RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} aria-hidden />
          </Button>
        </div>
      </div>

      <Callout tone="info">
        Los jobs persisten su checkpoint en cada avance: un job cancelado o caído se reanuda con{" "}
        <span className="text-ink">Reintentar</span> sin volver a descubrir el catálogo.
      </Callout>

      <Card className="overflow-hidden">
        <TableWrap className="max-h-[66vh] overflow-y-auto">
          <Table className="min-w-[1000px]">
            <THead>
              <TR>
                <TH>Job</TH>
                <TH>Tipo</TH>
                <TH>Estado</TH>
                <TH className="w-56">Progreso</TH>
                <TH>Duración</TH>
                <TH>Inicio</TH>
                <TH className="text-right">Acciones</TH>
              </TR>
            </THead>
            <TBody>
              {loading && <SkeletonRows rows={6} cols={7} />}

              {!loading && error && (
                <TableEmpty colSpan={7}>
                  <EmptyState
                    icon={CircleAlert}
                    title="No se pudieron leer los jobs"
                    description={error.message}
                    action={
                      <Button variant="secondary" size="sm" onClick={reload}>
                        Reintentar
                      </Button>
                    }
                  />
                </TableEmpty>
              )}

              {!loading && !error && jobs.length === 0 && (
                <TableEmpty colSpan={7}>
                  <EmptyState
                    icon={ListChecks}
                    title="Ningún job con estos filtros"
                    description="Lanza un sync desde Conectores o cambia el filtro de estado."
                  />
                </TableEmpty>
              )}

              {!loading &&
                jobs.map((job) => (
                  <JobRow
                    key={job.jobId}
                    job={job}
                    expanded={expanded === job.jobId}
                    onToggle={() => setExpanded(expanded === job.jobId ? null : job.jobId)}
                    busy={busy}
                    onAct={act}
                  />
                ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}

function JobRow({
  job,
  expanded,
  onToggle,
  busy,
  onAct,
}: {
  job: JobRecord;
  expanded: boolean;
  onToggle: () => void;
  busy: string | null;
  onAct: (jobId: string, action: "cancel" | "retry") => void;
}) {
  const meta = metaFor(JOB_META, job.status);
  const p = job.progress;
  // `processed`, `percent` y `productsPerMinute` los calcula el servidor: si la
  // aritmética viviera también aquí, las dos copias acabarían discrepando.
  const processed = job.processed;
  const pct = job.percent ?? 0;
  const cancellable = job.status === "queued" || job.isActive;
  const retryable = ["failed", "partially_completed", "cancelled"].includes(job.status);

  return (
    <>
      <TR interactive onClick={onToggle}>
        <TD>
          <div className="flex items-center gap-2">
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-ink-faint transition-transform",
                expanded && "rotate-180"
              )}
              aria-hidden
            />
            <span className="font-mono text-[11px] text-ink-muted">
              {job.jobId.slice(0, 8)}
            </span>
          </div>
        </TD>
        <TD>
          <p className="text-[12px] text-ink">{JOB_TYPE_LABEL[job.type] ?? job.type}</p>
          {job.source && (
            <p className="text-[10px] text-ink-faint">
              {job.source}
              {job.mode ? ` · ${job.mode}` : ""}
            </p>
          )}
        </TD>
        <TD>
          <Badge tone={meta.tone} dot pulse={job.status === "running"}>
            {meta.label}
          </Badge>
        </TD>
        <TD>
          <div className="space-y-1.5">
            <Progress
              value={pct}
              tone={p.errors > 0 ? "warning" : job.status === "completed" ? "success" : "brand"}
            />
            <p className="font-mono text-[10px] whitespace-nowrap text-ink-faint">
              {processed}/{p.discovered} · {p.new}n {p.updated}u {p.duplicates}d{" "}
              <span className={p.errors > 0 ? "text-danger" : ""}>{p.errors}e</span>
              {job.productsPerMinute != null && job.productsPerMinute > 0 && (
                <span className="ml-1.5">· {job.productsPerMinute}/min</span>
              )}
            </p>
          </div>
        </TD>
        <TD className="text-[11px] tabular-nums">{formatDuration(job.durationMs)}</TD>
        <TD className="text-[11px] whitespace-nowrap">{timeAgo(job.startedAt)}</TD>
        <TD onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            {cancellable && (
              <Button
                variant="ghost"
                size="xs"
                loading={busy === `${job.jobId}:cancel`}
                onClick={() => onAct(job.jobId, "cancel")}
              >
                <Ban className="size-3.5" aria-hidden />
                Cancelar
              </Button>
            )}
            {retryable && (
              <Button
                variant="outline"
                size="xs"
                loading={busy === `${job.jobId}:retry`}
                onClick={() => onAct(job.jobId, "retry")}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Reintentar
              </Button>
            )}
          </div>
        </TD>
      </TR>

      <AnimatePresence initial={false}>
        {expanded && (
          <tr>
            <td colSpan={7} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="overflow-hidden border-b border-line bg-black/25"
              >
                <div className="grid gap-5 px-5 py-4 lg:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
                      Desglose
                    </p>
                    <dl className="mt-2 grid grid-cols-3 gap-2">
                      {(
                        [
                          ["Descubiertos", job.progress.discovered],
                          ["Descargados", job.progress.fetched],
                          ["Nuevos", job.progress.new],
                          ["Actualizados", job.progress.updated],
                          ["Duplicados", job.progress.duplicates],
                          ["Ignorados", job.progress.ignored],
                          ["Errores", job.progress.errors],
                          ["Sin IA", job.progress.withoutAi],
                          ["Con IA", job.progress.withAi],
                          ["Con navegador", job.progress.withBrowser],
                          ["Reintentos", job.progress.retries],
                        ] as const
                      ).map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-lg border border-line bg-white/[0.02] px-2.5 py-2"
                        >
                          <dt className="text-[10px] text-ink-faint">{label}</dt>
                          <dd className="text-[13px] font-semibold text-ink tabular-nums">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-2.5 font-mono text-[10px] text-ink-faint">
                      coste de IA estimado: {job.progress.aiCostUsd.toFixed(6)} USD ·{" "}
                      {job.progress.aiTokens.toLocaleString("es-ES")} tokens
                      {job.aiRatio != null && ` · ${Math.round(job.aiRatio * 100)}% de fichas con IA`}
                    </p>
                    {job.resumeIndex != null && (
                      <p className="mt-1 font-mono text-[10px] text-ink-faint">
                        {/* El checkpoint es lo que hace el job reanudable: se muestra
                            para que el operador sepa qué pasaría al reintentar. */}
                        checkpoint: reanudaría en el índice {job.resumeIndex}
                        {Array.isArray(job.checkpoint.urls) &&
                          ` de ${(job.checkpoint.urls as unknown[]).length} URLs`}
                        {job.stage ? ` · etapa ${job.stage}` : ""}
                      </p>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
                      Errores ({job.errors.length})
                    </p>
                    {job.errors.length > 0 ? (
                      <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-line bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-ink-muted">
                        {job.errors
                          .slice(-12)
                          .map((e) => `${e.url}\n  → ${e.message}`)
                          .join("\n")}
                      </pre>
                    ) : (
                      <p className="mt-2 text-xs text-ink-subtle">Sin errores registrados.</p>
                    )}
                  </div>

                  {/* Consola del job: las etapas de cada ficha, sin salir de aquí. */}
                  <div className="min-w-0 lg:col-span-2">
                    <p className="mb-2 text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
                      Actividad del job
                    </p>
                    <ScraperConsole jobId={job.jobId} maxHeightClass="max-h-72" />
                  </div>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}
