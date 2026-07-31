import { randomUUID } from "node:crypto";
import type { JobRecord, JobType, JobProgress, JobStatus } from "../catalog/types";
import { emptyJobProgress, isActiveJobStatus } from "../catalog/types";
import type { CatalogStore } from "../catalog/store";
import { getConfig } from "../config/index";
import { logger } from "../observability/logger";
import { runJob } from "./handlers";

/**
 * Cola de jobs en proceso con N workers. Los registros de job (estado,
 * progreso, checkpoint, errores) se persisten en el store en cada avance:
 * si el proceso muere, el job puede reanudarse desde su checkpoint con
 * retry_failed. Idempotencia: encolar el mismo sync (mismo source+mode) con
 * uno ya queued/running devuelve el job existente en vez de duplicarlo.
 */

export interface EnqueueParams {
  type: JobType;
  source?: string | null;
  mode?: "full" | "incremental" | null;
  limit?: number | null;
  /** Checkpoint inicial (reanudación de un job fallido). */
  checkpoint?: Record<string, unknown>;
}

export class JobQueue {
  private pending: string[] = [];
  private running = new Set<string>();
  private workersActive = 0;
  private shuttingDown = false;
  private drainResolvers: Array<() => void> = [];

  constructor(private store: CatalogStore) {}

  async enqueue(params: EnqueueParams): Promise<JobRecord> {
    // Idempotencia: un sync idéntico ya en vuelo no se duplica
    if (params.type.startsWith("sync") && params.source) {
      for (const job of await this.store.listJobs(50)) {
        if (
          job.source === params.source &&
          job.type === params.type &&
          (job.status === "queued" || isActiveJobStatus(job.status))
        ) {
          const heartbeat = job.startedAt ?? job.createdAt;
          const isStale = Date.now() - new Date(heartbeat).getTime() > 4 * 60 * 1000;
          if (!isStale) return job;

          // A serverless invocation can be terminated at its duration limit.
          // Release stale jobs so a later click can safely continue with a
          // fresh, idempotent sync instead of remaining "running" forever.
          job.status = "partially_completed";
          job.finishedAt = new Date().toISOString();
          job.errors = [
            ...job.errors,
            {
              url: "",
              message: "la ejecución serverless expiró; el job puede reintentarse desde su checkpoint",
              at: new Date().toISOString(),
            },
          ].slice(-50);
          await this.store.saveJob(job);
        }
      }
    }

    const job: JobRecord = {
      jobId: randomUUID(),
      type: params.type,
      source: params.source ?? null,
      mode: params.mode ?? null,
      limit: params.limit ?? null,
      status: "queued",
      progress: emptyJobProgress(),
      checkpoint: params.checkpoint ?? {},
      errors: [],
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      durationMs: 0,
      cancelRequested: false,
    };
    await this.store.saveJob(job);
    this.pending.push(job.jobId);
    this.spawnWorkers();
    return job;
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = await this.store.getJob(jobId);
    if (!job) return false;
    if (job.status === "queued") {
      this.pending = this.pending.filter((id) => id !== jobId);
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      await this.store.saveJob(job);
      return true;
    }
    if (isActiveJobStatus(job.status)) {
      // Señal cooperativa: el handler comprueba cancelRequested en cada item
      job.cancelRequested = true;
      await this.store.saveJob(job);
      return true;
    }
    return false;
  }

  private spawnWorkers(): void {
    const max = getConfig().jobWorkers;
    while (this.workersActive < max && this.pending.length > 0 && !this.shuttingDown) {
      this.workersActive++;
      void this.workerLoop().finally(() => {
        this.workersActive--;
        if (this.workersActive === 0 && this.pending.length === 0) {
          for (const r of this.drainResolvers.splice(0)) r();
        }
      });
    }
  }

