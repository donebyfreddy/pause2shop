import { randomUUID } from "node:crypto";
import { Router, ApiError, sendJson, type RequestContext } from "./router";
import type { CatalogStore } from "../catalog/store";
import { emptyExtractionStats } from "../catalog/store";
import type { CatalogProduct, JobRecord, NormalizedProduct } from "../catalog/types";
import {
  hydrateJobProgress,
  isActiveJobStatus,
  isTerminalJobStatus,
} from "../catalog/types";
import { getQueue } from "../jobs/queue";
import {
  canSync,
  connectorRegistrySummary,
  getConnector,
  listConnectors,
  syncableConnectorIds,
} from "../connectors/registry";
import {
  BaseConnector,
  type CatalogConnector,
  type ConnectorHealth,
} from "../connectors/base/BaseConnector";
import type { ConnectorHealthState } from "../connectors/base/types";
import { matchProducts, type ProductMatch } from "../catalog/matching";
import { ingestProduct } from "../catalog/ingest";
import { processImageBuffer, downloadAndProcessImage, type ProcessedImage } from "../images/processor";
import { getEmbeddingProvider } from "../embeddings/index";
import {
  getMetrics,
  ingestThroughput,
  uptimeSeconds,
  recordProviderUsage,
} from "../observability/metrics";
import { logLevelCounts, queryLogs, type LogLevel } from "../observability/logRing";
import {
  currentSeq,
  jobLogSummary,
  JOB_STAGES,
  queryJobLogs,
  type JobLogLevel,
  type JobStage,
} from "../observability/jobLog";
import { EFFECTIVE_STATUS_LABEL, effectiveStatus } from "../connectors/base/types";
import { getPlaywrightService } from "../browser/playwrightService";
import { aiUnavailableReason, getScraperConfig } from "../config/scraper";
import { bootstrapIngestion, bootstrapReport } from "../bootstrap";
import { getConfig } from "../config/index";
import { isDatabaseConfigured } from "../database/pool";
import { computeContentHash, normalizeAvailability, normalizeCategory } from "../normalization/normalize";

/**
 * Rutas del contrato CATALOG_API_CONTRACT.md — las formas de respuesta se
 * implementan al pie de la letra: pause2shop consume estos campos tal cual.
 */

// Caché de healthChecks live: comprobar la tienda en cada GET /connectors
// sería lento y descortés. Por defecto NO se hace la petición live (así los
// tests corren sin red); ?health=live fuerza la comprobación real.
const healthCache = new Map<string, ConnectorHealth>();
const HEALTH_TTL_MS = 10 * 60 * 1000;

/**
 * ¿Es una ficha de dataset de demostración? Estas NO tienen URL de compra: su
 * `canonicalUrl` es un URI `dataset://` interno y no navegable.
 */
function isDemo(p: CatalogProduct): boolean {
  return p.origin === "dataset_demo";
}

/**
 * URL de compra, o null si no existe.
 *
 * Devolver `canonicalUrl` a secas era seguro mientras todo el catálogo venía de
 * tiendas reales. Con las fichas de dataset dejaría de serlo: su canonicalUrl es
 * `dataset://…`, y un cliente que la use para pintar "Comprar" produce un enlace
 * roto. Se anula en el contrato, no en cada consumidor, para que no dependa de
 * que cada UI se acuerde.
 */
function purchaseUrl(p: CatalogProduct): string | null {
  return isDemo(p) ? null : p.canonicalUrl;
}

