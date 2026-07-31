/**
 * Importa productos de moda desde un dataset público al catálogo.
 *
 *   npm run catalog:dataset:import -- --limit=1000
 *   npm run catalog:dataset:import -- --limit=500 --categories=Apparel,Footwear
 *   npm run catalog:dataset:import -- --limit=100 --generate-embeddings=false
 *   npm run catalog:dataset:import -- --limit=10 --dry-run
 *
 * El comando es reanudable y NO duplica: la persistencia va por upsert sobre
 * `(source, source_product_id)`, así que repetirlo actualiza en vez de insertar.
 *
 * DECISIÓN: salvo en `--dry-run`, la importación se ejecuta a través de la MISMA
 * cola de jobs que usa el admin, no por un camino paralelo. Así el job aparece
 * en /admin/jobs con su progreso y sus logs, y `catalog:dataset:resume` puede
 * continuarlo. Un importador de CLI con su propio bucle habría sido más corto y
 * habría dejado el job invisible y no reanudable.
 */
import { loadEnv } from "./loadEnv";

loadEnv();

import { bootstrapIngestion } from "../lib/catalogIngestion/bootstrap";
import { getStore } from "../lib/catalogIngestion/catalog/store";
import { isTerminalJobStatus, type JobRecord } from "../lib/catalogIngestion/catalog/types";
import { closePool } from "../lib/catalogIngestion/database/pool";
import { DatasetImporter, getDataset, resolveOptions } from "../lib/catalogIngestion/datasets/index";
import { getQueue } from "../lib/catalogIngestion/jobs/queue";
import { flushJobLogs } from "../lib/catalogIngestion/observability/jobLog";
import { describeStorage } from "../lib/mediaStorage";
import {
  endProgress,
  line,
  optionsFromArgs,
  paint,
  parseArgs,
  progressBar,
} from "./datasetCli";

function summarize(job: JobRecord, options: { total: number }): void {
  const p = job.progress;
  const level = job.status === "completed" ? "SUCCESS" : "WARN";
  line(
    level,
    "IMPORT",
    `${paint("ok", `${p.new} creados`)} · ${p.updated} actualizados · ` +
      `${p.duplicates} duplicados · ${p.ignored} sin cambios/omitidos · ` +
      `${p.errors > 0 ? paint("err", `${p.errors} errores`) : "0 errores"}`
  );
  line("INFO", "IMAGES", `${p.imagesUploaded} subidas · ${p.imagesSkipped} ya existían`);
  line(
    "INFO",
    "EMBEDDING",
    `${p.embeddingsReady} listos · ${p.embeddingsQueued} en cola`
  );
  line(
    "INFO",
    "JOB",
    `estado=${job.status} · ${(job.durationMs / 1000).toFixed(1)}s · ` +
      `${p.fetched}/${options.total} filas leídas · jobId=${job.jobId}`
  );
  if (job.errors.length > 0) {
    line("WARN", "ERRORS", `Primeros ${Math.min(5, job.errors.length)}:`);
    for (const e of job.errors.slice(0, 5)) console.log(`  ${e.url}: ${e.message}`);
  }
  if (!isTerminalJobStatus(job.status) || job.status === "partially_completed") {
    line("INFO", "RESUME", `Continúa con: npm run catalog:dataset:resume -- ${job.jobId}`);
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const partial = optionsFromArgs(parsed);
  const options = resolveOptions(partial);
  const descriptor = getDataset(options.datasetId);

  const storage = describeStorage();
  line("INFO", "DATASET", `${paint("ok", descriptor.repo)} (origen: ${descriptor.originRepo})`);
  line(
    "INFO",
    "STORAGE",
    `${storage.provider}${storage.ephemeral ? paint("warn", " · EFÍMERO") : paint("ok", " · persistente")}`
  );
  if (storage.ephemeral && options.uploadImages && !options.dryRun) {
    line(
      "WARN",
      "STORAGE",
      "Las imágenes NO sobrevivirán a un reinicio. Configura STORAGE_PROVIDER=vercel_blob."
    );
  }

  await bootstrapIngestion();
  const store = await getStore();
  line("INFO", "DATABASE", `backend=${store.backend}`);
  line(
    "INFO",
    "OPTIONS",
    `limit=${options.limit} offset=${options.offset} batch=${options.batchSize} ` +
      `imágenes=${options.uploadImages} embeddings=${options.generateEmbeddings}` +
      (options.categories.length ? ` categorías=${options.categories.join("|")}` : "") +
      (options.genders.length ? ` géneros=${options.genders.join("|")}` : "")
  );

  // --- Dry run: no toca la base, no crea job, no sube nada --------------
  if (options.dryRun) {
    const result = await new DatasetImporter({ store }).import(options);
    endProgress();
    for (const warning of result.warnings) line("WARN", "IMPORT", warning);
    line(
      "SUCCESS",
      "DRY-RUN",
      `${result.counters.rowsRead} filas leídas · ${result.counters.created} se guardarían · ` +
        `${result.counters.skipped} omitidas · ${result.counters.errors} con error`
    );
    line("INFO", "DRY-RUN", "No se ha escrito nada. Muestra de lo que se guardaría:");
    for (const p of result.preview.slice(0, 5)) {
      console.log(
        `  ${paint("dim", String(p.sourceProductId).padEnd(7))} ${p.title}\n` +
          `          marca=${p.brand ?? paint("dim", "— (no verificable)")} · ` +
          `categoría=${p.category} · color=${p.color ?? "—"} · ` +
          `precio=${paint("dim", "no disponible en dataset")}`
      );
    }
    if (result.errors.length > 0) {
      line("WARN", "ERRORS", `Primeros ${Math.min(5, result.errors.length)}:`);
      for (const e of result.errors.slice(0, 5)) {
        console.log(`  fila ${e.rowIndex} (${e.sourceProductId ?? "?"}): ${e.message}`);
      }
    }
    return;
  }

  // --- Importación real, vía cola de jobs -------------------------------
  const queue = getQueue(store);
  const job = await queue.enqueue({
    type: "dataset_import",
    source: descriptor.id,
    limit: options.limit,
    checkpoint: {
      options,
      nextOffset: options.offset,
      endOffset: options.offset + options.limit,
    },
  });
  line("INFO", "JOB", `Encolado ${paint("ok", job.jobId)} (tipo dataset_import)`);

  // El progreso se lee del job persistido, que es la misma fuente que ve
  // /admin/jobs: si aquí se ve avanzar, allí también.
  let stop = false;
  const poll = setInterval(() => {
    if (stop) return;
    void store
      .getJob(job.jobId)
      .then((current) => {
        if (!current || stop) return;
        progressBar(
          current.progress.fetched,
          options.limit,
          `${current.progress.new}n ${current.progress.updated}u ` +
            `${current.progress.ignored}o ${current.progress.errors}e · ${current.status}`
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
  if (!finished) {
    line("ERROR", "JOB", "El job desapareció de la base de datos.");
    process.exitCode = 1;
    return;
  }
  summarize(finished, { total: options.limit });
  if (finished.status === "failed") process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    endProgress();
    line("ERROR", "IMPORT", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) console.error(paint("dim", error.stack));
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushJobLogs().catch(() => undefined);
    await closePool().catch(() => undefined);
  });
