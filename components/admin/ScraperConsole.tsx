"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  CircleAlert,
  Copy,
  Download,
  Pause,
  Play,
  RefreshCw,
  ScrollText,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  SearchInput,
  Select,
  Skeleton,
} from "@/components/ui";
import { adminGet } from "@/lib/admin/client";
import { LOG_LEVEL_STYLE, STAGE_LABEL, formatDuration } from "@/lib/admin/status";
import type {
  JobLogEntry,
  JobLogLevel,
  JobStage,
  ScraperLogsResponse,
} from "@/lib/catalogService/types";
import { cn } from "@/lib/ui/cn";

/**
 * Consola de ingesta en directo.
 *
 * Dos transportes, y el componente es explícito sobre cuál está usando:
 *
 *  - **SSE** (`/scraper/logs/stream`): latencia baja, pero solo ve los eventos
 *    de la invocación que atiende el stream. Es lo normal en local.
 *  - **Polling** (`/scraper/logs`): lee además el histórico persistido, así que
 *    funciona aunque el job corra en otra invocación (el caso de Vercel).
 *
 * Se arranca con SSE y se cae a polling si el stream no conecta. Decirlo en la
 * UI importa: un operador que ve la consola quieta necesita saber si es que no
 * pasa nada o que este proceso no ve los eventos.
 */

const POLL_MS = 3000;
/** Techo de líneas en el DOM: una consola infinita acaba congelando la pestaña. */
const MAX_LINES = 1500;

const LEVELS: Array<{ value: "all" | JobLogLevel; label: string }> = [
  { value: "all", label: "Todo" },
  { value: "debug", label: "Debug+" },
  { value: "info", label: "Info+" },
  { value: "success", label: "OK+" },
  { value: "warn", label: "Avisos+" },
  { value: "error", label: "Errores" },
];

export interface ScraperConsoleProps {
  /** Limita la consola a un job concreto. */
  jobId?: string;
  /** Limita la consola a un conector concreto. */
  connectorId?: string;
  /** Fuentes disponibles para el desplegable. */
  connectorIds?: string[];
  className?: string;
  /** Alto máximo del área de scroll. */
  maxHeightClass?: string;
}

