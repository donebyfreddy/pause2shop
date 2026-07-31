/**
 * Importador de catálogos de dataset.
 *
 * Diseño en una frase: se lee el split por páginas, se procesa por lotes, y
 * después de cada lote se persiste un checkpoint con el offset alcanzado. Eso
 * da las tres propiedades que se piden a la vez:
 *
 *   · REANUDABLE — el checkpoint es un número (la siguiente fila). Reanudar es
 *     continuar desde ahí, sin re-descargar ni re-descubrir nada.
 *   · SIN DUPLICADOS — la persistencia va por `ingestProduct`, que hace upsert
 *     sobre `(source, source_product_id)`. Repetir el comando actualiza, no
 *     inserta. El id del dataset es la clave, así que es idempotente por
 *     construcción y no por suerte.
 *   · ACOTADO EN MEMORIA — nunca hay más de un lote de filas y sus imágenes
 *     vivas; importar 44.000 fichas usa la misma memoria que importar 25.
 *
 * Lo que NO hace: no descarga el parquet completo, no escribe imágenes en disco,
 * y no inventa ningún campo comercial. Ver `normalize.ts` y `registry.ts`.
 */
import { randomUUID } from "node:crypto";

import { getStorageConfig, isPersistentStorage } from "@/lib/mediaStorage";
import type { CatalogStore } from "../catalog/store";
import { getStore } from "../catalog/store";
import { ingestProduct } from "../catalog/ingest";
import {
  emptyJobProgress,
  hydrateJobProgress,
  type JobRecord,
  type JobStatus,
} from "../catalog/types";
import { getEmbeddingProvider } from "../embeddings/index";
import { createJobLogger, type JobLogger } from "../observability/jobLog";
import { prepareDatasetImage } from "./images";
import { matchesFilters, normalizeDatasetRow } from "./normalize";
import { getReaderWithFallback, type DatasetReader } from "./reader";
import { DEFAULT_DATASET_ID, getDataset } from "./registry";
import type {
  CatalogDatasetImporter,
  DatasetImportCheckpoint,
  DatasetImportCounters,
  DatasetImportOptions,
  DatasetImportResult,
  DatasetInfo,
  FashionDatasetRow,
} from "./types";

function emptyCounters(): DatasetImportCounters {
  return {
    rowsRead: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    duplicates: 0,
    skipped: 0,
    errors: 0,
    imagesUploaded: 0,
    imagesSkipped: 0,
    embeddingsReady: 0,
    embeddingsQueued: 0,
    embeddingsFailed: 0,
  };
}

