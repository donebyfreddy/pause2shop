import type { JobRecord, JobProgress } from "../catalog/types";
import { emptyJobProgress } from "../catalog/types";
import type { CatalogStore } from "../catalog/store";
import { canSync, getConnector } from "../connectors/registry";
import { getEmbeddingProvider } from "../embeddings/index";
import { processImageBuffer } from "../images/processor";
import { readFileSync, existsSync } from "node:fs";
import { logger } from "../observability/logger";
import { createJobLogger } from "../observability/jobLog";
import { getScraperConfig } from "../config/scraper";

/**
 * Handlers de cada tipo de job. Todos son cooperativos: comprueban
 * shouldCancel() por item y persisten progreso+checkpoint vía persist() para
 * que el job sea reanudable tras un crash o un shutdown.
 */

export interface JobResult {
  progress: JobProgress;
  completed: boolean;
  errors: Array<{ url: string; message: string }>;
}

type Persist = (progress: JobProgress, checkpoint: Record<string, unknown>) => Promise<void>;

function emptyProgress(): JobProgress {
  return emptyJobProgress();
}

export async function runJob(
  store: CatalogStore,
  job: JobRecord,
  persist: Persist,
  shouldCancel: () => boolean
): Promise<JobResult> {
  switch (job.type) {
    case "sync_full":
    case "sync_incremental":
      return runSync(store, job, persist, shouldCancel);
    case "refresh_prices":
    case "refresh_availability":
      return runRefresh(store, job, persist, shouldCancel);
    case "reindex_embeddings":
      return runReindex(store, job, persist, shouldCancel);
    case "cleanup_inactive":
      return runCleanup(store, job, persist);
    case "retry_failed":
      return runRetryFailed(store, job, persist, shouldCancel);
    default:
      throw new Error(`tipo de job desconocido: ${job.type}`);
  }
}

async function runSync(
  store: CatalogStore,
  job: JobRecord,
  persist: Persist,
  shouldCancel: () => boolean
): Promise<JobResult> {
  if (!job.source) throw new Error("sync requiere source");
  if (!canSync(job.source)) {
    throw new Error(
      `el conector ${job.source} no puede sincronizar: sin implementación activa o faltan credenciales`
    );
  }
  const state = await store.getSourceState(job.source);
  if (state.paused) throw new Error(`el conector ${job.source} está pausado`);
  const connector = getConnector(job.source);
  if (!connector) throw new Error(`conector desconocido: ${job.source}`);

  const summary = await connector.syncProducts({
    store,
    mode: job.mode ?? "full",
    // `job.limit` es `null` cuando no se pidió un límite explícito: se deja
    // `undefined` para que `syncProducts` use `SCRAPER_MAX_PRODUCTS_PER_SOURCE`
    // en vez de resucitar aquí un techo bajo por defecto.
    limit: job.limit ?? undefined,
    checkpoint: job.checkpoint,
    onProgress: persist,
    shouldCancel,
    jobId: job.jobId,
    // El lote y el presupuesto de tiempo son lo que hace el job reanudable en
    // serverless: se procesa un trozo, se guarda checkpoint y se sale limpio.
    batchSize: getScraperConfig().batchSize,
    timeBudgetMs: invocationTimeBudgetMs(),
  });

  if (summary.completed) {
    await store.setSourceState({ ...state, lastSyncAt: new Date().toISOString() });
  }
  return summary;
}

/**
 * Presupuesto de tiempo de ESTA invocación.
 *
 * En Vercel una función tiene un límite de duración (300 s por defecto): si el
 * job lo alcanza, el proceso muere a media ficha. Reservamos un margen y
 * salimos por nuestro pie con el checkpoint guardado, que es la diferencia
 * entre "reanudable" y "progreso perdido".
 */
function invocationTimeBudgetMs(): number {
  const limitSeconds = Number(process.env.VERCEL_FUNCTION_MAX_DURATION ?? process.env.MAX_DURATION);
  if (Number.isFinite(limitSeconds) && limitSeconds > 20) {
    return (limitSeconds - 15) * 1000;
  }
  // Fuera de Vercel no hay límite de plataforma, pero un lote acotado sigue
  // siendo lo correcto: permite cancelar y ver progreso.
  return process.env.VERCEL ? 240_000 : 600_000;
}

