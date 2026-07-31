/**
 * Regenera los embeddings del catálogo.
 *
 *   npm run catalog:embeddings:reindex -- --source=fashion-product-images-small
 *   npm run catalog:embeddings:reindex -- --only-missing
 *   npm run catalog:embeddings:reindex -- --status
 *
 * Hace falta cuando se cambia de proveedor de embeddings: los vectores de 64
 * dimensiones del proveedor `hash` y los de 512 de CLIP no son comparables entre
 * sí, y `matchProducts` descarta en silencio los de dimensión distinta. Un
 * índice a medio migrar parece funcionar y en realidad no busca nada, así que
 * `--status` existe para ver la mezcla antes de que sorprenda.
 */
import { loadEnv } from "./loadEnv";

loadEnv();

import { bootstrapIngestion } from "../lib/catalogIngestion/bootstrap";
import { getStore } from "../lib/catalogIngestion/catalog/store";
import { closePool, getPool } from "../lib/catalogIngestion/database/pool";
import { getEmbeddingProvider } from "../lib/catalogIngestion/embeddings/index";
import { getQueue } from "../lib/catalogIngestion/jobs/queue";
import { flushJobLogs } from "../lib/catalogIngestion/observability/jobLog";
import { endProgress, line, paint, parseArgs, progressBar } from "./datasetCli";

/** Reparto real de estados y dimensiones. Lo que revela un índice mixto. */
async function printStatus(source: string | null): Promise<void> {
  const where = source ? "where source = $1" : "";
  const params = source ? [source] : [];

  const byStatus = await getPool().query<{ embedding_status: string; n: string }>(
    `select embedding_status, count(*)::text n from catalog_products ${where}
     group by embedding_status order by n desc`,
    params
  );
  const byDim = await getPool().query<{
    embedding_provider: string | null;
    embedding_dimension: number | null;
    n: string;
  }>(
    `select embedding_provider, embedding_dimension, count(*)::text n
       from catalog_products ${where}
      group by embedding_provider, embedding_dimension order by n desc`,
    params
  );

  line("INFO", "STATUS", `Estados de embedding${source ? ` (source=${source})` : ""}:`);
  for (const r of byStatus.rows) {
    const tone = r.embedding_status === "ready" ? "ok" : r.embedding_status === "failed" ? "err" : "warn";
    console.log(`  ${paint(tone, r.embedding_status.padEnd(12))} ${r.n}`);
  }

  line("INFO", "STATUS", "Proveedor y dimensión:");
  const dims = new Set<number>();
  for (const r of byDim.rows) {
    if (r.embedding_dimension) dims.add(r.embedding_dimension);
    console.log(
      `  ${(r.embedding_provider ?? "—").padEnd(12)} ${String(r.embedding_dimension ?? "—").padEnd(6)} ${r.n}`
    );
  }
  if (dims.size > 1) {
    line(
      "WARN",
      "STATUS",
      `Hay ${dims.size} dimensiones distintas (${[...dims].join(", ")}). La búsqueda ` +
        "por coseno IGNORA los vectores cuya dimensión no coincide con la consulta: " +
        "reindexa todo con el mismo proveedor."
    );
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const source = parsed.flags.get("source") ?? null;
  const onlyMissing =
    parsed.flags.get("only-missing") === "true" || parsed.flags.get("onlyMissing") === "true";
  const statusOnly = parsed.flags.get("status") === "true";

  await bootstrapIngestion();
  const store = await getStore();

  if (store.backend === "postgres") {
    await printStatus(source);
  }
  if (statusOnly) return;

  const provider = await getEmbeddingProvider();
  line(
    provider.name === "hash" ? "WARN" : "SUCCESS",
    "PROVIDER",
    `${provider.name} · ${provider.model} · ${provider.dimension()}d` +
      (provider.name === "hash"
        ? paint("warn", " — NO es un embedding semántico (dHash + histograma)")
        : "")
  );

  const queue = getQueue(store);
  const job = await queue.enqueue({
    type: "reindex_embeddings",
    source,
    checkpoint: { source, onlyMissing },
  });
  line("INFO", "JOB", `Encolado ${paint("ok", job.jobId)}`);

  let stop = false;
  const poll = setInterval(() => {
    if (stop) return;
    void store
      .getJob(job.jobId)
      .then((current) => {
        if (!current || stop) return;
        progressBar(
          current.progress.updated,
          current.progress.discovered,
          `${current.progress.embeddingsReady} listos · ${current.progress.errors}e · ${current.status}`
        );
      })
      .catch(() => undefined);
  }, 700);

  try {
    await queue.drain();
  } finally {
    stop = true;
    clearInterval(poll);
    endProgress();
  }

  const finished = await store.getJob(job.jobId);
  if (finished) {
    line(
      finished.status === "completed" ? "SUCCESS" : "WARN",
      "REINDEX",
      `${finished.progress.updated}/${finished.progress.discovered} fichas · ` +
        `${finished.progress.embeddingsReady} embeddings listos · ` +
        `${finished.progress.errors} errores · estado=${finished.status}`
    );
  }
  if (store.backend === "postgres") await printStatus(source);
}

main()
  .catch((error: unknown) => {
    endProgress();
    line("ERROR", "REINDEX", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushJobLogs().catch(() => undefined);
    await closePool().catch(() => undefined);
  });
