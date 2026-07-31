/**
 * Reanuda una importación interrumpida desde su checkpoint.
 *
 *   npm run catalog:dataset:resume -- <jobId>
 *   npm run catalog:dataset:resume            # reanuda el último reanudable
 *
 * El checkpoint que vale es el que llegó a la base de datos, no el que tenía el
 * proceso en memoria cuando murió. Por eso se lee del job.
 */
import { loadEnv } from "./loadEnv";

loadEnv();

import { bootstrapIngestion } from "../lib/catalogIngestion/bootstrap";
import { getStore } from "../lib/catalogIngestion/catalog/store";
import type { JobRecord } from "../lib/catalogIngestion/catalog/types";
import { closePool } from "../lib/catalogIngestion/database/pool";
import type { DatasetImportCheckpoint } from "../lib/catalogIngestion/datasets/types";
import { getQueue } from "../lib/catalogIngestion/jobs/queue";
import { flushJobLogs } from "../lib/catalogIngestion/observability/jobLog";
import { endProgress, line, paint, parseArgs, progressBar } from "./datasetCli";

const RESUMABLE = new Set(["partially_completed", "failed", "cancelled", "queued"]);

function checkpointOf(job: JobRecord): DatasetImportCheckpoint | null {
  const cp = job.checkpoint as unknown as DatasetImportCheckpoint;
  return cp?.options ? cp : null;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  await bootstrapIngestion();
  const store = await getStore();

  let jobId = parsed.positionals[0] ?? parsed.flags.get("job") ?? null;

  if (!jobId) {
    // Sin argumento: se busca el dataset_import reanudable más reciente. Es lo
    // que uno quiere el 99% de las veces tras un timeout.
    const candidates = (await store.listJobs(60)).filter(
      (j) => j.type === "dataset_import" && RESUMABLE.has(j.status) && checkpointOf(j)
    );
    if (candidates.length === 0) {
      line("ERROR", "RESUME", "No hay ninguna importación de dataset reanudable.");
      process.exitCode = 1;
      return;
    }
    jobId = candidates[0].jobId;
    line("INFO", "RESUME", `Sin jobId: se reanuda el más reciente (${paint("ok", jobId)}).`);
  }

  const job = await store.getJob(jobId);
  if (!job) {
    line("ERROR", "RESUME", `Job desconocido: ${jobId}`);
    process.exitCode = 1;
    return;
  }
  if (job.type !== "dataset_import") {
    line("ERROR", "RESUME", `El job ${jobId} es de tipo ${job.type}, no dataset_import.`);
    process.exitCode = 1;
    return;
  }
  const checkpoint = checkpointOf(job);
  if (!checkpoint) {
    line("ERROR", "RESUME", `El job ${jobId} no tiene checkpoint reanudable.`);
    process.exitCode = 1;
    return;
  }

  const remaining = Math.max(0, checkpoint.endOffset - checkpoint.nextOffset);
  line(
    "INFO",
    "CHECKPOINT",
    `dataset=${checkpoint.datasetId} · fila ${checkpoint.nextOffset}/${checkpoint.endOffset} · ` +
      `${remaining} pendientes`
  );
  if (remaining === 0) {
    line("SUCCESS", "RESUME", "El rango ya estaba completo: nada que reanudar.");
    return;
  }

  // Se reanuda como un job NUEVO que arranca en el checkpoint del anterior, en
  // vez de resucitar el original: así el histórico de /admin/jobs conserva por
  // qué se cortó el primero en lugar de sobrescribirlo.
  const queue = getQueue(store);
  const resumed = await queue.enqueue({
    type: "dataset_import",
    source: checkpoint.datasetId,
    limit: remaining,
    checkpoint: {
      ...checkpoint,
      options: { ...checkpoint.options, offset: checkpoint.nextOffset, limit: remaining },
      resumeOfJobId: job.jobId,
    },
  });
  line("INFO", "JOB", `Reanudado como ${paint("ok", resumed.jobId)}`);

  let stop = false;
  const poll = setInterval(() => {
    if (stop) return;
    void store
      .getJob(resumed.jobId)
      .then((current) => {
        if (!current || stop) return;
        progressBar(
          current.progress.fetched,
          remaining,
          `${current.progress.new}n ${current.progress.updated}u ${current.progress.errors}e · ${current.status}`
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

  const finished = await store.getJob(resumed.jobId);
  if (!finished) {
    line("ERROR", "JOB", "El job desapareció.");
    process.exitCode = 1;
    return;
  }
  const p = finished.progress;
  line(
    finished.status === "completed" ? "SUCCESS" : "WARN",
    "RESUME",
    `${p.new} creados · ${p.updated} actualizados · ${p.ignored} omitidos · ${p.errors} errores ` +
      `· estado=${finished.status}`
  );
  if (finished.status === "partially_completed") {
    line("INFO", "RESUME", `Vuelve a reanudar con: npm run catalog:dataset:resume -- ${finished.jobId}`);
  }
}

main()
  .catch((error: unknown) => {
    endProgress();
    line("ERROR", "RESUME", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushJobLogs().catch(() => undefined);
    await closePool().catch(() => undefined);
  });