/** Re-visita las fichas conocidas para refrescar precio/disponibilidad. */
async function runRefresh(
  store: CatalogStore,
  job: JobRecord,
  persist: Persist,
  shouldCancel: () => boolean
): Promise<JobResult> {
  const progress = emptyProgress();
  const errors: JobResult["errors"] = [];
  const products = (await store.allProducts()).filter(
    (p) => (!job.source || p.source === job.source) && p.origin === "scraped" && canSync(p.source)
  );
  const startIndex = (job.checkpoint.index as number) ?? 0;
  progress.discovered = products.length;

  for (let i = startIndex; i < products.length; i++) {
    if (shouldCancel()) {
      await persist(progress, { index: i });
      return { progress, completed: false, errors };
    }
    const p = products[i];
    const connector = getConnector(p.source);
    if (!connector) continue;
    try {
      const scraped = await connector.scrapeProduct({
        url: p.canonicalUrl,
        log: createJobLogger(job.jobId, p.source),
      });
      progress.fetched++;
      if (scraped.extraction.aiUsed) progress.withAi++;
      else progress.withoutAi++;
      if (scraped.extraction.browserUsed) progress.withBrowser++;
      progress.aiCostUsd = Math.round((progress.aiCostUsd + scraped.extraction.aiCostUsd) * 1e6) / 1e6;
      const normalized = await connector.normalizeProduct(scraped);
      const now = new Date().toISOString();
      let changed = false;
      if (job.type === "refresh_prices" && normalized.price != null && normalized.price !== p.price) {
        p.price = normalized.price;
        p.originalPrice = normalized.originalPrice;
        p.currency = normalized.currency ?? p.currency;
        await store.recordPrice(p.id, {
          price: normalized.price,
          originalPrice: normalized.originalPrice,
          currency: normalized.currency ?? "EUR",
          recordedAt: now,
        });
        changed = true;
      }
      if (normalized.availability !== p.availability) {
        p.availability = normalized.availability;
        changed = true;
      }
      p.lastSeenAt = now;
      if (changed) {
        p.updatedAt = now;
        progress.updated++;
      } else {
        progress.duplicates++;
      }
      await store.saveProduct(p);
    } catch (err) {
      progress.errors++;
      errors.push({ url: p.canonicalUrl, message: err instanceof Error ? err.message : String(err) });
    }
    if (i % 5 === 0) await persist(progress, { index: i + 1 });
  }
  await persist(progress, { index: products.length });
  return { progress, completed: true, errors };
}

/**
 * Regenera embeddings con el provider ACTIVO desde las imágenes locales.
 * Necesario al cambiar de provider (hash → local): la dimensión cambia y
 * los vectores antiguos dejan de ser comparables.
 */
async function runReindex(
  store: CatalogStore,
  job: JobRecord,
  persist: Persist,
  shouldCancel: () => boolean
): Promise<JobResult> {
  const progress = emptyProgress();
  const errors: JobResult["errors"] = [];
  const provider = await getEmbeddingProvider();
  const products = await store.allProducts();
  const startIndex = (job.checkpoint.index as number) ?? 0;
  progress.discovered = products.length;

  for (let i = startIndex; i < products.length; i++) {
    if (shouldCancel()) {
      await persist(progress, { index: i });
      return { progress, completed: false, errors };
    }
    const p = products[i];
    try {
      const local = p.images.find((img) => img.localPath && existsSync(img.localPath));
      if (local?.localPath) {
        const processed = await processImageBuffer(readFileSync(local.localPath));
        p.imageEmbedding = processed.embedding;
        p.perceptualHash = processed.perceptualHash;
      }
      p.textEmbedding = await provider.embedText(
        `${p.brand ?? ""} ${p.title} ${p.category ?? ""} ${p.color ?? ""}`
      );
      p.updatedAt = new Date().toISOString();
      await store.saveProduct(p);
      progress.updated++;
    } catch (err) {
      progress.errors++;
      errors.push({ url: p.canonicalUrl, message: err instanceof Error ? err.message : String(err) });
    }
    if (i % 10 === 0) await persist(progress, { index: i + 1 });
  }
  await persist(progress, { index: products.length });
  return { progress, completed: true, errors };
}

/** Desactiva productos que llevan >30 días sin verse en la tienda. */
async function runCleanup(store: CatalogStore, job: JobRecord, persist: Persist): Promise<JobResult> {
  const progress = emptyProgress();
  const days = typeof job.checkpoint.maxAgeDays === "number" ? job.checkpoint.maxAgeDays : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  for (const p of await store.allProducts()) {
    progress.discovered++;
    if (p.isActive && p.origin === "scraped" && new Date(p.lastSeenAt).getTime() < cutoff) {
      await store.setActive(p.id, false);
      progress.updated++;
    }
  }
  await persist(progress, job.checkpoint);
  return { progress, completed: true, errors: [] };
}

/** Re-encola un sync fallido/parcial reutilizando su checkpoint persistido. */
async function runRetryFailed(
  store: CatalogStore,
  job: JobRecord,
  persist: Persist,
  shouldCancel: () => boolean
): Promise<JobResult> {
  const failedJobId = job.checkpoint.retryOfJobId as string | undefined;
  const failed = failedJobId ? await store.getJob(failedJobId) : null;
  if (!failed) throw new Error("retry_failed requiere checkpoint.retryOfJobId de un job existente");
  if (!["failed", "partially_completed", "cancelled"].includes(failed.status)) {
    throw new Error(`el job ${failed.jobId} está en estado ${failed.status}, no se reintenta`);
  }
  logger.info("reintentando job desde checkpoint", { original: failed.jobId });
  const retryJob: JobRecord = { ...job, type: failed.type, source: failed.source, mode: failed.mode, limit: failed.limit, checkpoint: { ...failed.checkpoint } };
  return runJob(store, retryJob, persist, shouldCancel);
}
