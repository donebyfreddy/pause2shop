import { randomUUID } from "node:crypto";
import { logger } from "./logger";

/**
 * Log de ingesta por etapas: persistente, consultable y observable en vivo.
 *
 * El `logRing` en memoria sigue existiendo para el diagnóstico general del
 * proceso, pero un job de scraping necesita algo más: saber qué pasó en CADA
 * ficha, en qué etapa, cuánto tardó y cuánto costó — y seguir sabiéndolo
 * después de que el proceso muera (en serverless, muere siempre).
 *
 * Diseño en tres capas:
 *  1. un anillo en memoria para la lectura inmediata y el streaming;
 *  2. un `sink` persistente (Postgres) con escritura por lotes, para no meter
 *     un INSERT en el camino crítico de cada ficha;
 *  3. suscriptores en proceso, que es lo que alimenta el SSE del admin.
 */

/** Etapas del pipeline. Es la lista cerrada que muestra el admin. */
export type JobStage =
  | "job"
  | "robots"
  | "discover"
  | "navigate"
  | "parse_jsonld"
  | "parse_dom"
  | "ai_extract"
  | "normalize"
  | "download_image"
  | "embedding"
  | "database"
  | "complete"
  | "error";

export const JOB_STAGES: JobStage[] = [
  "job",
  "robots",
  "discover",
  "navigate",
  "parse_jsonld",
  "parse_dom",
  "ai_extract",
  "normalize",
  "download_image",
  "embedding",
  "database",
  "complete",
  "error",
];

/** `success` es un nivel propio: en un scraper, "funcionó" es información. */
export type JobLogLevel = "debug" | "info" | "success" | "warn" | "error";

export const LEVEL_ORDER: Record<JobLogLevel, number> = {
  debug: 10,
  info: 20,
  success: 25,
  warn: 30,
  error: 40,
};

export interface JobLogEntry {
  id: string;
  jobId: string | null;
  connectorId: string | null;
  level: JobLogLevel;
  stage: JobStage;
  message: string;
  url?: string | null;
  productId?: string | null;
  durationMs?: number | null;
  /** Número de reintento (0 = primer intento). */
  retry?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  /** Orden monótono dentro del proceso: el SSE lo usa como cursor. */
  seq: number;
}

export interface JobLogQuery {
  jobId?: string;
  connectorId?: string;
  level?: JobLogLevel;
  stage?: JobStage;
  /** Búsqueda libre sobre mensaje, URL y metadata. */
  q?: string;
  /** Solo entradas con `seq` mayor que este (cursor de streaming). */
  afterSeq?: number;
  limit?: number;
}

/** Destino persistente de los logs. */
export interface JobLogSink {
  write(entries: JobLogEntry[]): Promise<void>;
  query(query: JobLogQuery): Promise<JobLogEntry[]>;
}

const CAPACITY = 2000;
const buffer: JobLogEntry[] = [];
let seqCounter = 0;

type Subscriber = (entry: JobLogEntry) => void;
const subscribers = new Set<Subscriber>();

let sink: JobLogSink | null = null;
let pendingWrites: JobLogEntry[] = [];
let flushTimer: NodeJS.Timeout | null = null;
/** Ms que se agrupan antes de escribir a la base de datos. */
const FLUSH_INTERVAL_MS = 400;
const FLUSH_MAX_BATCH = 100;

export function setJobLogSink(next: JobLogSink | null): void {
  sink = next;
}

export function hasJobLogSink(): boolean {
  return sink != null;
}

function scheduleFlush(): void {
  if (!sink || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushJobLogs();
  }, FLUSH_INTERVAL_MS);
  // No mantenemos vivo el proceso solo por un flush pendiente.
  flushTimer.unref?.();
}