/** Defaults, con las variables de entorno como fuente de configuración. */
export function resolveOptions(
  partial: Partial<DatasetImportOptions> = {},
  env: NodeJS.ProcessEnv = process.env
): DatasetImportOptions {
  const envInt = (name: string, fallback: number): number => {
    const raw = Number(env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
  };
  const envBool = (name: string, fallback: boolean): boolean => {
    const raw = env[name]?.trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
    return fallback;
  };

  const source =
    partial.source ??
    (env.CATALOG_DATASET_SOURCE?.trim() === "kaggle" ? "kaggle" : "huggingface");

  return {
    source,
    limit: partial.limit ?? envInt("CATALOG_DATASET_DEFAULT_LIMIT", 1000),
    offset: partial.offset ?? 0,
    // El lote se acota a 100 porque es el máximo del endpoint /rows de
    // HuggingFace: pedir más devolvería 422 y no aceleraría nada.
    batchSize: Math.min(partial.batchSize ?? envInt("CATALOG_DATASET_BATCH_SIZE", 25), 100),
    categories: partial.categories ?? [],
    genders: partial.genders ?? [],
    generateEmbeddings:
      partial.generateEmbeddings ?? envBool("CATALOG_DATASET_GENERATE_EMBEDDINGS", true),
    uploadImages: partial.uploadImages ?? envBool("CATALOG_DATASET_UPLOAD_IMAGES", true),
    dryRun: partial.dryRun ?? false,
    datasetId: partial.datasetId ?? DEFAULT_DATASET_ID,
  };
}

/**
 * Filas procesadas a la vez dentro de un lote.
 *
 * Medido: en serie, importar 100 fichas tardó 236 s — 2,4 s por ficha — con
 * CLIP costando solo 37 ms. El resto era latencia de red en serie: descargar la
 * imagen de HuggingFace, subirla al storage y tres o cuatro viajes a Neon (que
 * está en eu-central-1). Trabajo dominado por I/O, no por CPU, así que se
 * solapa.
 *
 * Se queda en 6 a propósito y no más: por encima, Neon empieza a rechazar
 * conexiones (el pool es de 5 por proceso) y HuggingFace responde 429.
 */
const ROW_CONCURRENCY = 6;

/** Ejecuta `worker` sobre los items con concurrencia acotada. Nunca lanza. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export interface ImporterDeps {
  store?: CatalogStore;
  /**
   * Lector del dataset. Se inyecta para poder probar la idempotencia, la
   * reanudación y la tolerancia a filas corruptas sin depender de HuggingFace:
   * ninguna de esas propiedades tiene que ver con la red, y hacerlas depender de
   * ella daría tests lentos, frágiles y sujetos a que un dataset externo no
   * cambie. En producción se omite y se resuelve por el registro.
   */
  reader?: DatasetReader;
  /** Callback de progreso: lo usa el job para persistir el checkpoint. */
  onProgress?: (update: {
    counters: DatasetImportCounters;
    nextOffset: number;
    endOffset: number;
    stage: JobStatus;
  }) => Promise<void> | void;
  /** Cancelación cooperativa: se consulta entre lotes. */
  isCancelled?: () => boolean | Promise<boolean>;
  /** Presupuesto de tiempo. Al agotarse se para limpio con checkpoint. */
  deadline?: number;
  jobId?: string;
}

export class DatasetImporter implements CatalogDatasetImporter {
  constructor(private readonly deps: ImporterDeps = {}) {}

  async inspect(datasetId?: string): Promise<DatasetInfo> {
    if (this.deps.reader) return this.deps.reader.inspect();
    const descriptor = getDataset(datasetId);
    const preferred = resolveOptions({ datasetId }).source;
    const { info } = await getReaderWithFallback(descriptor, preferred);
    return info;
  }

  async import(partial: Partial<DatasetImportOptions> = {}): Promise<DatasetImportResult> {
    const options = resolveOptions(partial);
    const jobId = this.deps.jobId ?? randomUUID();
    return this.run({ jobId, options, startOffset: options.offset, counters: emptyCounters() });
  }

  /**
   * Reanuda un import desde su checkpoint persistido. Se lee del job, no de
   * ningún fichero: si el proceso murió a mitad, el checkpoint que vale es el
   * que llegó a la base de datos.
   */
  async resume(jobId: string): Promise<DatasetImportResult> {
    const store = this.deps.store ?? (await getStore());
    const job = await store.getJob(jobId);
    if (!job) throw new Error(`Job desconocido: ${jobId}`);
    if (job.type !== "dataset_import") {
      throw new Error(`El job ${jobId} es de tipo ${job.type}, no dataset_import.`);
    }
    const checkpoint = job.checkpoint as unknown as DatasetImportCheckpoint | undefined;
    if (!checkpoint?.options) {
      throw new Error(`El job ${jobId} no tiene checkpoint reanudable.`);
    }
    const counters = { ...emptyCounters(), ...(checkpoint.counters ?? {}) };
    // El rango restante se recalcula desde el checkpoint: reanudar no debe
    // volver a importar lo que ya está ni pasarse del límite original.
    const remaining = Math.max(0, checkpoint.endOffset - checkpoint.nextOffset);
    return this.run({
      jobId,
      options: { ...checkpoint.options, offset: checkpoint.nextOffset, limit: remaining },
      startOffset: checkpoint.nextOffset,
      counters,
      resumed: true,
    });
  }