function toMatchPayload(m: ProductMatch) {
  const p = m.product;
  return {
    productId: p.id,
    title: p.title,
    brand: p.brand,
    image: p.primaryImage ?? p.images[0]?.url ?? null,
    productUrl: purchaseUrl(p),
    price: p.price,
    currency: p.currency,
    availability: p.availability,
    visualScore: round(m.visualScore),
    textScore: round(m.textScore),
    attributeScore: round(m.attributeScore),
    finalScore: round(m.finalScore),
    source: "catalog" as const,
    matchStage: m.matchStage,
    origin: p.origin,
    isDemoProduct: isDemo(p),
    /** Procedencia del dataset, para poder citarla en la UI. */
    dataset: p.dataset,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Ficha pública sin embeddings (son enormes y no le sirven al cliente). */
function toProductPayload(p: CatalogProduct) {
  const { imageEmbedding, textEmbedding, ...rest } = p;
  return {
    ...rest,
    hasImageEmbedding: imageEmbedding != null,
    hasTextEmbedding: textEmbedding != null,
    isDemoProduct: isDemo(p),
    productUrl: purchaseUrl(p),
    /**
     * Atributos del dataset que no tienen columna propia en el catálogo. Se
     * exponen aparte para que el admin los pinte sin tener que bucear en
     * `sourceMetadata.raw`.
     */
    datasetAttributes: isDemo(p)
      ? {
          masterCategory:
            (p.sourceMetadata?.raw as Record<string, unknown> | undefined)?.masterCategory ?? null,
          articleType:
            (p.sourceMetadata?.raw as Record<string, unknown> | undefined)?.articleType ?? null,
          season: (p.sourceMetadata?.raw as Record<string, unknown> | undefined)?.season ?? null,
          year: (p.sourceMetadata?.raw as Record<string, unknown> | undefined)?.year ?? null,
          usage: (p.sourceMetadata?.raw as Record<string, unknown> | undefined)?.usage ?? null,
          baseColour:
            (p.sourceMetadata?.raw as Record<string, unknown> | undefined)?.baseColour ?? null,
        }
      : null,
  };
}

function toJobPayload(job: JobRecord) {
  const progress = hydrateJobProgress(job.progress);
  const total = progress.discovered;
  const done = progress.new + progress.updated + progress.duplicates + progress.errors + progress.ignored;
  const elapsedMinutes = job.durationMs > 0 ? job.durationMs / 60000 : 0;
  return {
    jobId: job.jobId,
    type: job.type,
    source: job.source,
    mode: job.mode,
    status: job.status,
    progress,
    checkpoint: job.checkpoint,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs,
    errors: job.errors.map((e) => ({ url: e.url, message: e.message })),
    // Derivados para la barra de progreso del admin. Se calculan aquí para que
    // el cliente no reimplemente (y desincronice) la aritmética.
    stage: progress.stage,
    processed: done,
    percent: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null,
    productsPerMinute: elapsedMinutes > 0 ? Math.round((done / elapsedMinutes) * 10) / 10 : null,
    aiRatio: progress.fetched > 0 ? Math.round((progress.withAi / progress.fetched) * 100) / 100 : null,
    /**
     * Índice del checkpoint: dice exactamente por dónde se reanudaría. Los
     * syncs lo guardan como `index` y las importaciones de dataset como
     * `nextOffset` (una fila del split); se normaliza a un solo campo para que
     * el admin no tenga que saber de qué tipo de job viene.
     */
    resumeIndex:
      typeof job.checkpoint.index === "number"
        ? job.checkpoint.index
        : typeof job.checkpoint.nextOffset === "number"
          ? job.checkpoint.nextOffset
          : null,
    isActive: isActiveJobStatus(job.status),
    isTerminal: isTerminalJobStatus(job.status),
  };
}

/** Procesa la imagen de la query (base64 o URL) para la cascada de matching. */
async function processQueryImage(body: any): Promise<ProcessedImage | null> {
  if (body?.imageBase64) {
    let buf: Buffer;
    try {
      buf = Buffer.from(String(body.imageBase64), "base64");
    } catch {
      throw new ApiError(400, "invalid_image", "imageBase64 no es base64 válido");
    }
    try {
      return await processImageBuffer(buf);
    } catch (err) {
      throw new ApiError(400, "invalid_image", err instanceof Error ? err.message : "imagen inválida");
    }
  }
  if (body?.imageUrl) {
    const processed = await downloadAndProcessImage(String(body.imageUrl));
    if (!processed) throw new ApiError(422, "image_unreachable", `no se pudo descargar/procesar ${body.imageUrl}`);
    return processed;
  }
  return null;
}

export function buildRouter(store: CatalogStore): Router {
  const router = new Router();
  const queue = getQueue(store);

  /* ------------------------------ health ------------------------------ */

  router.add("GET", "/health", async ({ res }) => {
    const provider = await getEmbeddingProvider();
    const products = await store.countProducts();
    // dimension() del provider hash es fija; la del local se conoce tras el
    // warmup del init — nunca la hardcodeamos.
    sendJson(res, 200, {
      status: "ok",
      db: store.backend,
      embeddings: {
        provider: provider.name,
        model: provider.model,
        dimension: provider.dimension(),
      },
      products,
      uptimeSeconds: uptimeSeconds(),
    });
  }, { auth: false });

  /* ---------------------------- connectors ---------------------------- */

  /**
   * Estado de un conector combinando los dos ejes: `lifecycle` (madurez de la
   * implementación, declarada) y `health` (estado operativo, medido).
   *
   * `live` se aplica SOLO a conectores sincronizables: hacer 40 peticiones a 40
   * tiendas en cada carga del admin sería descortés y lento. Para el resto se
   * devuelve la última medición cacheada, o `not_checked` si nunca se midió.
   */
  /**
   * Estados y recuentos de TODAS las fuentes en 2 queries.
   *
   * Antes cada `describeConnector` hacía `getSourceState` + `countProducts` del
   * conector: con 68 fuentes, 136 round trips por petición a través de un pool
   * de 5 conexiones. Contra un Postgres local (~1 ms) pasaba desapercibido;
   * contra Neon (cientos de ms por query) la landing tardaba 15-25 s.
   */
  const prefetchSourceData = async () => {
    const [states, counts, extraction, jobs] = await Promise.all([
      store.getAllSourceStates(),
      store.countProductsBySource(),
      store.extractionStatsBySource(),
      // `listJobs` NO depende del conector: antes se llamaba con los mismos
      // argumentos 68 veces y se filtraba en JS. Una vez y se agrupa aquí.
      store.listJobs(100),
    ]);
    const jobsBySource = new Map<string, typeof jobs>();
    for (const j of jobs) {
      if (!j.source) continue;
      const bucket = jobsBySource.get(j.source);
      if (bucket) bucket.push(j);
      else jobsBySource.set(j.source, [j]);
    }
    return { states, counts, extraction, jobsBySource };
  };

  type SourceData = Awaited<ReturnType<typeof prefetchSourceData>>;

  const describeConnector = async (
    c: CatalogConnector,
    live: boolean,
    /** Datos ya leídos en bloque. Si no se pasan, se leen solo para este id. */
    prefetched?: SourceData
  ) => {
    const meta = c.metadata;
    const state = prefetched
      ? prefetched.states.get(c.id) ?? { id: c.id, paused: false, lastSyncAt: null }
      : await store.getSourceState(c.id);
    const productCount = prefetched
      ? prefetched.counts.get(c.id) ?? 0
      : await store.countProducts(c.id);

    let health: ConnectorHealthState;
    let note: string;
    let checkedAt: string | null = null;

    if (state.paused) {
      health = "paused";
      note = "pausado desde el admin";
    } else if (meta.implementation === "scaffold") {
      health = "not_checked";
      note = meta.notes;
    } else if (c instanceof BaseConnector && c.isCircuitOpen()) {
      health = "error";
      note = "circuit breaker abierto por fallos consecutivos";
    } else {
      const cached = healthCache.get(c.id);
      const isFresh =
        cached && Date.now() - new Date(cached.checkedAt).getTime() < HEALTH_TTL_MS;
      let measured: ConnectorHealth | null = isFresh ? cached : null;
      if (!measured && live && meta.canSync) {
        measured = await c.healthCheck();
        healthCache.set(c.id, measured);
      }
      if (measured) {
        health = measured.status;
        note = measured.note;
        checkedAt = measured.checkedAt;
      } else {
        health = "not_checked";
        note = "estado live no comprobado en esta sesión (usa ?health=live o «Probar conector»)";
      }
    }

    // Estadísticas de extracción reales: es lo que responde "¿cuánto de esta
    // fuente ha necesitado IA?" con datos de la base, no con una impresión.
    const extraction = prefetched
      ? prefetched.extraction.get(c.id) ?? emptyExtractionStats()
      : await store.extractionStats(c.id);

    // `verifiedLive` NO se declara: se demuestra. Solo es cierto si esta
    // fuente tiene productos reales en el catálogo extraídos por el pipeline.
    const verifiedLive = extraction.total > 0;
    const status = effectiveStatus(c.spec, health, { paused: state.paused, verifiedLive });

    const recentJobs = prefetched
      ? prefetched.jobsBySource.get(c.id) ?? []
      : (await store.listJobs(100)).filter((j) => j.source === c.id);
    const lastError =
      recentJobs.flatMap((j) => j.errors).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

    return {
      ...meta,
      // `status` se conserva por compatibilidad con el contrato original.
      status: state.paused ? "paused" : health,
      health,
      /** Los OCHO estados honestos: es el que muestra el admin. */
      effectiveStatus: status,
      effectiveStatusLabel: EFFECTIVE_STATUS_LABEL[status],
      /** ¿Se ha demostrado que extrae productos reales de esta tienda? */
      verifiedLive,
      paused: state.paused,
      note,
      healthCheckedAt: checkedAt,
      crawlDelaySeconds: healthCache.get(c.id)?.crawlDelaySeconds ?? null,
      lastSyncAt: state.lastSyncAt,
      productCount,
      extraction,
      lastError: lastError ? { message: lastError.message, url: lastError.url, at: lastError.at } : null,
      missingEnv: meta.requiresEnv.filter((k) => !process.env[k]),
    };
  };

  router.add("GET", "/connectors", async ({ res, query }) => {
    const live = query.get("health") === "live";
    const sourceData = await prefetchSourceData();
    const connectors = await Promise.all(
      listConnectors().map((c) => describeConnector(c, live, sourceData))
    );
    sendJson(res, 200, {
      connectors,
      summary: connectorRegistrySummary(),
      syncable: syncableConnectorIds(),
    });
  });

  /**
   * Estado del SUBSISTEMA de scraping: qué está disponible de verdad ahora
   * mismo (IA, navegador, persistencia de logs) y por qué no lo que falte.
   * El admin lo muestra literal en vez de suponer que todo funciona.
   */
  router.add("GET", "/scraper/status", async ({ res }) => {
    const config = getScraperConfig();
    const playwright = getPlaywrightService();
    const bootstrap = bootstrapReport() ?? (await bootstrapIngestion());
    // El motivo de indisponibilidad del navegador cuesta un lanzamiento: solo
    // se comprueba si está habilitado, y el resultado queda cacheado dentro.
    const browserReason = config.playwrightEnabled ? await playwright.unavailableReason() : "desactivado";

    sendJson(res, 200, {
      ai: {
        enabled: config.aiEnabled,
        model: config.aiModel,
        unavailableReason: aiUnavailableReason(),
        maxHtmlChars: config.aiMaxHtmlChars,
        cachePersistent: bootstrap.aiCachePersistent,
        /** La clave NUNCA se devuelve: solo si está presente. */
        apiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
      },
      browser: {
        ...playwright.snapshot(),
        enabled: config.playwrightEnabled,
        headless: config.headless,
        unavailableReason: browserReason,
        remoteEndpointConfigured: Boolean(config.browserWsEndpoint),
        /**
         * Health MEDIDO: arranca un navegador de verdad y lo cierra. Es lo único
         * que distingue "configurado" de "funciona", y esa distinción es
         * exactamente la que faltaba cuando Vercel no encontraba browsers.json.
         */
        health: config.playwrightEnabled ? await playwright.browserHealth() : null,
      },
      limits: {
        maxConcurrency: config.maxConcurrency,
        requestDelayMs: config.requestDelayMs,
        navigationTimeoutMs: config.navigationTimeoutMs,
        maxRetries: config.maxRetries,
        batchSize: config.batchSize,
        maxProductsPerSource: config.maxProductsPerSource,
      },
      persistence: {
        catalogBackend: store.backend,
        jobLogsPersistent: bootstrap.jobLogsPersistent,
        productionGrade: store.backend === "postgres",
      },
      robotsPolicy: "respect",
      warnings: bootstrap.warnings,
    });
  }, { auth: false });

  /** Logs de ingesta por etapas, con filtros. */
  router.add("GET", "/scraper/logs", async ({ res, query }) => {
    const { entries, source } = await queryJobLogs({
      jobId: query.get("jobId") ?? undefined,
      connectorId: query.get("connector") ?? query.get("source") ?? undefined,
      level: (query.get("level") as JobLogLevel) ?? undefined,
      stage: (query.get("stage") as JobStage) ?? undefined,
      q: query.get("q") ?? undefined,
      afterSeq: query.get("afterSeq") ? Number(query.get("afterSeq")) : undefined,
      limit: Number(query.get("limit") ?? 200) || 200,
    });
    sendJson(res, 200, {
      logs: entries,
      source,
      stages: JOB_STAGES,
      summary: jobLogSummary(query.get("jobId") ?? undefined),
      cursor: currentSeq(),
    });
  });

  router.add("GET", "/connectors/:id", async ({ res, params, query }) => {
    const connector = getConnector(params.id);
    if (!connector) {
      throw new ApiError(404, "connector_not_found", `conector desconocido: ${params.id}`);
    }
    const detail = await describeConnector(connector, query.get("health") === "live");
    const jobs = (await store.listJobs(100)).filter((j) => j.source === params.id).slice(0, 10);
    sendJson(res, 200, {
      ...detail,
      recentJobs: jobs.map(toJobPayload),
      logs: queryLogs({ source: params.id, limit: 40 }),
    });
  });

  /** Comprobación live puntual de UN conector (petición real a la tienda). */
  router.add("POST", "/connectors/:id/health", async ({ res, params }) => {
    const connector = getConnector(params.id);
    if (!connector) {
      throw new ApiError(404, "connector_not_found", `conector desconocido: ${params.id}`);
    }
    const health = await connector.healthCheck();
    healthCache.set(params.id, health);
    sendJson(res, 200, { id: params.id, ...health });
  });

  /**
   * Prueba end-to-end del pipeline con UNA ficha. Es una petición real a la
   * tienda: el admin la dispara a mano, nunca en bucle.
   */
  router.add("POST", "/connectors/:id/test", async ({ res, params }) => {
    const connector = getConnector(params.id);
    if (!connector) {
      throw new ApiError(404, "connector_not_found", `conector desconocido: ${params.id}`);
    }
    const result = await connector.testConnector();
    sendJson(res, 200, { id: params.id, label: connector.label, ...result });
  });

  const setPaused = (paused: boolean) => async ({ res, params }: RequestContext) => {
    const connector = getConnector(params.id);
    if (!connector) throw new ApiError(404, "connector_not_found", `conector desconocido: ${params.id}`);
    const state = await store.getSourceState(params.id);
    await store.setSourceState({ ...state, paused });
    sendJson(res, 200, { id: params.id, status: paused ? "paused" : "resumed" });
  };
  router.add("POST", "/connectors/:id/pause", setPaused(true));
  router.add("POST", "/connectors/:id/resume", setPaused(false));

  /* ------------------------------- jobs ------------------------------- */

  router.add("POST", "/jobs/sync", async ({ res, body }) => {
    const source = body?.source;
    const mode = body?.mode === "incremental" ? "incremental" : "full";
    if (!source || !getConnector(source)) {
      throw new ApiError(400, "invalid_source", `source inválido: ${source}`);
    }
    if (!canSync(source)) {
      const meta = getConnector(source)!.metadata;
      const missing = meta.requiresEnv.filter((k) => !process.env[k]);
      throw new ApiError(
        422,
        "connector_pending",
        missing.length > 0
          ? `el conector ${source} necesita credenciales: ${missing.join(", ")}`
          : `el conector ${source} no tiene implementación activa (lifecycle: ${meta.lifecycle})`
      );
    }
    // Un `limit` explícito en el body es la vía de pruebas ("Zara, 3
    // productos"): se respeta tal cual, sin techo oculto. Si no se manda,
    // NO se sustituye por un límite bajo aquí — se deja `undefined` para que
    // `BaseConnector.syncProducts` use `SCRAPER_MAX_PRODUCTS_PER_SOURCE`
    // (0 = sin límite funcional). El job sigue siendo seguro en Vercel porque
    // se procesa por lotes (`batchSize`) y por presupuesto de tiempo, nunca de
    // golpe: el límite de productos y el límite de trabajo por invocación son
    // dos mecanismos distintos.
    const explicitLimit =
      typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
        ? Math.floor(body.limit)
        : undefined;
    const job = await queue.enqueue({
      type: mode === "full" ? "sync_full" : "sync_incremental",
      source,
      mode,
      limit: explicitLimit,
    });
    sendJson(res, 202, { jobId: job.jobId });
  });

  router.add("GET", "/jobs", async ({ res, query }) => {
    const limit = Math.min(Number(query.get("limit") ?? 20) || 20, 100);
    const statusFilter = query.get("status");
    const sourceFilter = query.get("source");
    // Pedimos con holgura al store para poder filtrar en memoria sin perder
    // resultados cuando hay filtros activos.
    const raw = await store.listJobs(statusFilter || sourceFilter ? 200 : limit);
    const jobs = raw
      .filter((j) => !statusFilter || j.status === statusFilter)
      .filter((j) => !sourceFilter || j.source === sourceFilter)
      .slice(0, limit);
    sendJson(res, 200, { jobs: jobs.map(toJobPayload), total: raw.length });
  });

  router.add("GET", "/jobs/:jobId", async ({ res, params }) => {
    const job = await store.getJob(params.jobId);
    if (!job) throw new ApiError(404, "job_not_found", `job desconocido: ${params.jobId}`);
    sendJson(res, 200, toJobPayload(job));
  });

  router.add("POST", "/jobs/:jobId/cancel", async ({ res, params }) => {
    const ok = await queue.cancel(params.jobId);
    if (!ok) throw new ApiError(409, "not_cancellable", "el job no existe o ya terminó");
    sendJson(res, 200, { jobId: params.jobId, cancelRequested: true });
  });

  /**
   * Reintento de un job fallido/parcial. Encola un `retry_failed` que reanuda
   * desde el checkpoint persistido del original: no se re-descubre el catálogo.
   */
  router.add("POST", "/jobs/:jobId/retry", async ({ res, params }) => {
    const original = await store.getJob(params.jobId);
    if (!original) throw new ApiError(404, "job_not_found", `job desconocido: ${params.jobId}`);
    if (!["failed", "partially_completed", "cancelled"].includes(original.status)) {
      throw new ApiError(
        409,
        "not_retryable",
        `el job está en estado ${original.status}: solo se reintentan failed, partially_completed o cancelled`
      );
    }
    const job = await queue.enqueue({
      type: "retry_failed",
      source: original.source,
      checkpoint: { retryOfJobId: original.jobId },
    });
    sendJson(res, 202, { jobId: job.jobId, retryOf: original.jobId });
  });

  /* ------------------------------ search ------------------------------ */

  router.add("POST", "/products/search/image", async ({ res, body }) => {
    if (!body?.imageBase64 && !body?.imageUrl) {
      throw new ApiError(400, "missing_image", "se requiere imageBase64 o imageUrl");
    }
    const img = await processQueryImage(body);
    const matches = await matchProducts(store, {
      imageSha256: img?.sha256,
      perceptualHash: img?.perceptualHash,
      imageEmbedding: img?.embedding,
      category: body.category ?? null,
      brand: body.brand ?? null,
      color: body.color ?? null,
      topK: body.topK,
      minScore: body.minScore,
    });
    sendJson(res, 200, { queryId: randomUUID(), matches: matches.map(toMatchPayload) });
  });

  router.add("POST", "/products/search/text", async ({ res, body }) => {
    if (!body?.query || typeof body.query !== "string") {
      throw new ApiError(400, "missing_query", "se requiere query (string)");
    }
    const matches = await matchProducts(store, {
      queryText: body.query,
      category: body.category ?? null,
      brand: body.brand ?? null,
      topK: body.topK,
      // En texto puro el default 0.82 (pensado para visual) sería demasiado
      // agresivo; el contrato permite minScore por petición.
      minScore: body.minScore ?? 0.35,
    });
    sendJson(res, 200, { queryId: randomUUID(), matches: matches.map(toMatchPayload) });
  });

  router.add("POST", "/products/search/hybrid", async ({ res, body }) => {
    if (!body?.imageBase64 && !body?.imageUrl && !body?.query) {
      throw new ApiError(400, "missing_input", "se requiere imagen (base64/url) y/o query");
    }
    const img = await processQueryImage(body);
    const matches = await matchProducts(store, {
      imageSha256: img?.sha256,
      perceptualHash: img?.perceptualHash,
      imageEmbedding: img?.embedding,
      queryText: body.query ?? null,
      category: body.category ?? null,
      brand: body.brand ?? null,
      color: body.color ?? null,
      topK: body.topK,
      minScore: body.minScore,
    });
    sendJson(res, 200, { queryId: randomUUID(), matches: matches.map(toMatchPayload) });
  });

  /* ----------------------------- products ----------------------------- */

  router.add("POST", "/products/reindex", async ({ res, body }) => {
    const b = (body ?? {}) as { source?: unknown; onlyMissing?: unknown };
    const source = typeof b.source === "string" && b.source.trim() ? b.source.trim() : null;
    const job = await queue.enqueue({
      type: "reindex_embeddings",
      source,
      checkpoint: { source, onlyMissing: b.onlyMissing === true },
    });
    sendJson(res, 202, { jobId: job.jobId });
  });

  /* ---------------------------- datasets ------------------------------ */

  /** Datasets registrados y qué campos trae cada uno. No toca la red. */
  router.add("GET", "/datasets", async ({ res }) => {
    const { listDatasets } = await import("../datasets/index");
    const { describeStorage } = await import("@/lib/mediaStorage");
    const storage = describeStorage();
    const counts = await store.countProductsBySource();
    sendJson(res, 200, {
      datasets: listDatasets().map((d) => ({
        id: d.id,
        repo: d.repo,
        originRepo: d.originRepo,
        provider: d.provider,
        license: d.license,
        split: d.split,
        availableFields: d.availableFields,
        unavailableFields: d.unavailableFields,
        importedProducts: counts.get(d.id) ?? 0,
      })),
      storage: {
        provider: storage.provider,
        persistent: !storage.ephemeral,
        // Se informa explícitamente: importar con storage efímero deja un
        // catálogo que se queda sin fotos, y eso hay que verlo ANTES.
        warning: storage.ephemeral
          ? "El storage no es persistente: las imágenes no sobrevivirán a un reinicio."
          : null,
      },
    });
  });

  /**
   * Comprueba que el dataset es alcanzable y devuelve su esquema real.
   * Es la comprobación previa del botón "Inspeccionar" del admin.
   */
  router.add("POST", "/datasets/inspect", async ({ res, body }) => {
    const b = (body ?? {}) as { datasetId?: unknown };
    const { DatasetImporter } = await import("../datasets/index");
    const datasetId = typeof b.datasetId === "string" ? b.datasetId : undefined;
    try {
      const info = await new DatasetImporter().inspect(datasetId);
      sendJson(res, 200, {
        reachable: info.reachable,
        unreachableReason: info.unreachableReason,
        provider: info.descriptor.provider,
        repo: info.descriptor.repo,
        totalRows: info.totalRows,
        version: info.version,
        sizeBytes: info.sizeBytes,
        features: info.features,
        availableFields: info.descriptor.availableFields,
        unavailableFields: info.descriptor.unavailableFields,
        license: info.descriptor.license,
        sample: info.sample,
      });
    } catch (error) {
      throw new ApiError(
        502,
        "dataset_unreachable",
        error instanceof Error ? error.message : "el dataset no es alcanzable"
      );
    }
  });

  /**
   * Encola una importación. Devuelve 202 + jobId: la importación de mil fichas
   * no cabe en una petición HTTP, así que se sigue por /admin/jobs.
   *
   * `dryRun` es la excepción y se ejecuta en línea: su valor está justamente en
   * ver el resultado ahora, y sin escribir nada es seguro y acotado.
   */
  router.add("POST", "/datasets/import", async ({ res, body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    const { getDataset, resolveOptions, DatasetImporter } = await import("../datasets/index");

    const asInt = (value: unknown, fallback?: number): number | undefined => {
      if (value === undefined || value === null || value === "") return fallback;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        throw new ApiError(400, "invalid_number", `valor numérico inválido: ${String(value)}`);
      }
      return Math.trunc(n);
    };
    const asList = (value: unknown): string[] | undefined => {
      if (Array.isArray(value)) return value.map(String).filter(Boolean);
      if (typeof value === "string" && value.trim()) {
        return value.split(",").map((v) => v.trim()).filter(Boolean);
      }
      return undefined;
    };

    if (b.source !== undefined && b.source !== "huggingface" && b.source !== "kaggle") {
      throw new ApiError(400, "invalid_source", "source debe ser huggingface o kaggle");
    }

    const options = resolveOptions({
      source: b.source as "huggingface" | "kaggle" | undefined,
      limit: asInt(b.limit),
      offset: asInt(b.offset, 0),
      batchSize: asInt(b.batchSize),
      categories: asList(b.categories),
      genders: asList(b.genders),
      generateEmbeddings: b.generateEmbeddings === undefined ? undefined : b.generateEmbeddings === true,
      uploadImages: b.uploadImages === undefined ? undefined : b.uploadImages === true,
      dryRun: b.dryRun === true,
      datasetId: typeof b.datasetId === "string" ? b.datasetId : undefined,
    });

    // Techo duro: una petición no puede encolar una importación de 44.000
    // fichas por un cero de más en el formulario.
    const MAX_PER_REQUEST = 5000;
    if (options.limit > MAX_PER_REQUEST) {
      throw new ApiError(
        400,
        "limit_too_large",
        `limit máximo por petición: ${MAX_PER_REQUEST} (se pidió ${options.limit})`
      );
    }

    const descriptor = getDataset(options.datasetId);

    if (options.dryRun) {
      // El ensayo se acota aparte: no tiene sentido "ensayar" 1.000 filas.
      const capped = { ...options, limit: Math.min(options.limit, 25) };
      const result = await new DatasetImporter({ store }).import(capped);
      sendJson(res, 200, {
        dryRun: true,
        datasetId: result.datasetId,
        counters: result.counters,
        warnings: result.warnings,
        errors: result.errors,
        limitApplied: capped.limit,
        preview: result.preview.map((p) => ({
          sourceProductId: p.sourceProductId,
          title: p.title,
          brand: p.brand,
          category: p.category,
          subcategory: p.subcategory,
          gender: p.gender,
          color: p.color,
          collection: p.collection,
          style: p.style,
          // Se devuelven explícitamente a null para que quede claro en la
          // respuesta que el dataset no los trae.
          price: null,
          currency: null,
          productUrl: null,
          merchant: null,
          isDemoProduct: true,
          unavailableFields: p.dataset?.unavailableFields ?? [],
        })),
      });
      return;
    }

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
    sendJson(res, 202, { jobId: job.jobId, datasetId: descriptor.id, options });
  });

  /**
   * Prueba el matching con un producto aleatorio del dataset.
   *
   * Coge una ficha, descarga SU PROPIA imagen del storage y la busca en el
   * catálogo. Es la comprobación de extremo a extremo del modo `catalog_only`:
   * si el propio producto no aparece en el top-10 de su propia foto, el índice
   * está roto — y eso es un fallo que de otro modo no se nota, porque el
   * matching devuelve resultados plausibles igualmente.
   */
  router.add("POST", "/datasets/test-match", async ({ res, body }) => {
    const b = (body ?? {}) as { datasetId?: unknown; topK?: unknown };
    const { getDataset } = await import("../datasets/index");
    const descriptor = getDataset(typeof b.datasetId === "string" ? b.datasetId : undefined);
    const topK = Math.min(Number(b.topK) || 10, 25);

    const { items } = await store.listProducts({
      source: descriptor.id,
      embeddingStatus: "ready",
      limit: 100,
      page: 1,
    });
    const candidates = items.filter((p) => p.primaryImage);
    if (candidates.length === 0) {
      throw new ApiError(
        422,
        "no_indexed_products",
        `No hay productos de "${descriptor.id}" con embedding e imagen. Importa primero.`
      );
    }
    const target = candidates[Math.floor(Math.random() * candidates.length)];

    const image = await processQueryImage({ imageUrl: target.primaryImage as string });
    if (!image) {
      throw new ApiError(
        502,
        "image_unreachable",
        `La imagen de ${target.sourceProductId} no se pudo descargar del storage. ` +
          "Si el storage no es persistente, las imágenes ya han caducado."
      );
    }

    const matches = await matchProducts(store, {
      imageSha256: image.sha256,
      perceptualHash: image.perceptualHash,
      imageEmbedding: image.embedding,
      topK,
      // Umbral bajo a propósito: interesa ver los similares además del exacto.
      minScore: 0.4,
    });

    const payload = matches.map(toMatchPayload);
    const selfIndex = payload.findIndex((m) => m.productId === target.id);
    sendJson(res, 200, {
      target: {
        productId: target.id,
        sourceProductId: target.sourceProductId,
        title: target.title,
        brand: target.brand,
        category: target.category,
        image: target.primaryImage,
        embeddingProvider: target.embeddingProvider,
        embeddingDimension: target.embeddingDimension,
        isDemoProduct: true,
      },
      matches: payload,
      // La comprobación honesta: ¿se encuentra a sí mismo, y en qué puesto?
      selfFoundAtRank: selfIndex >= 0 ? selfIndex + 1 : null,
      selfScore: selfIndex >= 0 ? payload[selfIndex].finalScore : null,
      // Con el proveedor `hash` el recall es malo y hay que decirlo, no dejar
      // que unos resultados mediocres parezcan lo mejor posible.
      productionGradeEmbeddings: target.embeddingProvider !== null && target.embeddingProvider !== "hash",
    });
  });

  /** Reanuda una importación desde el checkpoint de un job anterior. */
  router.add("POST", "/datasets/resume/:jobId", async ({ res, params }) => {
    const previous = await store.getJob(params.jobId);
    if (!previous) throw new ApiError(404, "job_not_found", `job desconocido: ${params.jobId}`);
    if (previous.type !== "dataset_import") {
      throw new ApiError(
        422,
        "wrong_job_type",
        `el job ${params.jobId} es de tipo ${previous.type}, no dataset_import`
      );
    }
    const checkpoint = previous.checkpoint as {
      options?: Record<string, unknown>;
      nextOffset?: number;
      endOffset?: number;
      datasetId?: string;
    };
    if (!checkpoint?.options || checkpoint.nextOffset == null || checkpoint.endOffset == null) {
      throw new ApiError(422, "no_checkpoint", `el job ${params.jobId} no tiene checkpoint reanudable`);
    }
    const remaining = Math.max(0, checkpoint.endOffset - checkpoint.nextOffset);
    if (remaining === 0) {
      throw new ApiError(422, "already_complete", "el rango del job ya estaba completo");
    }

    const job = await queue.enqueue({
      type: "dataset_import",
      source: previous.source,
      limit: remaining,
      checkpoint: {
        ...checkpoint,
        options: { ...checkpoint.options, offset: checkpoint.nextOffset, limit: remaining },
        resumeOfJobId: previous.jobId,
      },
    });
    sendJson(res, 202, { jobId: job.jobId, resumeOf: previous.jobId, remaining });
  });

  router.add("POST", "/products/external", async ({ res, body }) => {
    const validProviders = new Set([
      "serpapi_google_lens", "searchapi_google_lens",
      "serpapi_google_shopping", "dataforseo_google_shopping",
    ]);
    if (!validProviders.has(body?.provider)) {
      throw new ApiError(400, "invalid_provider", `provider inválido: ${body?.provider}`);
    }
    if (!body?.title || !body?.productUrl || typeof body?.score !== "number") {
      throw new ApiError(400, "invalid_body", "title, productUrl y score son obligatorios");
    }
    recordProviderUsage(body.provider, true);
    const config = getConfig();
    const now = new Date().toISOString();

    // Imagen del resultado externo: descarga best-effort (si falla, la ficha
    // se guarda igual con la URL como referencia)
    let processed: ProcessedImage | null = null;
    if (body.imageUrl) processed = await downloadAndProcessImage(String(body.imageUrl));

    const provider = await getEmbeddingProvider();
    const contentBase = {
      title: String(body.title),
      brand: body.brand ?? null,
      description: null,
      price: typeof body.price === "number" ? body.price : null,
      currency: body.currency ?? null,
      availability: normalizeAvailability(null),
      color: body.color ?? null,
      images: body.imageUrl ? [{ url: String(body.imageUrl) }] : [],
      sizes: [] as string[],
    };

    const normalized: NormalizedProduct = {
      source: body.provider,
      sourceProductId: String(body.productUrl),
      canonicalUrl: String(body.productUrl),
      brand: body.brand ?? null,
      title: String(body.title),
      description: null,
      category: normalizeCategory(body.category ?? null),
      subcategory: null,
      gender: null,
      collection: null,
      color: body.color ?? null,
      secondaryColors: [],
      material: null,
      pattern: null,
      style: null,
      price: contentBase.price,
      originalPrice: null,
      currency: body.currency ?? null,
      availability: "unknown",
      merchant: body.merchant ?? null,
      country: null,
      locale: null,
      images: body.imageUrl
        ? [{
            url: String(body.imageUrl),
            localPath: processed?.localPath ?? null,
            sha256: processed?.sha256 ?? null,
            perceptualHash: processed?.perceptualHash ?? null,
            width: processed?.width ?? null,
            height: processed?.height ?? null,
          }]
        : [],
      primaryImage: body.imageUrl ?? null,
      variants: [],
      sizes: [],
      sku: null,
      gtin: null,
      sourceMetadata: {
        provider: body.provider,
        evidence: Array.isArray(body.evidence) ? body.evidence : [],
        rawResult: body.rawResult ?? null,
      },
      // Un producto descubierto por un proveedor externo no pasó por nuestro
      // pipeline de extracción: no hay extractores ni evidencia que declarar.
      extraction: null,
      contentHash: computeContentHash(contentBase),
      perceptualHash: processed?.perceptualHash ?? null,
      textEmbedding: await provider.embedText(`${body.brand ?? ""} ${body.title}`),
      imageEmbedding: processed?.embedding ?? null,
      // `pending` si la imagen del proveedor externo no se pudo procesar: queda
      // a la espera de `reindex_embeddings`, no marcada como lista.
      embeddingStatus: processed ? "ready" : "pending",
      embeddingProvider: processed ? provider.name : null,
      embeddingDimension: processed?.embedding.length ?? null,
      dataset: null,
      scrapedAt: now,
      origin: "externally_discovered",
    };

    // Nunca se publica automáticamente si el score no llega al umbral
    const result = await ingestProduct(store, normalized, {
      origin: "externally_discovered",
      externalScore: body.score,
      active: body.score >= config.minImageScore,
    });
    // Para el caller, "deduplicated" significa "no se creó ficha nueva":
    // cubre tanto el dedup cross-source como el reenvío del mismo resultado.
    sendJson(res, 201, { productId: result.product.id, deduplicated: !result.isNew });
  });

  router.add("GET", "/products", async ({ res, query }) => {
    const activeParam = query.get("active");
    const originParam = query.get("origin");
    const statusParam = query.get("embeddingStatus");
    const VALID_ORIGINS = new Set(["scraped", "externally_discovered", "dataset_demo"]);
    const VALID_STATUS = new Set(["pending", "processing", "ready", "failed", "skipped"]);

    // Un valor inválido se ignora en vez de reventar: un filtro desconocido en
    // la URL no debe convertir la pantalla de catálogo en un 400.
    const { items, total } = await store.listProducts({
      source: query.get("source") ?? undefined,
      category: query.get("category") ?? undefined,
      brand: query.get("brand") ?? undefined,
      color: query.get("color") ?? undefined,
      gender: query.get("gender") ?? undefined,
      q: query.get("q") ?? undefined,
      active: activeParam === null ? undefined : activeParam === "true",
      origin:
        originParam && VALID_ORIGINS.has(originParam)
          ? (originParam as CatalogProduct["origin"])
          : undefined,
      embeddingStatus:
        statusParam && VALID_STATUS.has(statusParam)
          ? (statusParam as CatalogProduct["embeddingStatus"])
          : undefined,
      page: Number(query.get("page") ?? 1) || 1,
      limit: Number(query.get("limit") ?? 20) || 20,
    });
    sendJson(res, 200, {
      products: items.map(toProductPayload),
      total,
      page: Number(query.get("page") ?? 1) || 1,
      limit: Math.min(Number(query.get("limit") ?? 20) || 20, 100),
    });
  });

  router.add("GET", "/products/:productId", async ({ res, params }) => {
    const product = await store.getProduct(params.productId);
    if (!product) throw new ApiError(404, "product_not_found", `producto desconocido: ${params.productId}`);
    sendJson(res, 200, toProductPayload(product));
  });

  // Extra (admin): activar/desactivar producto
  router.add("POST", "/products/:productId/active", async ({ res, params, body }) => {
    const product = await store.getProduct(params.productId);
    if (!product) throw new ApiError(404, "product_not_found", `producto desconocido: ${params.productId}`);
    await store.setActive(params.productId, Boolean(body?.active));
    sendJson(res, 200, { productId: params.productId, isActive: Boolean(body?.active) });
  });

  /* ------------------------------- stats ------------------------------ */

  router.add("GET", "/stats", async ({ res }) => {
    const storeStats = await store.stats();
    const provider = await getEmbeddingProvider();
    sendJson(res, 200, {
      ...storeStats,
      backend: store.backend,
      embeddingProvider: { name: provider.name, model: provider.model, dimension: provider.dimension() },
      metrics: getMetrics(),
      uptimeSeconds: uptimeSeconds(),
    });
  });

  /* --------------------------- observabilidad -------------------------- */

  const LOG_LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

  router.add("GET", "/logs", async ({ res, query }) => {
    const levelParam = query.get("level");
    const level = levelParam && LOG_LEVELS.has(levelParam as LogLevel)
      ? (levelParam as LogLevel)
      : undefined;
    const entries = queryLogs({
      level,
      q: query.get("q") ?? undefined,
      source: query.get("source") ?? undefined,
      jobId: query.get("jobId") ?? undefined,
      limit: Number(query.get("limit") ?? 100) || 100,
    });
    sendJson(res, 200, {
      logs: entries,
      counts: logLevelCounts(),
      // Honestidad sobre la naturaleza del buffer: el admin lo muestra.
      retention: "buffer circular en memoria (se pierde al reiniciar el servicio)",
      minLevelEmitted: getConfig().logLevel,
    });
  });

  /**
   * Configuración efectiva del servicio. NUNCA devuelve secretos: de las claves
   * solo se dice si están presentes y su longitud.
   */
  router.add("GET", "/settings", async ({ res }) => {
    const config = getConfig();
    const provider = await getEmbeddingProvider();
    const secret = (value: string) => ({ configured: Boolean(value), length: value.length });
    sendJson(res, 200, {
      service: {
        port: config.port,
        logLevel: config.logLevel,
        apiKey: secret(config.apiKey),
        authEnforced: Boolean(config.apiKey),
      },
      storage: {
        backend: store.backend,
        databaseConfigured: isDatabaseConfigured(),
        dataDir: config.dataDir,
        imagesDir: config.imagesDir,
      },
      embeddings: {
        imageProvider: config.imageEmbeddingProvider,
        imageModel: config.imageEmbeddingModel,
        textProvider: config.textEmbeddingProvider,
        active: { name: provider.name, model: provider.model, dimension: provider.dimension() },
      },
      matching: {
        minImageScore: config.minImageScore,
        perceptualHashMaxDistance: config.perceptualHashMaxDistance,
        embeddingDedupThreshold: config.embeddingDedupThreshold,
      },
      scraping: {
        rateLimitPerDomainMs: config.rateLimitPerDomainMs,
        maxConcurrency: config.maxConcurrency,
        requestTimeoutMs: config.requestTimeoutMs,
        maxRetries: config.maxRetries,
        circuitBreakerThreshold: config.circuitBreakerThreshold,
        userAgent: config.userAgent,
        robotsPolicy:
          "robots.txt comprobado antes de cada petición; Crawl-delay respetado; sin evasión anti-bot",
      },
      jobs: { workers: config.jobWorkers },
    });
  });

  /**
   * Payload agregado del dashboard: una sola llamada para el overview del admin
   * (evita que la portada dispare seis peticiones en cascada).
   */
  router.add("GET", "/overview", async ({ res }) => {
    const [storeStats, jobs, provider] = await Promise.all([
      store.stats(),
      store.listJobs(50),
      getEmbeddingProvider(),
    ]);
    const registry = connectorRegistrySummary();
    // Una sola lectura de estados. Antes esto hacía DOS `getSourceState` por
    // conector (una por campo), o sea 136 queries con 68 fuentes.
    const states = await store.getAllSourceStates();
    const connectorStates = listConnectors().map((c) => {
      const state = states.get(c.id);
      return {
        id: c.id,
        paused: state?.paused ?? false,
        lastSyncAt: state?.lastSyncAt ?? null,
      };
    });
    const lastSync = connectorStates
      .map((s) => s.lastSyncAt)
      .filter((v): v is string => Boolean(v))
      // ISO-8601 ordena bien lexicográficamente, pero el comparador explícito
      // evita depender del locale por defecto.
      .sort((a, b) => a.localeCompare(b, "en"))
      .at(-1) ?? null;

    // Tasa de error real sobre los jobs recientes: fetches fallidos / intentos.
    const attempted = jobs.reduce((acc, j) => acc + j.progress.fetched + j.progress.errors, 0);
    const failed = jobs.reduce((acc, j) => acc + j.progress.errors, 0);

    sendJson(res, 200, {
      catalog: {
        totalProducts: storeStats.totalProducts,
        activeProducts: storeStats.activeProducts,
        withImages: storeStats.withImages,
        withEmbeddings: storeStats.withEmbeddings,
        duplicatesDetected: storeStats.duplicatesDetected,
        bySource: storeStats.bySource,
        byOrigin: storeStats.byOrigin,
      },
      connectors: {
        ...registry,
        paused: connectorStates.filter((s) => s.paused).length,
        lastSyncAt: lastSync,
      },
      embeddings: {
        provider: provider.name,
        model: provider.model,
        dimension: provider.dimension(),
        coverage:
          storeStats.totalProducts > 0
            ? Math.round((storeStats.withEmbeddings / storeStats.totalProducts) * 1000) / 10
            : 0,
      },
      queue: {
        byStatus: storeStats.jobs,
        running: jobs.filter((j) => j.status === "running").length,
        queued: jobs.filter((j) => j.status === "queued").length,
        recent: jobs.slice(0, 8).map(toJobPayload),
      },
      throughput: ingestThroughput(15),
      errorRate: attempted > 0 ? Math.round((failed / attempted) * 1000) / 10 : 0,
      logs: { counts: logLevelCounts(), recent: queryLogs({ limit: 8 }) },
      backend: store.backend,
      uptimeSeconds: uptimeSeconds(),
    });
  });

  /* ------------------------------- admin ------------------------------ */

  // El admin ya NO se sirve desde aquí: vive en la app Next.js
  // (http://localhost:3000/admin) y habla con este servicio a través de sus
  // route handlers server-side. Dejamos un puntero explícito en lugar de un
  // 404 para que un enlace antiguo diga dónde está el admin real.
  router.add(
    "GET",
    "/admin",
    async ({ res }) => {
      sendJson(res, 410, {
        moved: true,
        admin: process.env.ADMIN_PUBLIC_URL || "http://localhost:3000/admin",
        message:
          "El admin se ha unificado en la app Pause2Shop: /admin. Este servicio solo expone la API.",
      });
    },
    { auth: false }
  );

  return router;
}
