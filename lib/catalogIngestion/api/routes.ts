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

function toMatchPayload(m: ProductMatch) {
  const p = m.product;
  return {
    productId: p.id,
    title: p.title,
    brand: p.brand,
    image: p.primaryImage ?? p.images[0]?.url ?? null,
    productUrl: p.canonicalUrl,
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
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Ficha pública sin embeddings (son enormes y no le sirven al cliente). */
function toProductPayload(p: CatalogProduct) {
  const { imageEmbedding, textEmbedding, ...rest } = p;
  return { ...rest, hasImageEmbedding: imageEmbedding != null, hasTextEmbedding: textEmbedding != null };
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
    /** Índice del checkpoint: dice exactamente por dónde se reanudaría. */
    resumeIndex: typeof job.checkpoint.index === "number" ? job.checkpoint.index : null,
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
      },
      limits: {
        maxConcurrency: config.maxConcurrency,
        requestDelayMs: config.requestDelayMs,
        navigationTimeoutMs: config.navigationTimeoutMs,
        maxRetries: config.maxRetries,
        batchSize: config.batchSize,
        maxProductsPerJob: config.maxProductsPerJob,
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
    const job = await queue.enqueue({
      type: mode === "full" ? "sync_full" : "sync_incremental",
      source,
      mode,
      // A Vercel function is bounded in time. Jobs persist checkpoints and the
      // UI can run/retry further batches; never let a request create an
      // unbounded crawl.
      limit:
        typeof body?.limit === "number"
          ? Math.max(1, Math.min(Math.floor(body.limit), 25))
          : 25,
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

  router.add("POST", "/products/reindex", async ({ res }) => {
    const job = await queue.enqueue({ type: "reindex_embeddings" });
    sendJson(res, 202, { jobId: job.jobId });
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
    const { items, total } = await store.listProducts({
      source: query.get("source") ?? undefined,
      category: query.get("category") ?? undefined,
      brand: query.get("brand") ?? undefined,
      q: query.get("q") ?? undefined,
      active: activeParam === null ? undefined : activeParam === "true",
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