  private async run(context: {
    jobId: string;
    options: DatasetImportOptions;
    startOffset: number;
    counters: DatasetImportCounters;
    resumed?: boolean;
  }): Promise<DatasetImportResult> {
    const { jobId, options } = context;
    const startedAt = Date.now();
    const descriptor = getDataset(options.datasetId);
    const log = createJobLogger(jobId, `dataset:${descriptor.id}`);
    const counters = context.counters;
    const warnings: string[] = [];
    const errors: DatasetImportResult["errors"] = [];
    const preview: DatasetImportResult["preview"] = [];

    log.info("job", `Importación de dataset ${descriptor.id}`, {
      metadata: {
        repo: descriptor.repo,
        limit: options.limit,
        offset: options.offset,
        batchSize: options.batchSize,
        dryRun: options.dryRun,
        uploadImages: options.uploadImages,
        generateEmbeddings: options.generateEmbeddings,
        resumed: context.resumed === true,
      },
    });

    if (options.limit <= 0) {
      log.success("complete", "Nada que importar: el rango pedido está vacío.");
      return this.result({
        jobId, descriptor, options, counters, warnings, errors, preview,
        status: options.dryRun ? "dry_run" : "completed",
        nextOffset: context.startOffset, startedAt,
      });
    }

    // --- Comprobaciones previas, con avisos honestos ---------------------
    const storageConfig = getStorageConfig();
    if (options.uploadImages && !options.dryRun && !isPersistentStorage(storageConfig)) {
      // No se aborta: una importación de solo metadatos sigue siendo útil. Pero
      // se dice claramente que las imágenes NO van a sobrevivir, en vez de
      // dejar un catálogo que parece completo y se queda sin fotos.
      warnings.push(
        `El storage configurado ("${storageConfig.provider}") no es persistente. ` +
          "Las imágenes no sobrevivirán a un reinicio. Configura " +
          "STORAGE_PROVIDER=vercel_blob con BLOB_READ_WRITE_TOKEN."
      );
      log.warn("job", warnings[warnings.length - 1]);
    }

    log.info("dataset", "Cargando metadata del dataset");
    let reader: DatasetReader;
    let info: DatasetInfo;
    try {
      const resolved = this.deps.reader
        ? {
            reader: this.deps.reader,
            info: await this.deps.reader.inspect(),
            fellBack: false,
          }
        : await getReaderWithFallback(descriptor, options.source);
      reader = resolved.reader;
      info = resolved.info;
      if (resolved.fellBack) {
        warnings.push(
          `La fuente ${options.source} no respondió: se ha usado ${resolved.reader.provider}.`
        );
        log.warn("dataset", warnings[warnings.length - 1]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("dataset", `No se pudo abrir el dataset: ${message}`);
      return this.result({
        jobId, descriptor, options, counters, warnings, errors, preview,
        status: "failed", nextOffset: context.startOffset, startedAt,
      });
    }

    log.success("dataset", `Dataset alcanzable vía ${reader.provider}`, {
      metadata: {
        totalRows: info.totalRows,
        version: info.version,
        features: Object.keys(info.features).length,
      },
    });

    const embeddingProvider = options.generateEmbeddings
      ? await getEmbeddingProvider()
      : null;
    if (embeddingProvider) {
      const productionGrade = embeddingProvider.name !== "hash";
      log.info("embedding", `Proveedor de embeddings: ${embeddingProvider.name}`, {
        metadata: {
          model: embeddingProvider.model,
          dimension: embeddingProvider.dimension(),
          productionGrade,
        },
      });
      if (!productionGrade) {
        // El proveedor `hash` es un dHash de 64 bits más un histograma. No es un
        // embedding semántico y presentarlo como tal haría creer que el
        // matching visual funciona cuando su recall es malo.
        warnings.push(
          "Los embeddings se han generado con el proveedor `hash` (dHash 64d + " +
            "histograma), que NO es un embedding visual semántico. Para matching " +
            "real usa CATALOG_IMAGE_EMBEDDING_PROVIDER=local (CLIP)."
        );
        log.warn("embedding", warnings[warnings.length - 1]);
      }
    }

    const endOffset = context.startOffset + options.limit;
    const store = options.dryRun ? null : this.deps.store ?? (await getStore());

    // --- Bucle principal por lotes --------------------------------------
    let nextOffset = context.startOffset;
    let cancelled = false;
    let timedOut = false;
    let batch: FashionDatasetRow[] = [];

    const flush = async (): Promise<void> => {
      if (batch.length === 0) return;
      const from = counters.rowsRead - batch.length + 1;
      log.info(
        "job",
        `Procesando ${from}–${counters.rowsRead} de ${options.limit}`,
        { metadata: { batch: batch.length } }
      );
      // Las filas del lote se solapan: son independientes entre sí (cada una
      // tiene su propio id de dataset, así que dos nunca compiten por la misma
      // clave de upsert) y el trabajo es puro I/O.
      const rows = batch;
      batch = [];
      await mapWithConcurrency(rows, ROW_CONCURRENCY, (row) =>
        this.processRow({
          row, descriptor, info, reader, store, options, counters,
          errors, preview, log, embeddingProvider,
        })
      );
      await this.deps.onProgress?.({
        counters,
        nextOffset,
        endOffset,
        stage: "saving",
      });
    };

    try {
      for await (const row of reader.streamRows({
        offset: context.startOffset,
        limit: options.limit,
        pageSize: Math.max(options.batchSize, 50),
      })) {
        // El offset avanza con la fila LEÍDA, no con la guardada: las filas
        // filtradas o corruptas también quedan atrás y no deben releerse al
        // reanudar.
        nextOffset = row.rowIndex + 1;
        counters.rowsRead += 1;

        if (!matchesFilters(row, options)) {
          counters.skipped += 1;
          continue;
        }
        batch.push(row);

        if (batch.length >= options.batchSize) {
          await flush();
          if (await this.shouldStop()) {
            cancelled = true;
            break;
          }
          if (this.pastDeadline()) {
            timedOut = true;
            break;
          }
        }
      }
      if (!cancelled && !timedOut) await flush();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error("job", `La importación se ha interrumpido: ${message}`);
      errors.push({ rowIndex: nextOffset, sourceProductId: null, message });
      // Lo ya procesado se conserva: se devuelve parcial con su checkpoint, que
      // es lo que permite reanudar en vez de repetir desde cero.
      await flush().catch(() => undefined);
      return this.result({
        jobId, descriptor, options, counters, warnings, errors, preview,
        status: "partially_completed", nextOffset, startedAt,
      });
    }

    let status: DatasetImportResult["status"];
    if (options.dryRun) status = "dry_run";
    else if (cancelled) status = "cancelled";
    else if (timedOut || counters.errors > 0) status = "partially_completed";
    else status = "completed";

    if (timedOut) {
      warnings.push(
        `Se agotó el presupuesto de tiempo en la fila ${nextOffset}. ` +
          `Reanuda con: npm run catalog:dataset:resume -- ${jobId}`
      );
      log.warn("job", warnings[warnings.length - 1]);
    }

    log.success(
      "complete",
      `${counters.created} creados · ${counters.updated} actualizados · ` +
        `${counters.unchanged} sin cambios · ${counters.skipped} omitidos · ` +
        `${counters.errors} errores`,
      { metadata: { ...counters } }
    );

    return this.result({
      jobId, descriptor, options, counters, warnings, errors, preview,
      status, nextOffset, startedAt,
    });
  }

  /** Una fila: imagen -> embedding -> upsert. Nunca lanza. */
  private async processRow(ctx: {
    row: FashionDatasetRow;
    descriptor: ReturnType<typeof getDataset>;
    info: DatasetInfo;
    reader: DatasetReader;
    store: CatalogStore | null;
    options: DatasetImportOptions;
    counters: DatasetImportCounters;
    errors: DatasetImportResult["errors"];
    preview: DatasetImportResult["preview"];
    log: JobLogger;
    embeddingProvider: Awaited<ReturnType<typeof getEmbeddingProvider>> | null;
  }): Promise<void> {
    const { row, descriptor, options, counters, log } = ctx;
    const sourceProductId = String(row.id);

    try {
      // 1. Imagen. Una fila sin imagen utilizable se omite: el objetivo del
      //    dataset es el matching VISUAL, y una ficha sin foto no sirve.
      let prepared: Awaited<ReturnType<typeof prepareDatasetImage>> | null = null;
      if (row.imageUrl) {
        const downloaded = await ctx.reader.loadImage(row);
        if (!downloaded) {
          counters.errors += 1;
          ctx.errors.push({
            rowIndex: row.rowIndex,
            sourceProductId,
            message: "no se pudo descargar la imagen",
          });
          log.warn("download_image", `Imagen no descargable, fila omitida`, {
            productId: sourceProductId,
          });
          return;
        }
        prepared = await prepareDatasetImage({
          buffer: downloaded.buffer,
          descriptor,
          sourceProductId,
          originUrl: row.imageUrl,
          // En dry run no se sube nada, pero sí se valida y se hashea: es la
          // única forma de que el ensayo detecte imágenes corruptas.
          uploadImages: options.uploadImages && !options.dryRun,
        });
        if (!prepared.ok) {
          counters.errors += 1;
          ctx.errors.push({
            rowIndex: row.rowIndex,
            sourceProductId,
            message: prepared.reason,
          });
          log.warn("download_image", `Imagen corrupta, omitida: ${prepared.reason}`, {
            productId: sourceProductId,
          });
          return;
        }
        if (prepared.prepared.uploaded) {
          if (prepared.prepared.alreadyExisted) counters.imagesSkipped += 1;
          else {
            counters.imagesUploaded += 1;
            log.success("download_image", `${sourceProductId}.jpg subida`, {
              productId: sourceProductId,
              metadata: { url: prepared.prepared.image.url },
            });
          }
        }
      } else {
        counters.skipped += 1;
        log.warn("normalize", "Fila sin imagen, omitida", { productId: sourceProductId });
        return;
      }

      // 2. Embedding. Se genera aquí, con la imagen aún en memoria, o se encola.
      let imageEmbedding: number[] | null = null;
      let embeddingStatus: "pending" | "ready" | "failed" | "skipped" = "pending";
      let embeddingProviderName: string | null = null;
      let embeddingDimension: number | null = null;

      if (!options.uploadImages) {
        // Sin imagen persistida no hay forma de reindexar después: marcarlo
        // `pending` sería mentir sobre algo que nunca se va a poder procesar.
        embeddingStatus = "skipped";
      } else if (ctx.embeddingProvider && prepared?.ok) {
        try {
          imageEmbedding = await ctx.embeddingProvider.embedImage(prepared.prepared.optimized);
          embeddingProviderName = ctx.embeddingProvider.name;
          embeddingDimension = imageEmbedding.length;
          embeddingStatus = "ready";
          counters.embeddingsReady += 1;
        } catch (error) {
          embeddingStatus = "failed";
          counters.embeddingsFailed += 1;
          log.warn(
            "embedding",
            `Embedding fallido: ${error instanceof Error ? error.message : String(error)}`,
            { productId: sourceProductId }
          );
        }
      } else {
        counters.embeddingsQueued += 1;
        log.info("embedding", "Encolado", { productId: sourceProductId });
      }

      // 3. Normalización.
      const { product } = normalizeDatasetRow({
        row,
        descriptor,
        version: ctx.info.version,
        provider: ctx.reader.provider,
        image: prepared?.ok ? prepared.prepared.image : null,
        embedding: {
          imageEmbedding,
          provider: embeddingProviderName,
          dimension: embeddingDimension,
          status: embeddingStatus,
        },
      });

      if (options.dryRun || !ctx.store) {
        // Se guarda una muestra acotada: un dry run de 1.000 no debe devolver
        // 1.000 fichas completas por la API.
        if (ctx.preview.length < 10) ctx.preview.push(product);
        counters.created += 1;
        return;
      }

      // 4. Persistencia por la puerta única del catálogo. `exactDedupOnly`
      //    porque el id del dataset es autoritativo: ver FindDuplicateOptions.
      const result = await ingestProduct(ctx.store, product, {
        origin: "dataset_demo",
        exactDedupOnly: true,
      });

      if (result.isNew) {
        counters.created += 1;
        log.success("database", `Producto ${sourceProductId} creado`, {
          productId: result.product.id,
        });
      } else if (result.deduplicated) {
        counters.duplicates += 1;
      } else if (result.changed) {
        counters.updated += 1;
        log.info("database", `Producto ${sourceProductId} actualizado`, {
          productId: result.product.id,
        });
      } else {
        // Existía y no ha cambiado: solo se ha refrescado lastSeenAt. Contarlo
        // como "actualizado" haría que una reimportación idéntica pareciera
        // haber reescrito mil fichas.
        counters.unchanged += 1;
      }
    } catch (error) {
      counters.errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      ctx.errors.push({ rowIndex: row.rowIndex, sourceProductId, message });
      log.error("database", `Fila ${row.rowIndex} fallida: ${message}`, {
        productId: sourceProductId,
      });
    }
  }

  private async shouldStop(): Promise<boolean> {
    if (!this.deps.isCancelled) return false;
    return (await this.deps.isCancelled()) === true;
  }

  private pastDeadline(): boolean {
    return this.deps.deadline != null && Date.now() >= this.deps.deadline;
  }

  private result(args: {
    jobId: string;
    descriptor: ReturnType<typeof getDataset>;
    options: DatasetImportOptions;
    counters: DatasetImportCounters;
    warnings: string[];
    errors: DatasetImportResult["errors"];
    preview: DatasetImportResult["preview"];
    status: DatasetImportResult["status"];
    nextOffset: number;
    startedAt: number;
  }): DatasetImportResult {
    return {
      jobId: args.jobId,
      datasetId: args.descriptor.id,
      status: args.status,
      counters: args.counters,
      durationMs: Date.now() - args.startedAt,
      nextOffset: args.nextOffset,
      dryRun: args.options.dryRun,
      preview: args.preview,
      // Los errores se acotan: un job con 900 fallos no debe guardar 900
      // mensajes en el `doc` del job ni devolverlos por la API.
      errors: args.errors.slice(0, 50),
      warnings: args.warnings,
    };
  }
}

/** Construye el checkpoint que se persiste en el job tras cada lote. */
export function buildCheckpoint(args: {
  options: DatasetImportOptions;
  counters: DatasetImportCounters;
  nextOffset: number;
  endOffset: number;
  version: string;
}): DatasetImportCheckpoint {
  return {
    datasetId: args.options.datasetId ?? DEFAULT_DATASET_ID,
    options: args.options,
    nextOffset: args.nextOffset,
    endOffset: args.endOffset,
    counters: args.counters,
    version: args.version,
  };
}

/** Progreso del job a partir de los contadores del importador. */
export function countersToProgress(
  counters: DatasetImportCounters,
  stage: string | null,
  discovered: number
): JobRecord["progress"] {
  return {
    ...emptyJobProgress(),
    discovered,
    fetched: counters.rowsRead,
    new: counters.created,
    updated: counters.updated,
    duplicates: counters.duplicates,
    errors: counters.errors,
    // Las filas sin cambios se leyeron y se procesaron, así que cuentan como
    // procesadas para la barra de progreso; van con las omitidas y no con las
    // actualizadas, que ahora significa "cambió de verdad".
    ignored: counters.skipped + counters.unchanged,
    imagesUploaded: counters.imagesUploaded,
    imagesSkipped: counters.imagesSkipped,
    embeddingsReady: counters.embeddingsReady,
    embeddingsQueued: counters.embeddingsQueued,
    // El dataset no usa IA ni navegador: se declara explícitamente en cero en
    // vez de dejar los contadores a medias.
    withAi: 0,
    withoutAi: counters.created + counters.updated,
    withBrowser: 0,
    stage,
  };
}

export { hydrateJobProgress };