export function ScraperConsole({
  jobId,
  connectorId,
  connectorIds = [],
  className,
  maxHeightClass = "max-h-[58vh]",
}: ScraperConsoleProps) {
  const [entries, setEntries] = useState<JobLogEntry[]>([]);
  const [level, setLevel] = useState<"all" | JobLogLevel>("all");
  const [stage, setStage] = useState<"all" | JobStage>("all");
  const [source, setSource] = useState(connectorId ?? "all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [transport, setTransport] = useState<"connecting" | "sse" | "polling">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JobLogEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const [stages, setStages] = useState<JobStage[]>([]);
  const [logSource, setLogSource] = useState<"memory" | "memory+db">("memory");

  const scrollRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(0);
  // El handler del SSE es de larga vida: necesita leer el estado de pausa
  // ACTUAL, no el capturado al suscribirse. De ahí el ref, sincronizado en un
  // efecto (escribirlo durante el render sería un efecto secundario).
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const filterParams = useMemo(() => {
    const params = new URLSearchParams({ limit: "400" });
    if (jobId) params.set("jobId", jobId);
    if (source !== "all") params.set("connector", source);
    if (level !== "all") params.set("level", level);
    if (stage !== "all") params.set("stage", stage);
    if (query.trim()) params.set("q", query.trim());
    return params;
  }, [jobId, source, level, stage, query]);

  /** Inserta manteniendo orden descendente por `seq` y sin duplicados. */
  const push = useCallback((incoming: JobLogEntry[]) => {
    if (incoming.length === 0) return;
    setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const fresh = incoming.filter((e) => !seen.has(e.id));
      if (fresh.length === 0) return prev;
      return [...fresh, ...prev]
        .sort((a, b) => b.seq - a.seq || b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_LINES);
    });
  }, []);

  /**
   * Carga por HTTP (la única vía que trae histórico). Mismo patrón que
   * `useAdminResource`: el fetch vive DENTRO del efecto y el estado se toca
   * después del await, con bandera de cancelación.
   */
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const run = async (): Promise<void> => {
      const res = await adminGet<ScraperLogsResponse>(
        `scraper/logs?${filterParams.toString()}`,
        { signal: controller.signal }
      );
      if (cancelled) return;
      if (!res.ok) {
        if (res.error.code !== "aborted") setError(res.error.message);
        setLoading(false);
        return;
      }
      setError(null);
      setStages(res.data.stages);
      setLogSource(res.data.source);
      cursorRef.current = res.data.cursor;
      setEntries(res.data.logs.slice(0, MAX_LINES));
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filterParams, reloadTick]);

  // --- Transporte SSE ---
  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      es = new EventSource(`/api/catalog/scraper/logs/stream?${filterParams.toString()}`);
      // Si el stream no da señales de vida, pasamos a polling en vez de dejar
      // la consola muda.
      fallbackTimer = setTimeout(() => {
        if (!cancelled && transport !== "sse") setTransport("polling");
      }, 4000);

      es.addEventListener("hello", () => {
        if (cancelled) return;
        setTransport("sse");
        setError(null);
      });
      es.addEventListener("log", (event) => {
        if (cancelled || pausedRef.current) return;
        try {
          push([JSON.parse((event as MessageEvent).data) as JobLogEntry]);
        } catch {
          /* línea corrupta: se ignora, no se rompe la consola */
        }
      });
      es.addEventListener("bye", () => {
        // El servidor cerró por límite de duración: el navegador reconectará.
        setTransport("connecting");
      });
      es.onerror = () => {
        if (!cancelled) setTransport("polling");
      };
    } catch {
      // EventSource no disponible (o bloqueado): a polling, en un tick aparte
      // para no encadenar renders desde el propio efecto.
      queueMicrotask(() => {
        if (!cancelled) setTransport("polling");
      });
    }

    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      es?.close();
    };
    // `transport` se lee dentro pero NO debe re-crear el stream al cambiar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterParams, paused, push]);

  // --- Transporte de respaldo: polling incremental por cursor ---
  useEffect(() => {
    if (paused || transport === "sse") return;
    const id = setInterval(async () => {
      const params = new URLSearchParams(filterParams);
      params.set("afterSeq", String(cursorRef.current));
      const res = await adminGet<ScraperLogsResponse>(`scraper/logs?${params.toString()}`);
      if (!res.ok) return;
      cursorRef.current = Math.max(cursorRef.current, res.data.cursor);
      setLogSource(res.data.source);
      push(res.data.logs);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [filterParams, paused, transport, push]);

  // Auto-scroll: la consola crece por arriba (más reciente primero), así que
  // "seguir" significa mantenerse pegado al inicio del scroll.
  useEffect(() => {
    if (!autoScroll || paused) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [entries, autoScroll, paused]);

  const asText = useCallback(
    () =>
      [...entries]
        .reverse()
        .map((e) =>
          [
            new Date(e.createdAt).toLocaleTimeString("es-ES"),
            LOG_LEVEL_STYLE[e.level].label.padEnd(7),
            (e.connectorId ?? "-").padEnd(14),
            STAGE_LABEL[e.stage].padEnd(10),
            e.message,
            e.url ? `· ${e.url}` : "",
            e.durationMs != null ? `· ${formatDuration(e.durationMs)}` : "",
          ]
            .filter(Boolean)
            .join(" ")
        )
        .join("\n"),
    [entries]
  );

  const copyAll = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("el navegador no permitió copiar al portapapeles");
    }
  };

  const download = (): void => {
    const blob = new Blob([asText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scraper-logs-${jobId ?? source}-${new Date().toISOString().slice(0, 19)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = useMemo(() => {
    const byLevel: Record<string, number> = {};
    for (const e of entries) byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
    return byLevel;
  }, [entries]);

  const aiCost = useMemo(
    () =>
      entries.reduce((sum, e) => {
        const cost = e.metadata?.costUsd;
        return sum + (typeof cost === "number" ? cost : 0);
      }, 0),
    [entries]
  );

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          placeholder="Filtrar por mensaje o URL…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-52 flex-1"
        />
        <Select
          value={level}
          onChange={(e) => setLevel(e.target.value as "all" | JobLogLevel)}
          className="w-auto min-w-32"
          aria-label="Nivel mínimo"
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
        <Select
          value={stage}
          onChange={(e) => setStage(e.target.value as "all" | JobStage)}
          className="w-auto min-w-36"
          aria-label="Etapa"
        >
          <option value="all">Todas las etapas</option>
          {stages.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s] ?? s}
            </option>
          ))}
        </Select>
        {!connectorId && connectorIds.length > 0 && (
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-auto min-w-36"
            aria-label="Fuente"
          >
            <option value="all">Todas las fuentes</option>
            {connectorIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        )}
        <Button
          variant={paused ? "warning" : "outline"}
          size="sm"
          onClick={() => setPaused((v) => !v)}
        >
          {paused ? (
            <>
              <Play className="size-3.5" aria-hidden />
              Reanudar
            </>
          ) : (
            <>
              <Pause className="size-3.5" aria-hidden />
              Pausar
            </>
          )}
        </Button>
        <Button variant="ghost" size="sm" onClick={copyAll} aria-label="Copiar logs">
          {copied ? (
            <Check className="size-4 text-success" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </Button>
        <Button variant="ghost" size="sm" onClick={download} aria-label="Descargar logs">
          <Download className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" icon onClick={reload} aria-label="Recargar">
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden />
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-3 font-mono text-[11px] text-ink-subtle">
            <span>{entries.length} líneas</span>
            {counts.error > 0 && (
              <span className="text-danger">{counts.error} errores</span>
            )}
            {counts.warn > 0 && <span className="text-warning">{counts.warn} avisos</span>}
            {aiCost > 0 && <span>IA ≈ {aiCost.toFixed(6)} USD</span>}
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="size-3 accent-[var(--color-brand)]"
              />
              auto-scroll
            </label>
          </div>
          <div className="flex items-center gap-2">
            {transport === "sse" && !paused && (
              <Badge tone="success" dot pulse>
                streaming
              </Badge>
            )}
            {transport === "polling" && !paused && (
              <Badge tone="info" dot>
                polling {POLL_MS / 1000}s
              </Badge>
            )}
            {transport === "connecting" && !paused && <Badge tone="muted">conectando…</Badge>}
            {paused && <Badge tone="warning">pausado</Badge>}
            <Badge tone={logSource === "memory+db" ? "neutral" : "muted"}>
              {logSource === "memory+db" ? "memoria + BD" : "solo memoria"}
            </Badge>
          </div>
        </div>

        <div ref={scrollRef} className={cn("overflow-y-auto", maxHeightClass)}>
          {loading && entries.length === 0 && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${92 - i * 5}%` }} />
              ))}
            </div>
          )}

          {!loading && error && (
            <EmptyState
              icon={CircleAlert}
              title="No se pudieron leer los logs"
              description={error}
              action={
                <Button variant="secondary" size="sm" onClick={reload}>
                  Reintentar
                </Button>
              }
            />
          )}

          {!loading && !error && entries.length === 0 && (
            <EmptyState
              icon={ScrollText}
              title="Sin actividad con estos filtros"
              description="Lanza un sync desde Conectores para ver el pipeline etapa por etapa."
            />
          )}

          <ul className="divide-y divide-line/50">
            <AnimatePresence initial={false}>
              {entries.map((entry) => {
                const style = LOG_LEVEL_STYLE[entry.level];
                return (
                  <motion.li
                    key={entry.id}
                    initial={{ opacity: 0, backgroundColor: "rgba(109,94,252,0.10)" }}
                    animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
                    transition={{ duration: 0.7 }}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(entry)}
                      className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-white/[0.03]"
                    >
                      <span className="mt-0.5 flex shrink-0 items-center gap-2">
                        <span className={cn("size-1.5 rounded-full", style.dot)} />
                        <span className="font-mono text-[10px] text-ink-faint">
                          {new Date(entry.createdAt).toLocaleTimeString("es-ES")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "w-11 shrink-0 font-mono text-[10px] font-semibold",
                          style.text
                        )}
                      >
                        {style.label}
                      </span>
                      <span className="w-24 shrink-0 truncate font-mono text-[10px] text-ink-subtle">
                        {entry.connectorId ?? "—"}
                      </span>
                      <span className="w-20 shrink-0 font-mono text-[10px] text-ink-faint">
                        {STAGE_LABEL[entry.stage] ?? entry.stage}
                      </span>
                      <span className="min-w-0 flex-1 text-[12px] break-words text-ink-muted">
                        {entry.message}
                        {entry.url && (
                          <span className="ml-2 font-mono text-[10px] text-ink-faint">
                            {shortUrl(entry.url)}
                          </span>
                        )}
                      </span>
                      {entry.durationMs != null && (
                        <span className="shrink-0 font-mono text-[10px] text-ink-faint tabular-nums">
                          {formatDuration(entry.durationMs)}
                        </span>
                      )}
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      </Card>

      {selected && <LogDetail entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Panel de detalle de una línea: metadata completa sin salir de la consola. */
function LogDetail({ entry, onClose }: { entry: JobLogEntry; onClose: () => void }) {
  const style = LOG_LEVEL_STYLE[entry.level];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-ink-faint" aria-hidden />
          <span className={cn("font-mono text-[11px] font-semibold", style.text)}>
            {style.label}
          </span>
          <Badge tone="neutral">{STAGE_LABEL[entry.stage] ?? entry.stage}</Badge>
          {entry.connectorId && <Badge tone="muted">{entry.connectorId}</Badge>}
        </div>
        <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Cerrar detalle">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-[13px] text-ink">{entry.message}</p>
        <dl className="grid gap-x-6 gap-y-1.5 font-mono text-[11px] sm:grid-cols-2">
          <Row label="Momento" value={new Date(entry.createdAt).toLocaleString("es-ES")} />
          {entry.durationMs != null && (
            <Row label="Duración" value={formatDuration(entry.durationMs)} />
          )}
          {entry.jobId && <Row label="Job" value={entry.jobId} />}
          {entry.productId && <Row label="Producto" value={entry.productId} />}
          {entry.retry != null && <Row label="Reintento" value={String(entry.retry)} />}
          {entry.url && <Row label="URL" value={entry.url} wide />}
        </dl>
        {entry.metadata && Object.keys(entry.metadata).length > 0 && (
          <div>
            <p className="mb-1 text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
              Metadata
            </p>
            <pre className="overflow-x-auto rounded-md border border-line bg-black/20 p-3 font-mono text-[10.5px] text-ink-subtle">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="break-all text-ink-subtle">{value}</dd>
    </div>
  );
}

/** URL recortada al final del path: lo distintivo de una ficha está ahí. */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.length > 42 ? `…${u.pathname.slice(-40)}` : u.pathname;
    return `${u.host}${tail}`;
  } catch {
    return url.slice(0, 60);
  }
}

/** Aviso reutilizable sobre el alcance del streaming. */
export function ConsoleTransportNote({ persistent }: { persistent: boolean }) {
  return (
    <Callout tone={persistent ? "info" : "warning"} title="Alcance de estos logs">
      {persistent ? (
        <>
          Los eventos se persisten en la base de datos: la consola muestra también el histórico de
          jobs anteriores. El streaming SSE solo entrega los eventos de{" "}
          <strong>esta invocación</strong>; el resto llega por el polling.
        </>
      ) : (
        <>
          No hay base de datos configurada, así que los logs viven <strong>solo en memoria</strong> y
          se pierden al reiniciar el proceso. Configura <code>DATABASE_URL</code> (cadena{" "}
          <code>postgres://</code>) y ejecuta <code>npm run db:migrate</code> para tener histórico.
        </>
      )}
    </Callout>
  );
}
