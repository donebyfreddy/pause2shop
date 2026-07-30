/**
 * Métricas en memoria expuestas en /stats. Contadores simples: para un
 * servicio de un solo proceso no hace falta Prometheus; si se escala,
 * estos contadores se sustituyen por un client de métricas real.
 */

export interface Metrics {
  startedAt: number;
  requestsByDomain: Record<string, number>;
  httpRequestsByPath: Record<string, number>;
  providerUsage: Record<string, { calls: number; errors: number; lastUsedAt: string | null }>;
  connectorErrors: Record<string, number>;
}

const metrics: Metrics = {
  startedAt: Date.now(),
  requestsByDomain: {},
  httpRequestsByPath: {},
  providerUsage: {},
  connectorErrors: {},
};

export function countDomainRequest(domain: string): void {
  metrics.requestsByDomain[domain] = (metrics.requestsByDomain[domain] ?? 0) + 1;
}

export function countHttpRequest(path: string): void {
  metrics.httpRequestsByPath[path] = (metrics.httpRequestsByPath[path] ?? 0) + 1;
}

export function recordProviderUsage(provider: string, ok: boolean): void {
  const entry = metrics.providerUsage[provider] ?? { calls: 0, errors: 0, lastUsedAt: null };
  entry.calls += 1;
  if (!ok) entry.errors += 1;
  entry.lastUsedAt = new Date().toISOString();
  metrics.providerUsage[provider] = entry;
}

export function countConnectorError(connector: string): void {
  metrics.connectorErrors[connector] = (metrics.connectorErrors[connector] ?? 0) + 1;
}

/**
 * Throughput de ingesta. Guardamos solo los timestamps de la última hora
 * (acotado a INGEST_WINDOW_MAX eventos) para poder responder "productos/min"
 * sin almacenar histórico: eso es trabajo de la base de datos, no del proceso.
 */
const INGEST_WINDOW_MS = 60 * 60 * 1000;
const INGEST_WINDOW_MAX = 5000;
const ingestEvents: Array<{ at: number; source: string }> = [];

export function recordIngest(source: string): void {
  const now = Date.now();
  ingestEvents.push({ at: now, source });
  const cutoff = now - INGEST_WINDOW_MS;
  while (ingestEvents.length > 0 && ingestEvents[0].at < cutoff) ingestEvents.shift();
  if (ingestEvents.length > INGEST_WINDOW_MAX) {
    ingestEvents.splice(0, ingestEvents.length - INGEST_WINDOW_MAX);
  }
}

export interface ThroughputSnapshot {
  windowMinutes: number;
  products: number;
  perMinute: number;
  bySource: Record<string, number>;
}

export function ingestThroughput(windowMinutes = 15): ThroughputSnapshot {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;
  const recent = ingestEvents.filter((e) => e.at >= cutoff);
  const bySource: Record<string, number> = {};
  for (const e of recent) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
  return {
    windowMinutes,
    products: recent.length,
    perMinute: Math.round((recent.length / windowMinutes) * 100) / 100,
    bySource,
  };
}

export function getMetrics(): Metrics {
  return metrics;
}

export function uptimeSeconds(): number {
  return Math.round((Date.now() - metrics.startedAt) / 1000);
}
