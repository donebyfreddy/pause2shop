import { getPool } from "../database/pool";
import { AiExtractionSchema } from "./schema";
import type { AiCacheEntry, AiExtractionCache } from "./cache";

/**
 * Caché de extracciones por IA con respaldo en Postgres.
 *
 * Es lo que hace que el ahorro sobreviva al reinicio: en serverless cada
 * invocación arranca con la memoria vacía, así que sin esto un segundo sync de
 * la misma tienda volvería a pagar todas las extracciones.
 *
 * La lectura RE-VALIDA con Zod: una entrada guardada por una versión anterior
 * del código no debe entrar en el pipeline sin pasar el mismo control que una
 * respuesta recién llegada del modelo.
 */
export class PostgresAiCache implements AiExtractionCache {
  async get(key: string): Promise<AiCacheEntry | null> {
    const res = await getPool().query(
      `select extraction, model, schema_version, prompt_tokens, completion_tokens,
              cost_usd, created_at
       from catalog_ai_extractions where cache_key = $1`,
      [key]
    );
    const row = res.rows[0];
    if (!row) return null;

    const validated = AiExtractionSchema.safeParse(row.extraction);
    if (!validated.success) {
      // Entrada corrupta o de un esquema antiguo: se descarta y se re-extrae.
      await getPool()
        .query("delete from catalog_ai_extractions where cache_key = $1", [key])
        .catch(() => undefined);
      return null;
    }

    // Contabilidad del ahorro: cada acierto se registra.
    await getPool()
      .query(
        "update catalog_ai_extractions set hits = hits + 1, last_hit_at = now() where cache_key = $1",
        [key]
      )
      .catch(() => undefined);

    return {
      extraction: validated.data,
      model: row.model,
      schemaVersion: row.schema_version,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      costUsd: Number(row.cost_usd),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async set(
    key: string,
    entry: AiCacheEntry,
    meta?: { url: string; domHash: string }
  ): Promise<void> {
    const url = meta?.url ?? entry.extraction.canonicalUrl;
    let domain = "unknown";
    try {
      domain = new URL(url).host;
    } catch {
      /* URL no parseable: se guarda igual con domain=unknown */
    }
    await getPool().query(
      `insert into catalog_ai_extractions
         (cache_key, url, domain, dom_hash, model, schema_version, extraction,
          prompt_tokens, completion_tokens, cost_usd)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       on conflict (cache_key) do update set
         extraction = excluded.extraction,
         prompt_tokens = excluded.prompt_tokens,
         completion_tokens = excluded.completion_tokens,
         cost_usd = excluded.cost_usd`,
      [
        key,
        url,
        domain,
        meta?.domHash ?? "",
        entry.model,
        entry.schemaVersion,
        JSON.stringify(entry.extraction),
        entry.promptTokens,
        entry.completionTokens,
        entry.costUsd,
      ]
    );
  }

  /** Estadísticas de la caché para el admin: aciertos y coste evitado. */
  async stats(): Promise<{
    entries: number;
    hits: number;
    costUsd: number;
    /** Coste que NO se ha pagado gracias a los aciertos. */
    savedUsd: number;
    byModel: Record<string, number>;
  }> {
    const totals = await getPool().query(
      `select count(*)::int as entries,
              coalesce(sum(hits),0)::int as hits,
              coalesce(sum(cost_usd),0)::numeric as cost_usd,
              coalesce(sum(hits * cost_usd),0)::numeric as saved_usd
       from catalog_ai_extractions`
    );
    const byModelRes = await getPool().query(
      "select model, count(*)::int as c from catalog_ai_extractions group by model"
    );
    const byModel: Record<string, number> = {};
    for (const r of byModelRes.rows) byModel[r.model] = r.c;
    return {
      entries: totals.rows[0].entries,
      hits: totals.rows[0].hits,
      costUsd: Number(totals.rows[0].cost_usd),
      savedUsd: Number(totals.rows[0].saved_usd),
      byModel,
    };
  }
}

/** Registra uso del modelo agregado por día/modelo/conector/job. */
export async function recordAiUsage(input: {
  model: string;
  connectorId: string | null;
  jobId: string | null;
  calls?: number;
  cachedCalls?: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
}): Promise<void> {
  await getPool().query(
    `insert into catalog_ai_usage
       (model, connector_id, job_id, calls, cached_calls, prompt_tokens, completion_tokens, cost_usd)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (day, model, connector_id, job_id) do update set
       calls = catalog_ai_usage.calls + excluded.calls,
       cached_calls = catalog_ai_usage.cached_calls + excluded.cached_calls,
       prompt_tokens = catalog_ai_usage.prompt_tokens + excluded.prompt_tokens,
       completion_tokens = catalog_ai_usage.completion_tokens + excluded.completion_tokens,
       cost_usd = catalog_ai_usage.cost_usd + excluded.cost_usd,
       updated_at = now()`,
    [
      input.model,
      input.connectorId,
      input.jobId,
      input.calls ?? 0,
      input.cachedCalls ?? 0,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      input.costUsd ?? 0,
    ]
  );
}

/** Uso agregado de los últimos N días. */
export async function aiUsageSummary(days = 30): Promise<{
  days: number;
  calls: number;
  cachedCalls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  byModel: Array<{ model: string; calls: number; costUsd: number }>;
  byConnector: Array<{ connectorId: string | null; calls: number; costUsd: number }>;
}> {
  const cutoff = `${days} days`;
  const totals = await getPool().query(
    `select coalesce(sum(calls),0)::int as calls,
            coalesce(sum(cached_calls),0)::int as cached_calls,
            coalesce(sum(prompt_tokens),0)::bigint as prompt_tokens,
            coalesce(sum(completion_tokens),0)::bigint as completion_tokens,
            coalesce(sum(cost_usd),0)::numeric as cost_usd
     from catalog_ai_usage where day >= current_date - $1::interval`,
    [cutoff]
  );
  const byModel = await getPool().query(
    `select model, sum(calls)::int as calls, sum(cost_usd)::numeric as cost_usd
     from catalog_ai_usage where day >= current_date - $1::interval
     group by model order by cost_usd desc`,
    [cutoff]
  );
  const byConnector = await getPool().query(
    `select connector_id, sum(calls)::int as calls, sum(cost_usd)::numeric as cost_usd
     from catalog_ai_usage where day >= current_date - $1::interval
     group by connector_id order by cost_usd desc`,
    [cutoff]
  );
  return {
    days,
    calls: totals.rows[0].calls,
    cachedCalls: totals.rows[0].cached_calls,
    promptTokens: Number(totals.rows[0].prompt_tokens),
    completionTokens: Number(totals.rows[0].completion_tokens),
    costUsd: Number(totals.rows[0].cost_usd),
    byModel: byModel.rows.map((r) => ({
      model: r.model,
      calls: r.calls,
      costUsd: Number(r.cost_usd),
    })),
    byConnector: byConnector.rows.map((r) => ({
      connectorId: r.connector_id,
      calls: r.calls,
      costUsd: Number(r.cost_usd),
    })),
  };
}
