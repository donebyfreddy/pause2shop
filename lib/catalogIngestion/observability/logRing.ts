/**
 * Buffer circular de logs en memoria.
 *
 * El servicio ya escribe JSON estructurado a stdout (que es lo correcto en
 * producción: lo recoge el runtime). Pero el admin necesita poder LEER los
 * últimos eventos sin acceso al proceso, así que además los retenemos aquí.
 *
 * Es deliberadamente en memoria y acotado: no es un sistema de logs, es una
 * ventana de diagnóstico. Al reiniciar se pierde, y así se documenta en el
 * propio admin.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  msg: string;
  /** Campos estructurados del evento (connector, jobId, url, error…). */
  context: Record<string, unknown>;
}

export interface LogQuery {
  level?: LogLevel;
  /** Búsqueda libre sobre mensaje y contexto serializado. */
  q?: string;
  /** Filtra por `connector`/`source` del contexto. */
  source?: string;
  /** Filtra por `jobId` del contexto. */
  jobId?: string;
  limit?: number;
}

const CAPACITY = 750;
const buffer: LogEntry[] = [];
let nextId = 1;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function pushLog(level: LogLevel, msg: string, context: Record<string, unknown> = {}): void {
  buffer.push({ id: nextId++, ts: new Date().toISOString(), level, msg, context });
  if (buffer.length > CAPACITY) buffer.splice(0, buffer.length - CAPACITY);
}

/** Últimos logs, más recientes primero, aplicando filtros. */
export function queryLogs(query: LogQuery = {}): LogEntry[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), CAPACITY);
  const needle = query.q?.toLowerCase().trim();
  const minLevel = query.level ? LEVEL_ORDER[query.level] : 0;

  const matches = buffer.filter((entry) => {
    if (LEVEL_ORDER[entry.level] < minLevel) return false;
    if (query.source) {
      const source = entry.context.connector ?? entry.context.source;
      if (source !== query.source) return false;
    }
    if (query.jobId && entry.context.jobId !== query.jobId) return false;
    if (needle) {
      const haystack = `${entry.msg} ${JSON.stringify(entry.context)}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  return matches.slice(-limit).reverse();
}

/** Conteo por nivel de todo el buffer (para el resumen del admin). */
export function logLevelCounts(): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
  for (const entry of buffer) counts[entry.level]++;
  return counts;
}

export function logBufferSize(): number {
  return buffer.length;
}

/** Solo para tests. */
export function clearLogs(): void {
  buffer.length = 0;
  nextId = 1;
}
