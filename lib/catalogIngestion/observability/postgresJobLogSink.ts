import { getPool } from "../database/pool";
import type { JobLogEntry, JobLogLevel, JobLogQuery, JobLogSink, JobStage } from "./jobLog";
import { LEVEL_ORDER } from "./jobLog";

/**
 * Persistencia de los logs de ingesta en Postgres.
 *
 * Escritura por LOTES con un solo INSERT multi-fila: un job de 100 fichas emite
 * del orden de 700 líneas, y hacer 700 round-trips convertiría el log en el
 * cuello de botella del scraper.
 */
export class PostgresJobLogSink implements JobLogSink {
  async write(entries: JobLogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const columns = 12;
    const values: unknown[] = [];
    const rows: string[] = [];
    entries.forEach((e, i) => {
      const base = i * columns;
      rows.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},` +
          `$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11}::jsonb,$${base + 12})`
      );
      values.push(
        e.id,
        e.jobId,
        e.connectorId,
        e.level,
        e.stage,
        e.message,
        e.url ?? null,
        // `product_id` es uuid: un id no-uuid (tests, fixtures) se guarda como
        // null en vez de reventar el INSERT de todo el lote.
        isUuid(e.productId) ? e.productId : null,
        e.durationMs ?? null,
        e.retry ?? null,
        e.metadata ? JSON.stringify(e.metadata) : null,
        e.createdAt
      );
    });

    await getPool().query(
      `insert into catalog_job_logs
         (id, job_id, connector_id, level, stage, message, url, product_id,
          duration_ms, retry, metadata, created_at)
       values ${rows.join(",")}
       on conflict (id) do nothing`,
      values
    );
  }

  async query(query: JobLogQuery): Promise<JobLogEntry[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown): void => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };

    if (query.jobId) add("job_id = ?", query.jobId);
    if (query.connectorId) add("connector_id = ?", query.connectorId);
    if (query.stage) add("stage = ?", query.stage);
    if (query.level) {
      // El filtro de nivel es "este nivel Y superiores": se expande a la lista
      // concreta porque el orden de severidad no es alfabético.
      const allowed = (Object.keys(LEVEL_ORDER) as JobLogLevel[]).filter(
        (l) => LEVEL_ORDER[l] >= LEVEL_ORDER[query.level as JobLogLevel]
      );
      add("level = any(?)", allowed);
    }
    if (query.q) {
      // Un solo parámetro reutilizado en las dos columnas del filtro libre.
      params.push(`%${query.q}%`);
      const p = `$${params.length}`;
      where.push(`(message ilike ${p} or url ilike ${p})`);
    }

    const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000);
    const sql =
      `select id, job_id, connector_id, level, stage, message, url, product_id,
              duration_ms, retry, metadata, seq, created_at
       from catalog_job_logs
       ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
       order by created_at desc
       limit ${limit}`;

    const res = await getPool().query(sql, params);
    return res.rows.map(
      (r): JobLogEntry => ({
        id: r.id,
        jobId: r.job_id,
        connectorId: r.connector_id,
        level: r.level as JobLogLevel,
        stage: r.stage as JobStage,
        message: r.message,
        url: r.url,
        productId: r.product_id,
        durationMs: r.duration_ms,
        retry: r.retry,
        metadata: r.metadata,
        createdAt: new Date(r.created_at).toISOString(),
        seq: Number(r.seq ?? 0),
      })
    );
  }

  /** Purga logs antiguos. Se llama desde el cron de mantenimiento. */
  async prune(maxAgeDays: number): Promise<number> {
    const res = await getPool().query(
      `delete from catalog_job_logs where created_at < now() - ($1 || ' days')::interval`,
      [String(maxAgeDays)]
    );
    return res.rowCount ?? 0;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}