  private async workerLoop(): Promise<void> {
    while (!this.shuttingDown) {
      const jobId = this.pending.shift();
      if (!jobId) return;
      this.running.add(jobId);
      try {
        await this.execute(jobId);
      } catch (err) {
        logger.error("worker: error no controlado en job", {
          jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.running.delete(jobId);
      }
    }
  }

  private async execute(jobId: string): Promise<void> {
    const job = await this.store.getJob(jobId);
    if (!job || job.status !== "queued") return;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    await this.store.saveJob(job);
    logger.info("job iniciado", { jobId, type: job.type, source: job.source });

    const started = Date.now();
    const persist = async (progress: JobProgress, checkpoint: Record<string, unknown>) => {
      // Releemos para no pisar cancelRequested puesto desde la API
      const fresh = await this.store.getJob(jobId);
      if (fresh?.cancelRequested) job.cancelRequested = true;
      job.progress = progress;
      job.checkpoint = checkpoint;
      job.durationMs = Date.now() - started;
      // La etapa que reporta el handler pasa a ser el estado visible del job:
      // "scraping" dice mucho más que "running" en la lista del admin.
      if (progress.stage && isActiveJobStatus(progress.stage as JobStatus)) {
        job.status = progress.stage as JobStatus;
      }
      await this.store.saveJob(job);
    };

    // `job.cancelRequested` solo se refrescaba dentro de `persist()`, y el
    // handler únicamente llama a `persist` en ciertos puntos (p.ej. al pasar
    // de descubrir a rastrear) — durante todo el descubrimiento de una fuente
    // con muchos sitemaps, `shouldCancel()` leía siempre el valor inicial
    // (`false`) por mucho que la API ya hubiera marcado `cancelRequested` en
    // la BD. Este sondeo independiente es lo que hace que "Cancelar" surta
    // efecto sin depender de en qué etapa del pipeline esté el job.
    const cancelPoll = setInterval(() => {
      this.store
        .getJob(jobId)
        .then((fresh) => {
          if (fresh?.cancelRequested) job.cancelRequested = true;
        })
        .catch(() => undefined);
    }, 2000);

    try {
      const result = await runJob(this.store, job, persist, () => job.cancelRequested || this.shuttingDown);
      job.progress = result.progress;
      job.errors = [...job.errors, ...result.errors.map((e) => ({ ...e, at: new Date().toISOString() }))].slice(-50);
      if (job.cancelRequested) job.status = "cancelled";
      else if (!result.completed) job.status = "partially_completed";
      else if (result.progress.errors > 0 && result.progress.new + result.progress.updated > 0)
        job.status = "partially_completed";
      else if (result.progress.errors > 0 && result.progress.fetched === 0 && result.progress.discovered > 0)
        job.status = "failed";
      else job.status = "completed";
    } catch (err) {
      job.status = "failed";
      job.errors.push({
        url: "",
        message: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      });
    } finally {
      clearInterval(cancelPoll);
    }
    job.finishedAt = new Date().toISOString();
    job.durationMs = Date.now() - started;
    await this.store.saveJob(job);
    logger.info("job terminado", { jobId, status: job.status, progress: job.progress, durationMs: job.durationMs });
  }

  /** Graceful shutdown: no acepta más trabajo y espera a que los workers
   * persistan su checkpoint (la cancelación cooperativa hace el resto). */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.workersActive === 0) return;
    await new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
      // Cinturón de seguridad: no esperamos más de 10s
      setTimeout(resolve, 10_000).unref?.();
    });
  }

  /** Espera a que la cola quede vacía (para CLI y tests). */
  async drain(): Promise<void> {
    if (this.workersActive === 0 && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.drainResolvers.push(resolve));
  }

  /**
   * Reencola en memoria los jobs varados por una invocación anterior que
   * murió sin drenarlos. Es lo que hace que la reanudación funcione en
   * serverless: cada invocación (petición o cron) parte de un `JobQueue`
   * en memoria VACÍO, así que sin esto un job `queued` que nunca llegó a
   * spawnear worker, o uno `running` cuya invocación murió a mitad, se
   * quedaría huérfano para siempre aunque su checkpoint siga en la base
   * de datos.
   *
   * Un `running` sin proceso vivo detrás es, de hecho, un `queued` con
   * checkpoint: se reclasifica y se reencola tal cual — `runJob` sigue
   * desde ese checkpoint, no repite trabajo ya persistido.
   */
  async resumeStalled(): Promise<number> {
    const STALE_MS = 60_000;
    const jobs = await this.store.listJobs(50);
    let resumed = 0;
    for (const job of jobs) {
      if (this.pending.includes(job.jobId) || this.running.has(job.jobId)) continue;
      if (job.status === "queued") {
        this.pending.push(job.jobId);
        resumed++;
      } else if (isActiveJobStatus(job.status)) {
        const heartbeat = job.startedAt ?? job.createdAt;
        if (Date.now() - new Date(heartbeat).getTime() > STALE_MS) {
          job.status = "queued";
          await this.store.saveJob(job);
          this.pending.push(job.jobId);
          resumed++;
        }
      }
    }
    if (resumed > 0) this.spawnWorkers();
    return resumed;
  }
}

let queue: JobQueue | null = null;

export function getQueue(store: CatalogStore): JobQueue {
  if (!queue) queue = new JobQueue(store);
  return queue;
}

export function resetQueueForTests(): void {
  queue = null;
}