/** Vuelca los logs pendientes al sink. Idempotente y tolerante a fallos. */
export async function flushJobLogs(): Promise<void> {
  if (!sink || pendingWrites.length === 0) return;
  const batch = pendingWrites.splice(0, FLUSH_MAX_BATCH);
  try {
    await sink.write(batch);
  } catch (err) {
    // Un log que no se persiste NO debe romper un job. Se reporta por stdout
    // (que sí lo recoge el runtime) y se sigue.
    logger.warn("jobLog: fallo al persistir logs", {
      count: batch.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (pendingWrites.length > 0) scheduleFlush();
}

export interface LogJobEventInput {
  jobId?: string | null;
  connectorId?: string | null;
  level: JobLogLevel;
  stage: JobStage;
  message: string;
  url?: string | null;
  productId?: string | null;
  durationMs?: number | null;
  retry?: number | null;
  metadata?: Record<string, unknown> | null;
}

/** Registra un evento de etapa. Síncrono: la persistencia va por lotes. */
export function logJobEvent(input: LogJobEventInput): JobLogEntry {
  const entry: JobLogEntry = {
    id: randomUUID(),
    jobId: input.jobId ?? null,
    connectorId: input.connectorId ?? null,
    level: input.level,
    stage: input.stage,
    message: input.message,
    url: input.url ?? null,
    productId: input.productId ?? null,
    durationMs: input.durationMs ?? null,
    retry: input.retry ?? null,
    metadata: input.metadata ?? null,
    createdAt: new Date().toISOString(),
    seq: ++seqCounter,
  };

  buffer.push(entry);
  if (buffer.length > CAPACITY) buffer.splice(0, buffer.length - CAPACITY);

  if (sink) {
    pendingWrites.push(entry);
    if (pendingWrites.length >= FLUSH_MAX_BATCH) void flushJobLogs();
    else scheduleFlush();
  }

  for (const subscriber of subscribers) {
    try {
      subscriber(entry);
    } catch {
      /* un suscriptor roto (conexión SSE caída) no afecta al job */
    }
  }

  return entry;
}

/**
 * Escritor ligado a un job/conector: evita repetir jobId y connectorId en cada
 * llamada, que es donde se cuelan las inconsistencias.
 */
export interface JobLogger {
  (input: Omit<LogJobEventInput, "jobId" | "connectorId">): JobLogEntry;
  jobId: string | null;
  connectorId: string | null;
}

export function createJobLogger(jobId: string | null, connectorId: string | null): JobLogger {
  const fn = ((input: Omit<LogJobEventInput, "jobId" | "connectorId">) =>
    logJobEvent({ ...input, jobId, connectorId })) as JobLogger;
  fn.jobId = jobId;
  fn.connectorId = connectorId;
  return fn;
}

function matches(entry: JobLogEntry, query: JobLogQuery): boolean {
  if (query.jobId && entry.jobId !== query.jobId) return false;
  if (query.connectorId && entry.connectorId !== query.connectorId) return false;
  if (query.stage && entry.stage !== query.stage) return false;
  if (query.level && LEVEL_ORDER[entry.level] < LEVEL_ORDER[query.level]) return false;
  if (query.afterSeq != null && entry.seq <= query.afterSeq) return false;
  if (query.q) {
    const needle = query.q.toLowerCase();
    const haystack = `${entry.message} ${entry.url ?? ""} ${JSON.stringify(entry.metadata ?? {})}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Logs del anillo en memoria, más recientes primero. */
export function queryMemoryJobLogs(query: JobLogQuery = {}): JobLogEntry[] {
  const limit = Math.min(Math.max(query.limit ?? 200, 1), CAPACITY);
  const hits = buffer.filter((e) => matches(e, query));
  return hits.slice(-limit).reverse();
}

/**
 * Logs combinando memoria y persistencia. La memoria es la verdad para lo
 * reciente (aún puede no estar volcada); el sink aporta lo histórico.
 */
export async function queryJobLogs(query: JobLogQuery = {}): Promise<{
  entries: JobLogEntry[];
  source: "memory" | "memory+db";
}> {
  const memory = queryMemoryJobLogs(query);
  if (!sink) return { entries: memory, source: "memory" };
  try {
    const persisted = await sink.query(query);
    const byId = new Map<string, JobLogEntry>();
    for (const e of [...persisted, ...memory]) byId.set(e.id, e);
    const merged = [...byId.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.seq - a.seq
    );
    return {
      entries: merged.slice(0, Math.min(Math.max(query.limit ?? 200, 1), CAPACITY)),
      source: "memory+db",
    };
  } catch (err) {
    logger.warn("jobLog: consulta persistente fallida, se devuelve solo memoria", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { entries: memory, source: "memory" };
  }
}

/** Suscripción en proceso (SSE). Devuelve la función para darse de baja. */
export function subscribeJobLogs(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function currentSeq(): number {
  return seqCounter;
}

/** Resumen por nivel y etapa para las cabeceras del admin. */
export function jobLogSummary(jobId?: string): {
  byLevel: Record<JobLogLevel, number>;
  byStage: Record<string, number>;
  total: number;
} {
  const byLevel: Record<JobLogLevel, number> = { debug: 0, info: 0, success: 0, warn: 0, error: 0 };
  const byStage: Record<string, number> = {};
  let total = 0;
  for (const entry of buffer) {
    if (jobId && entry.jobId !== jobId) continue;
    byLevel[entry.level]++;
    byStage[entry.stage] = (byStage[entry.stage] ?? 0) + 1;
    total++;
  }
  return { byLevel, byStage, total };
}

/** Solo para tests. */
export function clearJobLogs(): void {
  buffer.length = 0;
  pendingWrites = [];
  seqCounter = 0;
}
