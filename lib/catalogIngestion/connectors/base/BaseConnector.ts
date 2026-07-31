import type { CheerioAPI } from "cheerio";
import type {
  JobProgress,
  JobStatus,
  NormalizedProduct,
  ProductExtractionMeta,
} from "../../catalog/types";
import { emptyJobProgress } from "../../catalog/types";
import type { CatalogStore } from "../../catalog/store";
import { ingestProduct } from "../../catalog/ingest";
import {
  discoverSitemapsFromRobots,
  domainRobots,
  politeFetch,
  RobotsDisallowedError,
  type FetchFn,
} from "./httpClient";
import { robotsAllowsCrawling } from "./robots";
import {
  allProductUrlPatterns,
  canSpecSync,
  effectiveStatus,
  specToMetadata,
  type ConnectorEffectiveStatus,
  type ConnectorHealthState,
  type ConnectorMetadata,
  type ConnectorSpec,
} from "./types";
import { downloadAndProcessImage } from "../../images/processor";
import { getEmbeddingProvider } from "../../embeddings/index";
import { getConfig } from "../../config/index";
import { getScraperConfig } from "../../config/scraper";
import { logger } from "../../observability/logger";
import { countConnectorError } from "../../observability/metrics";
import {
  createJobLogger,
  type JobLogger,
  type JobStage,
} from "../../observability/jobLog";
import {
  computeContentHash,
  normalizeAvailability,
  normalizeCategory,
  normalizeCurrency,
  parsePrice,
} from "../../normalization/normalize";
import { extractProduct, type StageEvent } from "../../extraction/pipeline";
import type { ExtractionLayer, ExtractionResult } from "../../extraction/types";
import { discoverProductUrls, type DiscoveryCheckpoint } from "../../discovery/index";
import {
  BrowserChallengeError,
  getPlaywrightService,
  type PlaywrightService,
} from "../../browser/playwrightService";
import { AiProductExtractor } from "../../ai/extractor";
import { MemoryAiCache, type AiExtractionCache } from "../../ai/cache";

/**
 * Contrato de todo conector de tienda + clase base con la lógica compartida.
 *
 * El motor es genérico y modular: descubrimiento (sitemap / crawl de categorías)
 * → extracción por capas (feed → JSON-LD → OG/microdata → JSON embebido →
 * selectores → heurísticas → navegador → IA) → normalización → persistencia →
 * imágenes → embeddings. Una tienda nueva es, en el caso normal, una entrada
 * declarativa en `sources/`; solo se hace subclase si necesita algo propio.
 *
 * POLÍTICA (no negociable):
 *  - robots.txt se respeta SIEMPRE, también al renderizar con navegador.
 *  - Nunca se resuelven CAPTCHAs ni se evaden protecciones anti-bot: ante un
 *    challenge, la fuente queda `blocked_or_challenged` y el job se para.
 *  - Rate limit y crawl-delay por dominio, concurrencia acotada.
 *  - Solo contenido público. Nada de áreas autenticadas ni de acuerdos ausentes.
 */

/** @deprecated usa ConnectorHealthState (types.ts) — se mantiene por compat. */
export type ConnectorStatus = ConnectorHealthState;

export interface ConnectorHealth {
  status: ConnectorHealthState;
  note: string;
  checkedAt: string;
  /** Latencia de la comprobación, si se midió. */
  latencyMs?: number;
  /** Código HTTP observado, si hubo respuesta. */
  httpStatus?: number | null;
  /** Crawl-delay declarado por el dominio en su robots.txt. */
  crawlDelaySeconds?: number | null;
}

/** Lo que devuelve el scraping de UNA ficha, antes de normalizar. */
export interface ScrapedProduct {
  url: string;
  /** URL final tras redirecciones (puede diferir si la tienda redirige). */
  finalUrl: string;
  extraction: ExtractionResult;
  /** HTML crudo. Solo se conserva si se pidió (fixtures, depuración). */
  html?: string;
}

export interface DiscoverInput {
  limit?: number;
  /** Checkpoint del descubrimiento para reanudar donde se quedó. */
  checkpoint?: DiscoveryCheckpoint | null;
  /** Techo de peticiones de descubrimiento en esta invocación. */
  maxRequests?: number;
  log?: JobLogger;
}

export interface DiscoverResult {
  urls: string[];
  checkpoint: DiscoveryCheckpoint;
  strategiesUsed: string[];
  requests: number;
}

export interface ScrapeInput {
  url: string;
  /** Aísla el contexto del navegador por job. */
  isolationKey?: string;
  /** Conservar el HTML en el resultado (para generar fixtures). */
  keepHtml?: boolean;
  log?: JobLogger;
}

export interface SyncOptions {
  store: CatalogStore;
  mode: "full" | "incremental";
  limit?: number;
  checkpoint?: Record<string, unknown>;
  onProgress?: (progress: JobProgress, checkpoint: Record<string, unknown>) => Promise<void>;
  shouldCancel?: () => boolean;
  /** Los tests con fixtures desactivan la descarga real de imágenes. */
  downloadImages?: boolean;
  /** Id del job, para etiquetar los logs y aislar el contexto del navegador. */
  jobId?: string | null;
  /**
   * Fichas que procesa esta invocación como máximo. Es lo que hace el job
   * compatible con serverless: se procesa un lote, se guarda checkpoint y se
   * devuelve el control; la siguiente invocación continúa.
   */
  batchSize?: number;
  /** Presupuesto de tiempo de la invocación. Al agotarse se guarda y se sale. */
  timeBudgetMs?: number;
}

export interface SyncSummary {
  progress: JobProgress;
  completed: boolean;
  errors: Array<{ url: string; message: string }>;
  /** Motivo por el que se paró sin completar (para el admin). */
  stoppedReason: string | null;
}

export interface CatalogConnector {
  readonly id: string;
  readonly label: string;
  /** Definición declarativa de la fuente. */
  readonly definition: ConnectorSpec;
  /** Alias histórico de `definition`. */
  readonly spec: ConnectorSpec;
  readonly metadata: ConnectorMetadata;
  /** ¿Puede lanzar jobs de sync ahora mismo (implementación + credenciales)? */
  canSync(): boolean;
  discoverProductUrls(input?: DiscoverInput): Promise<DiscoverResult>;
  scrapeProduct(input: ScrapeInput): Promise<ScrapedProduct>;
  normalizeProduct(scraped: ScrapedProduct): Promise<NormalizedProduct>;
  syncProducts(options: SyncOptions): Promise<SyncSummary>;
  healthCheck(): Promise<ConnectorHealth>;
  /** Prueba end-to-end ligera: descubre 1 URL, la baja y la normaliza. */
  testConnector(): Promise<ConnectorTestResult>;
  /** Estado efectivo (los 8 estados honestos). */
  effectiveStatus(options?: { paused?: boolean; verifiedLive?: boolean }): ConnectorEffectiveStatus;
}

/** Resultado de `POST /connectors/:id/test` — diagnóstico para el admin. */
export interface ConnectorTestResult {
  ok: boolean;
  /** Cada paso del pipeline con su veredicto, para localizar el fallo exacto. */
  steps: Array<{
    step: "robots" | "discovery" | "fetch" | "structured_data" | "normalize";
    ok: boolean;
    detail: string;
    ms: number;
  }>;
  sampleUrl: string | null;
  sampleTitle: string | null;
  samplePrice: number | null;
  sampleImage: string | null;
  /** Extractores que resolvieron la muestra: dice si hizo falta IA. */
  extractorsUsed: string[];
  aiUsed: boolean;
  browserUsed: boolean;
  durationMs: number;
}

export class CircuitOpenError extends Error {
  constructor(connector: string) {
    super(`circuit breaker abierto para ${connector}: demasiados fallos seguidos`);
    this.name = "CircuitOpenError";
  }
}

/** Extrae todos los objetos JSON-LD @type=Product de un HTML (incluye @graph). */
export function extractJsonLdProducts(html: string): Record<string, any>[] {
  const products: Record<string, any>[] = [];
  const scripts = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const match of scripts) {
    let parsed: any;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue; // JSON-LD roto: seguimos con el resto de scripts
    }
    const nodes: any[] = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes) {
      const graph = Array.isArray(node?.["@graph"]) ? node["@graph"] : [node];
      for (const item of graph) {
        const type = item?.["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.includes("Product")) products.push(item);
      }
    }
  }
  return products;
}

/** Fallbacks HTML de último recurso: og:title / og:image / meta description. */
export function extractHtmlMeta(html: string): {
  title: string | null;
  image: string | null;
  description: string | null;
} {
  const meta = (prop: string): string | null => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${prop}["'][^>]+content\\s*=\\s*["']([^"']+)["']`,
      "i"
    );
    const m = html.match(re);
    return m ? m[1] : null;
  };
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    title: meta("og:title") ?? (titleTag ? titleTag[1].trim() : null),
    image: meta("og:image"),
    description: meta("og:description") ?? meta("description"),
  };
}

/** Cada cuántas fichas se persiste progreso+checkpoint. */
const CHECKPOINT_EVERY = 3;

export class BaseConnector implements CatalogConnector {
  readonly spec: ConnectorSpec;
  readonly id: string;
  readonly label: string;
  /** URL de portada para el healthCheck live. */
  protected readonly homeUrl: string;
  /** Sitemaps candidatos declarados en el spec, en orden de preferencia. */
  protected readonly sitemapUrls: string[];
  private readonly productUrlRes: RegExp[];
  private readonly productIdRe: RegExp | null;

  protected fetchFn: FetchFn;
  private consecutiveFailures = 0;
  private circuitOpen = false;
  private lastFailureNote = "";
  /** Sitemaps descubiertos vía robots.txt (caché por instancia). */
  private robotsSitemaps: string[] | null = null;
  /** Extractor por IA compartido por el conector (comparte su caché). */
  private aiExtractor: AiProductExtractor | null = null;

  constructor(spec: ConnectorSpec, fetchFn?: FetchFn) {
    this.spec = spec;
    this.id = spec.id;
    this.label = spec.label;
    this.homeUrl = spec.homeUrl;
    this.sitemapUrls = spec.sitemapUrls;
    this.productUrlRes = allProductUrlPatterns(spec).map((p) => new RegExp(p, "i"));
    this.productIdRe = spec.productIdPattern ? new RegExp(spec.productIdPattern, "i") : null;
    this.fetchFn = fetchFn ?? politeFetch;
  }

  get definition(): ConnectorSpec {
    return this.spec;
  }

  get metadata(): ConnectorMetadata {
    return specToMetadata(this.spec);
  }

  canSync(): boolean {
    return canSpecSync(this.spec);
  }

  effectiveStatus(options: { paused?: boolean; verifiedLive?: boolean } = {}): ConnectorEffectiveStatus {
    const health: ConnectorHealthState = this.circuitOpen ? "error" : "not_checked";
    return effectiveStatus(this.spec, health, options);
  }

  /** ¿Es esta URL una ficha de producto? Sobrescribible por subclase. */
  protected isProductUrl(url: string): boolean {
    if (this.productUrlRes.length === 0) return false;
    return this.productUrlRes.some((re) => re.test(url));
  }

  /** Id estable del producto extraído de la URL. Sobrescribible. */
  protected extractSourceProductId(url: string): string | null {
    if (!this.productIdRe) return null;
    const m = this.productIdRe.exec(url);
    return m?.[1] ?? null;
  }

  /**
   * Hook por tienda para JSON embebido (estado de la SPA, etc.). Devuelve los
   * campos ya mapeados al modelo del pipeline. Recibe también el documento
   * cargado para no volver a parsear el HTML.
   */
  protected extractEmbeddedLayer(_html: string, _$: CheerioAPI): ExtractionLayer | null {
    return null;
  }

  /**
   * Feed/API autorizado de la tienda. La vía preferente cuando existe: no es
   * scraping, es consumir lo que la marca publica para eso.
   */
  protected async fetchFromFeed(_url: string): Promise<ExtractionLayer | null> {
    return null;
  }

  /** Fetch con circuit breaker: tras N fallos seguidos el conector se marca
   * `unavailable` y deja de intentarlo hasta un reset manual/health nuevo. */
  protected async guardedFetch(url: string, accept?: string): Promise<string> {
    if (this.circuitOpen) throw new CircuitOpenError(this.id);
    try {
      const res = await this.fetchFn(url, accept);
      if (res.status === 403 || res.status === 401) {
        // Bloqueo explícito: cuenta como fallo pero NUNCA intentamos eludirlo.
        throw new Error(`HTTP ${res.status} (bloqueado) en ${url}`);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status} en ${url}`);
      }
      this.consecutiveFailures = 0;
      return res.body;
    } catch (err) {
      if (err instanceof RobotsDisallowedError) throw err; // respeto, no fallo
      this.consecutiveFailures++;
      this.lastFailureNote = err instanceof Error ? err.message : String(err);
      countConnectorError(this.id);
      if (this.consecutiveFailures >= getConfig().circuitBreakerThreshold) {
        this.circuitOpen = true;
        logger.warn("circuit breaker abierto", { connector: this.id, note: this.lastFailureNote });
      }
      throw err;
    }
  }

  isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  resetCircuit(): void {
    this.circuitOpen = false;
    this.consecutiveFailures = 0;
  }

  /** Servicio de navegador, si la fuente lo permite y está habilitado. */
  protected browserService(): PlaywrightService | null {
    if (!this.spec.extraction.allowBrowser) return null;
    if (!getScraperConfig().playwrightEnabled) return null;
    return getPlaywrightService();
  }

  /** Extractor por IA, si la fuente lo permite y hay clave. */
  protected ai(): AiProductExtractor | null {
    if (!this.spec.extraction.allowAi) return null;
    if (!getScraperConfig().aiEnabled) return null;
    this.aiExtractor ??= new AiProductExtractor(getSharedAiCache());
    return this.aiExtractor;
  }

  /**
   * Sitemaps a probar: primero los declarados en el spec, después los que la
   * propia tienda publica en su robots.txt (`Sitemap:`). Así no dependemos de
   * adivinar rutas: si la tienda documenta sus sitemaps, los usamos.
   */
  protected async candidateSitemaps(): Promise<string[]> {
    if (this.robotsSitemaps === null) {
      this.robotsSitemaps = await discoverSitemapsFromRobots(this.homeUrl);
      if (this.robotsSitemaps.length > 0) {
        logger.debug("sitemaps descubiertos vía robots.txt", {
          connector: this.id,
          count: this.robotsSitemaps.length,
        });
      }
    }
    return [...new Set([...this.sitemapUrls, ...this.robotsSitemaps])];
  }

  /** Canonicaliza quitando query/fragment — las tiendas añaden tracking. */
  protected canonicalize(url: string): string {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return url;
    }
  }

  /** Estrategias efectivas: si el spec no declara ninguna, se asume sitemap. */
  private strategies(): ConnectorSpec["discoveryStrategies"] {
    if (this.spec.discoveryStrategies.length > 0) return this.spec.discoveryStrategies;
    return [{ kind: "sitemap", urls: this.sitemapUrls }];
  }

  /**
   * Pistas de locale para priorizar sitemaps. Se derivan del path de `homeUrl`
   * y de los mercados declarados: una tienda que publica un sitemap por país
   * necesita que sepamos cuál es "el nuestro" antes de gastar peticiones.
   */
  protected localeHints(): string[] {
    const hints = new Set<string>();
    for (const market of this.spec.markets) {
      const code = market.toLowerCase();
      if (code.length !== 2) continue;
      hints.add(`_${code}`); // es_ES
      hints.add(`-${code}`); // es-es
      hints.add(`/${code}/`); // /es/
    }
    // El propio homeUrl suele llevar el segmento correcto: /es_ES/, /es-es/, /es/
    try {
      const segments = new URL(this.homeUrl).pathname.split("/").filter(Boolean);
      for (const segment of segments) {
        if (/^[a-z]{2}([_-][a-z]{2})?$/i.test(segment)) hints.add(segment);
      }
    } catch {
      /* homeUrl inválida: el spec ya se valida en assertSourcesValid */
    }
    return [...hints];
  }

  /**
   * Descubre URLs de ficha con las estrategias declaradas. Reanudable vía
   * `input.checkpoint`.
   */
  async discoverProductUrls(input: DiscoverInput = {}): Promise<DiscoverResult> {
    const limit = input.limit ?? 100;
    const log = input.log;
    const robotsSitemaps = await this.candidateSitemaps();

    const result = await discoverProductUrls({
      strategies: this.strategies().map((s) =>
        s.kind === "sitemap" ? { kind: "sitemap", urls: s.urls ?? this.sitemapUrls } : s
      ),
      robotsSitemaps,
      isProductUrl: (url) => this.isProductUrl(url),
      canonicalize: (url) => this.canonicalize(url),
      limit,
      selectors: this.spec.selectors,
      checkpoint: input.checkpoint ?? null,
      maxRequests: input.maxRequests,
      localeHints: this.localeHints(),
      fetchDocument: async (url, accept) => {
        try {
          return await this.guardedFetch(url, accept);
        } catch (err) {
          if (err instanceof RobotsDisallowedError) throw err;
          return null;
        }
      },
      report: (event) => log?.({ ...event, url: event.url ?? null }),
    });

    return {
      urls: result.urls,
      checkpoint: result.checkpoint,
      strategiesUsed: result.strategiesUsed,
      requests: result.requests,
    };
  }

  /** @deprecated usa `discoverProductUrls`. Se mantiene por compatibilidad. */
  async discoverProducts(limit = 100): Promise<string[]> {
    const { urls } = await this.discoverProductUrls({ limit });
    return urls;
  }

  /**
   * Extrae UNA ficha aplicando el pipeline completo. No lanza por campos
   * ausentes: devuelve la extracción con sus warnings y que decida el llamante.
   */
  async scrapeProduct(input: ScrapeInput): Promise<ScrapedProduct> {
    const { url, log } = input;
    let capturedHtml: string | undefined;
    // La URL final la fija el pipeline si hubo redirección; por ahora, la pedida.
    const finalUrl = url;

    const extraction = await extractProduct(url, {
      selectors: this.spec.selectors ?? undefined,
      fetchHtml: async (target) => {
        const body = await this.guardedFetch(target);
        if (input.keepHtml) capturedHtml = body;
        return { html: body, httpStatus: 200, finalUrl: target };
      },
      fetchFromFeed: (target) => this.fetchFromFeed(target),
      extractEmbedded: (html, $) => this.extractEmbeddedLayer(html, $),
      extractFromUrl: (target) => this.urlLayer(target),
      browser: this.browserService(),
      ai: this.ai(),
      isolationKey: input.isolationKey ?? this.id,
      allowBrowser: this.spec.extraction.allowBrowser,
      allowAi: this.spec.extraction.allowAi,
      waitForSelector: this.spec.extraction.waitForSelector,
      aiHint: `tienda de ${this.spec.tier}, categorías declaradas: ${this.spec.categories.join(", ")}`,
      report: (event: StageEvent) =>
        log?.({
          stage: event.stage,
          level: event.level,
          message: event.message,
          url: event.url ?? url,
          durationMs: event.durationMs ?? null,
          retry: event.retry ?? null,
          metadata: event.metadata ?? null,
        }),
    });

    return { url, finalUrl, extraction, html: capturedHtml };
  }

  /** Campos derivados de la URL: id de producto, género, país/locale. */
  protected urlLayer(url: string): ExtractionLayer | null {
    const taxonomy = this.parseUrlTaxonomy(url);
    const sourceProductId = this.extractSourceProductId(url);
    if (!sourceProductId && !taxonomy.gender && !taxonomy.category) return null;
    return {
      kind: "url",
      fields: {
        sourceProductId,
        gender: taxonomy.gender,
        category: taxonomy.category,
        subcategory: taxonomy.subcategory,
      },
      snippets: {
        sourceProductId: `patrón de URL ${this.spec.productIdPattern ?? "-"}`,
        gender: "segmento de la URL",
      },
    };
  }

  /** Taxonomía desde la URL (género/categoría/país). Sobrescribible. */
  protected parseUrlTaxonomy(url: string): {
    gender: string | null;
    category: string | null;
    subcategory: string | null;
    country: string | null;
    locale: string | null;
  } {
    let path = "";
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      return { gender: null, category: null, subcategory: null, country: null, locale: null };
    }
    let gender: string | null = null;
    if (/(\/|-)(mujer|woman|women|ladies|damen|femme)(\/|-)/.test(path)) gender = "women";
    else if (/(\/|-)(hombre|man|men|herren|homme)(\/|-)/.test(path)) gender = "men";
    else if (/(\/|-)(nino|nina|ninos|kids|children|kinder|enfant)(\/|-)/.test(path)) gender = "kids";
    const localeMatch =
      path.match(/^\/([a-z]{2})[_-]([a-z]{2})\//) ?? path.match(/^\/([a-z]{2})\/([a-z]{2})\//);
    return {
      gender,
      category: null,
      subcategory: null,
      country: localeMatch ? localeMatch[1].toUpperCase() : null,
      locale: localeMatch ? `${localeMatch[2]}-${localeMatch[1].toUpperCase()}` : null,
    };
  }

  /**
   * Convierte una extracción en un producto normalizado del catálogo.
   *
   * Lanza si falta el título: un producto sin nombre no es un producto. Los
   * demás campos ausentes se guardan como null — preferimos una ficha honesta
   * e incompleta a una rellenada a base de suposiciones.
   */
  async normalizeProduct(scraped: ScrapedProduct): Promise<NormalizedProduct> {
    const e = scraped.extraction;
    if (e.productType === "listing") {
      throw new Error(`${scraped.url} es un listado, no una ficha de producto`);
    }
    const title = e.title?.trim();
    if (!title) throw new Error(`producto sin título en ${scraped.url}`);

    const taxonomy = this.parseUrlTaxonomy(scraped.url);
    const canonicalUrl = this.canonicalize(scraped.url);
    const sourceProductId =
      e.sourceProductId ?? this.extractSourceProductId(scraped.url) ?? e.sku ?? canonicalUrl;

    const images = [...new Set(e.imageUrls)]
      .map((url) => absolutize(url, canonicalUrl))
      .filter((url): url is string => Boolean(url));

    const price = e.price;
    const currency = normalizeCurrency(e.currency);
    // Un precio "anterior" que no supera al vigente no es un descuento: se
    // descarta en vez de mostrar una rebaja falsa.
    const originalPrice = e.originalPrice != null && price != null && e.originalPrice > price ? e.originalPrice : null;

    const sizes = [...new Set(e.sizes.map((s) => s.trim()).filter(Boolean))];
    const variants = e.variants.map((v, i) => ({
      id: `${sourceProductId}-${i}`,
      color: v.color ?? e.color ?? null,
      size: v.size ?? null,
      sku: v.sku ?? null,
      price: parsePrice(v.price),
      currency: normalizeCurrency(v.currency) ?? currency,
      availability: normalizeAvailability(v.availability),
    }));

    const partial = {
      title,
      brand: e.brand ?? this.spec.brand,
      description: e.description,
      price,
      currency,
      availability: normalizeAvailability(e.availability),
      color: e.color,
      images: images.map((url) => ({ url })),
      sizes,
    };

    const extractionMeta: ProductExtractionMeta = {
      extractorsUsed: e.extractorsUsed,
      primaryExtractor: e.primaryExtractor,
      aiUsed: e.aiUsed,
      browserUsed: e.browserUsed,
      aiModel: e.aiUsed ? getScraperConfig().aiModel : null,
      aiCostUsd: e.aiCostUsd,
      aiTokens: (e.aiTokens?.prompt ?? 0) + (e.aiTokens?.completion ?? 0),
      confidence: e.confidence,
      evidence: e.evidence,
      warnings: e.warnings,
      extractedAt: new Date().toISOString(),
      durationMs: e.durationMs,
    };

    return {
      source: this.id,
      sourceProductId: String(sourceProductId),
      canonicalUrl,
      brand: partial.brand,
      title,
      description: partial.description,
      category: normalizeCategory(e.category ?? taxonomy.category ?? title),
      subcategory: e.subcategory ?? taxonomy.subcategory,
      gender: e.gender ?? taxonomy.gender,
      collection: null,
      color: e.color,
      secondaryColors: e.secondaryColors,
      material: e.material,
      pattern: e.pattern,
      style: null,
      price,
      originalPrice,
      currency,
      availability: partial.availability,
      merchant: this.label,
      country: taxonomy.country,
      locale: taxonomy.locale,
      images: images.map((url) => ({
        url,
        localPath: null,
        sha256: null,
        perceptualHash: null,
        width: null,
        height: null,
      })),
      primaryImage: images[0] ?? null,
      variants,
      sizes,
      sku: e.sku,
      gtin: e.gtin,
      sourceMetadata: {
        connector: this.id,
        group: this.spec.group,
        tier: this.spec.tier,
        access: this.spec.access,
        model: e.model,
      },
      extraction: extractionMeta,
      contentHash: computeContentHash(partial),
      perceptualHash: null,
      textEmbedding: null,
      imageEmbedding: null,
      scrapedAt: new Date().toISOString(),
      origin: "scraped",
    };
  }

  /**
   * Bucle de sync por LOTES, reanudable y compatible con serverless.
   *
   * Cada invocación: reanuda el descubrimiento si hace falta, procesa hasta
   * `batchSize` fichas (o hasta agotar el presupuesto de tiempo), persiste
   * checkpoint y devuelve el control. `completed: false` significa "queda
   * trabajo", no "falló": la siguiente invocación sigue desde el checkpoint.
   */
  async syncProducts(options: SyncOptions): Promise<SyncSummary> {
    const scraperConfig = getScraperConfig();
    const progress: JobProgress = emptyJobProgress();
    const errors: Array<{ url: string; message: string }> = [];
    const checkpoint: Record<string, unknown> = { ...(options.checkpoint ?? {}) };
    const log = createJobLogger(options.jobId ?? null, this.id);
    const startedAt = Date.now();
    const batchSize = options.batchSize ?? scraperConfig.batchSize;
    const timeBudgetMs = options.timeBudgetMs ?? Number.POSITIVE_INFINITY;
    const limit = Math.min(options.limit ?? 100, scraperConfig.maxProductsPerJob);
    const isolationKey = options.jobId ?? this.id;

    // Contadores previos: un job reanudado no reinicia sus cifras.
    Object.assign(progress, {
      ...progress,
      ...((checkpoint.progress as Partial<JobProgress>) ?? {}),
    });

    /**
     * Fija la ETAPA del job (lo que ve el admin en la barra de progreso) y
     * emite el evento de log correspondiente. `phase` es el estado del job
     * (`discovering`, `scraping`…) y `stage` la etapa del pipeline: son dos
     * vocabularios distintos y no se mezclan.
     */
    const setPhase = async (phase: JobStatus, stage: JobStage, message: string): Promise<void> => {
      progress.stage = phase;
      log({ stage, level: "info", message });
      await options.onProgress?.(progress, checkpoint);
    };

    const outOfTime = (): boolean => Date.now() - startedAt > timeBudgetMs;

    // --- robots.txt --------------------------------------------------------
    // Se consulta el DESENLACE, no solo el crawl-delay. Antes esto pedía el
    // delay, se tragaba cualquier error y escribía "permitido" siempre: Zara y
    // Mango devuelven 403 hasta en /robots.txt y el job las reportaba como
    // permitidas y "completed" con 0 productos. Un diagnóstico falso es peor
    // que un fallo, porque nadie va a mirar donde no parece haber problema.
    const robots = await domainRobots(this.homeUrl);
    const crawlDelay = robots.crawlDelaySeconds;

    if (!robotsAllowsCrawling(robots)) {
      const message =
        `el servidor deniega /robots.txt (HTTP ${robots.status}): la fuente nos ` +
        "está bloqueando desde esta red. No se rastrea ni se intenta eludir.";
      log({
        stage: "robots",
        level: "error",
        message,
        url: this.homeUrl,
        metadata: { outcome: robots.outcome, status: robots.status },
      });
      // Se corta aquí a propósito: seguir a `discover` solo produciría
      // "0 URLs descubiertas", que oculta el motivo real. Se devuelve como job
      // NO completado con su razón, igual que un challenge anti-bot, para que
      // el admin vea `blocked_or_challenged` y no un falso "completed".
      progress.errors++;
      return {
        progress,
        completed: false,
        errors: [{ url: this.homeUrl, message }],
        stoppedReason: "la fuente deniega el acceso desde esta red; no se intenta eludir",
      };
    }

    // No haber podido leer robots.txt no bloquea (puede ser un corte nuestro),
    // pero no se disfraza de "permitido": se dice lo que se sabe y lo que no.
    const robotsUnknown = robots.outcome === "unreachable";
    const delaySuffix = crawlDelay
      ? `crawl-delay ${crawlDelay.toLocaleString("es-ES")} s`
      : "sin crawl-delay declarado";
    log({
      stage: "robots",
      level: robotsUnknown ? "warn" : "info",
      message: robotsUnknown
        ? `/robots.txt no accesible${robots.status ? ` (HTTP ${robots.status})` : " (sin respuesta)"}: se rastrea con el rate limit conservador`
        : `permitido · ${delaySuffix}`,
      url: this.homeUrl,
      metadata: {
        crawlDelaySeconds: crawlDelay,
        policy: this.spec.robotsPolicy,
        robotsOutcome: robots.outcome,
      },
    });

    // --- descubrimiento ----------------------------------------------------
    let discovery = (checkpoint.discovery as DiscoveryCheckpoint | undefined) ?? null;
    let urls = (checkpoint.urls as string[] | undefined) ?? null;

    if (!urls || (!discovery?.done && urls.length < limit)) {
      await setPhase("discovering", "discover", "descubriendo URLs de ficha");
      try {
        const result = await this.discoverProductUrls({
          limit,
          checkpoint: discovery,
          log,
        });
        urls = result.urls;
        discovery = result.checkpoint;
        checkpoint.urls = urls;
        checkpoint.discovery = discovery;
        checkpoint.index ??= 0;
        log({
          stage: "discover",
          level: urls.length > 0 ? "success" : "warn",
          message:
            urls.length > 0
              ? `${urls.length} URLs encontradas (${result.strategiesUsed.join(", ") || "sin estrategia efectiva"})`
              : "el descubrimiento no devolvió ninguna URL de ficha",
          metadata: {
            requests: result.requests,
            strategies: result.strategiesUsed,
            done: discovery.done,
          },
        });
      } catch (err) {
        if (err instanceof RobotsDisallowedError) {
          log({ stage: "error", level: "error", message: err.message, url: this.homeUrl });
          return {
            progress,
            completed: false,
            errors: [{ url: this.homeUrl, message: err.message }],
            stoppedReason: "robots.txt no permite el descubrimiento",
          };
        }
        throw err;
      }
    }

    progress.discovered = urls?.length ?? 0;
    if (!urls || urls.length === 0) {
      return {
        progress,
        completed: true,
        errors,
        stoppedReason: "no se descubrió ninguna URL de ficha",
      };
    }

    const provider = await getEmbeddingProvider();
    const startIndex = (checkpoint.index as number) ?? 0;
    let processedInBatch = 0;
    let stoppedReason: string | null = null;

    await setPhase("scraping", "job", `procesando fichas desde el índice ${startIndex}`);

    for (let i = startIndex; i < urls.length; i++) {
      if (options.shouldCancel?.()) {
        checkpoint.index = i;
        stoppedReason = "cancelado desde el admin";
        break;
      }
      if (processedInBatch >= batchSize) {
        checkpoint.index = i;
        stoppedReason = `lote de ${batchSize} completado; el job continúa en la siguiente invocación`;
        break;
      }
      if (outOfTime()) {
        checkpoint.index = i;
        stoppedReason = "presupuesto de tiempo de la invocación agotado; se reanudará desde el checkpoint";
        break;
      }

      const url = urls[i];
      processedInBatch++;
      const itemStarted = Date.now();

      try {
        log({
          stage: "navigate",
          level: "info",
          message: `producto ${i + 1}/${urls.length}`,
          url,
        });

        // Incremental: si ya tenemos la ficha, no re-scrapeamos — solo
        // refrescamos lastSeenAt. Es lo que abarata pasar cada día.
        if (options.mode === "incremental") {
          const existing = await options.store.findByCanonicalUrl(this.canonicalize(url));
          if (existing) {
            existing.lastSeenAt = new Date().toISOString();
            await options.store.saveProduct(existing);
            progress.duplicates++;
            checkpoint.index = i + 1;
            log({
              stage: "database",
              level: "debug",
              message: "ya en catálogo (incremental): solo se refresca lastSeenAt",
              url,
              productId: existing.id,
            });
            continue;
          }
        }

        const scraped = await this.scrapeProduct({ url, isolationKey, log });
        const extraction = scraped.extraction;

        progress.aiCostUsd = Math.round((progress.aiCostUsd + extraction.aiCostUsd) * 1e6) / 1e6;
        progress.aiTokens +=
          (extraction.aiTokens?.prompt ?? 0) + (extraction.aiTokens?.completion ?? 0);
        if (extraction.browserUsed) progress.withBrowser++;

        if (extraction.productType === "listing") {
          progress.ignored++;
          checkpoint.index = i + 1;
          log({
            stage: "normalize",
            level: "warn",
            message: "descartada: la página es un listado, no una ficha",
            url,
          });
          continue;
        }

        progress.fetched++;
        if (extraction.aiUsed) progress.withAi++;
        else progress.withoutAi++;

        const normalized = await this.normalizeProduct(scraped);
        log({
          stage: "normalize",
          level: "success",
          message:
            `normalizado con ${extraction.primaryExtractor ?? "?"}` +
            ` · confianza ${extraction.confidence.toFixed(2)}` +
            (extraction.aiUsed ? " · con IA" : " · sin IA"),
          url,
          durationMs: Date.now() - itemStarted,
          metadata: {
            extractors: extraction.extractorsUsed,
            aiUsed: extraction.aiUsed,
            browserUsed: extraction.browserUsed,
            price: normalized.price,
            currency: normalized.currency,
            warnings: extraction.warnings.length > 0 ? extraction.warnings : undefined,
          },
        });

        // Imagen principal: descarga + hashes + embedding (best-effort)
        if (options.downloadImages !== false && normalized.primaryImage) {
          const imgStarted = Date.now();
          const processed = await downloadAndProcessImage(normalized.primaryImage);
          if (processed) {
            normalized.images[0] = {
              url: normalized.primaryImage,
              localPath: processed.localPath,
              sha256: processed.sha256,
              perceptualHash: processed.perceptualHash,
              width: processed.width,
              height: processed.height,
            };
            normalized.perceptualHash = processed.perceptualHash;
            normalized.imageEmbedding = processed.embedding;
            log({
              stage: "download_image",
              level: "success",
              message: `imagen procesada (${processed.width ?? "?"}×${processed.height ?? "?"})`,
              url: normalized.primaryImage,
              durationMs: Date.now() - imgStarted,
            });
          } else {
            log({
              stage: "download_image",
              level: "warn",
              message: "la imagen principal no se pudo descargar/procesar",
              url: normalized.primaryImage,
            });
          }
        }

        const embStarted = Date.now();
        normalized.textEmbedding = await provider.embedText(
          `${normalized.brand ?? ""} ${normalized.title} ${normalized.category ?? ""} ${normalized.color ?? ""}`
        );
        log({
          stage: "embedding",
          level: "success",
          message: `embeddings generados con ${provider.name} (${provider.dimension()}d${
            provider.name === "hash" ? ", FALLBACK de desarrollo" : ""
          })`,
          url,
          durationMs: Date.now() - embStarted,
          metadata: {
            provider: provider.name,
            model: provider.model,
            productionGrade: provider.name !== "hash",
          },
        });

        const result = await ingestProduct(options.store, normalized);
        if (result.isNew) progress.new++;
        else if (result.deduplicated) progress.duplicates++;
        else if (result.changed) progress.updated++;
        else progress.duplicates++;

        log({
          stage: "database",
          level: "success",
          message: result.isNew
            ? "producto creado"
            : result.deduplicated
              ? `duplicado de ${result.product.id} (nivel ${result.dedupLevel ?? "?"})`
              : result.changed
                ? "producto actualizado"
                : "sin cambios (mismo contentHash)",
          url,
          productId: result.product.id,
          metadata: { isNew: result.isNew, changed: result.changed },
        });
      } catch (err) {
        if (err instanceof BrowserChallengeError) {
          checkpoint.index = i;
          progress.errors++;
          errors.push({ url, message: err.message });
          log({ stage: "error", level: "error", message: err.message, url });
          stoppedReason = "la tienda presenta un challenge anti-bot; no se intenta eludir";
          break;
        }
        if (err instanceof CircuitOpenError) {
          checkpoint.index = i;
          errors.push({ url, message: err.message });
          log({ stage: "error", level: "error", message: err.message, url });
          stoppedReason = "circuit breaker abierto por fallos consecutivos";
          break;
        }
        if (err instanceof RobotsDisallowedError) {
          progress.ignored++;
          log({ stage: "robots", level: "warn", message: err.message, url });
          checkpoint.index = i + 1;
          continue;
        }
        progress.errors++;
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ url, message });
        log({
          stage: "error",
          level: "error",
          message,
          url,
          durationMs: Date.now() - itemStarted,
        });
      }

      checkpoint.index = i + 1;
      checkpoint.progress = { ...progress };
      if (processedInBatch % CHECKPOINT_EVERY === 0) {
        await options.onProgress?.(progress, checkpoint);
      }
    }

    const index = (checkpoint.index as number) ?? 0;
    const completed = stoppedReason == null && index >= urls.length && (discovery?.done ?? true);
    checkpoint.progress = { ...progress };
    progress.stage = completed ? "complete" : progress.stage;
    await options.onProgress?.(progress, checkpoint);

    if (completed) {
      log({
        stage: "complete",
        level: "success",
        message:
          `job completado: ${progress.new} nuevos, ${progress.updated} actualizados, ` +
          `${progress.duplicates} duplicados, ${progress.errors} errores · ` +
          `IA en ${progress.withAi}/${progress.fetched} fichas · ` +
          `coste estimado ${progress.aiCostUsd.toFixed(6)} USD`,
        durationMs: Date.now() - startedAt,
        metadata: { progress: { ...progress } },
      });
    } else {
      log({
        stage: "job",
        level: "info",
        message: `pausa del job: ${stoppedReason ?? "queda trabajo pendiente"} (índice ${index}/${urls.length})`,
        durationMs: Date.now() - startedAt,
      });
    }

    return { progress, completed, errors, stoppedReason };
  }

  /**
   * healthCheck live y HONESTO: una petición real (respetando robots.txt) a
   * la portada. Reporta lo que hay: si la tienda bloquea (403/challenge),
   * `blocked` — sin intentar eludirlo jamás.
   */
  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    const started = Date.now();
    const crawlDelaySeconds = (await domainRobots(this.homeUrl)).crawlDelaySeconds;
    try {
      const res = await this.fetchFn(this.homeUrl);
      const latencyMs = Date.now() - started;
      if (res.status >= 200 && res.status < 300) {
        this.resetCircuit();
        return {
          status: "available",
          note: `HTTP ${res.status} en ${this.homeUrl}`,
          checkedAt,
          latencyMs,
          httpStatus: res.status,
          crawlDelaySeconds,
        };
      }
      if (res.status === 403 || res.status === 429 || res.status === 401) {
        return {
          status: "blocked",
          note: `la tienda bloquea el acceso automatizado (HTTP ${res.status}); no se intenta eludir`,
          checkedAt,
          latencyMs,
          httpStatus: res.status,
          crawlDelaySeconds,
        };
      }
      return {
        status: "error",
        note: `HTTP ${res.status} en ${this.homeUrl}`,
        checkedAt,
        latencyMs,
        httpStatus: res.status,
        crawlDelaySeconds,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      if (err instanceof RobotsDisallowedError) {
        return {
          status: "disallowed",
          note: "robots.txt no permite el acceso",
          checkedAt,
          latencyMs,
          httpStatus: null,
          crawlDelaySeconds,
        };
      }
      return {
        status: "error",
        note: err instanceof Error ? err.message : String(err),
        checkedAt,
        latencyMs,
        httpStatus: null,
        crawlDelaySeconds,
      };
    }
  }

  /**
   * Prueba end-to-end del pipeline con UNA sola ficha: robots → descubrimiento
   * → fetch → datos estructurados → normalización. Es lo que el admin dispara
   * en "Probar conector": dice exactamente en qué paso se rompe una fuente.
   */
  async testConnector(): Promise<ConnectorTestResult> {
    const steps: ConnectorTestResult["steps"] = [];
    const startedAll = Date.now();
    const track = async <T>(
      step: ConnectorTestResult["steps"][number]["step"],
      fn: () => Promise<T>
    ): Promise<T | null> => {
      const t0 = Date.now();
      try {
        const value = await fn();
        steps.push({ step, ok: true, detail: describeTestValue(step, value), ms: Date.now() - t0 });
        return value;
      } catch (err) {
        steps.push({
          step,
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
          ms: Date.now() - t0,
        });
        return null;
      }
    };

    const fail = (scraped?: ScrapedProduct | null): ConnectorTestResult => ({
      ok: false,
      steps,
      sampleUrl: scraped?.url ?? null,
      sampleTitle: null,
      samplePrice: null,
      sampleImage: null,
      extractorsUsed: scraped?.extraction.extractorsUsed ?? [],
      aiUsed: scraped?.extraction.aiUsed ?? false,
      browserUsed: scraped?.extraction.browserUsed ?? false,
      durationMs: Date.now() - startedAll,
    });

    const health = await track("robots", async () => {
      const h = await this.healthCheck();
      if (h.status !== "available") throw new Error(h.note);
      return h;
    });
    if (!health) return fail();

    const urls = await track("discovery", async () => {
      const { urls: found, strategiesUsed } = await this.discoverProductUrls({ limit: 1 });
      if (found.length === 0) {
        throw new Error(
          "ninguna estrategia devolvió URLs de ficha (revisa discoveryStrategies/productUrlPattern del spec o el robots.txt de la tienda)"
        );
      }
      return { found, strategiesUsed };
    });
    if (!urls) return fail();

    const scraped = await track("fetch", async () => {
      const s = await this.scrapeProduct({ url: urls.found[0] });
      if (!s.extraction.title && s.extraction.price == null) {
        throw new Error(
          `la ficha no devolvió datos usables (extractores probados: ${s.extraction.extractorsUsed.join(", ") || "ninguno"})`
        );
      }
      return s;
    });
    if (!scraped) return fail();

    await track("structured_data", async () => {
      const used = scraped.extraction.extractorsUsed;
      if (used.includes("jsonld")) return "JSON-LD";
      if (used.includes("microdata")) return "microdata";
      if (used.includes("embedded")) return "JSON embebido";
      if (used.includes("opengraph")) return "OpenGraph";
      throw new Error(
        `sin datos estructurados; se resolvió con ${used.join(", ") || "nada"}${scraped.extraction.aiUsed ? " (incluida IA)" : ""}`
      );
    });

    const normalized = await track("normalize", async () => this.normalizeProduct(scraped));
    if (!normalized) return fail(scraped);

    return {
      ok: steps.every((s) => s.ok),
      steps,
      sampleUrl: scraped.url,
      sampleTitle: normalized.title,
      samplePrice: normalized.price,
      sampleImage: normalized.primaryImage,
      extractorsUsed: scraped.extraction.extractorsUsed,
      aiUsed: scraped.extraction.aiUsed,
      browserUsed: scraped.extraction.browserUsed,
      durationMs: Date.now() - startedAll,
    };
  }
}

/** Completa una URL relativa contra la de la ficha. */
function absolutize(url: string, base: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function describeTestValue(step: string, value: unknown): string {
  if (step === "robots") return "portada accesible y permitida por robots.txt";
  if (step === "discovery") {
    const v = value as { found: string[]; strategiesUsed: string[] };
    return `${v.found.length} URL de ficha descubierta vía ${v.strategiesUsed.join(", ") || "?"}`;
  }
  if (step === "fetch") {
    const v = value as ScrapedProduct;
    return `ficha extraída con ${v.extraction.extractorsUsed.join(", ")}${v.extraction.aiUsed ? " (IA usada)" : ""}`;
  }
  if (step === "structured_data") return `datos estructurados: ${String(value)}`;
  if (step === "normalize") return `normalizado: ${(value as NormalizedProduct).title}`;
  return "ok";
}

/**
 * Conector genérico configurado 100% por spec: descubrimiento por sitemap o
 * crawl de categorías + extracción por capas. Cubre la mayoría de tiendas de
 * moda; solo se hace subclase si la tienda necesita algo propio.
 */
export class DeclarativeConnector extends BaseConnector {}

/**
 * Conector reservado en el registro pero SIN vía de acceso legítima todavía
 * (requiere API de partner, red de afiliación o revisión legal).
 *
 * No finge: `syncProducts` lanza con el motivo exacto y `healthCheck` devuelve
 * `not_checked` en lugar de inventar disponibilidad. Existe para que el admin
 * refleje el roadmap real de fuentes sin mentir sobre su estado.
 */
export class ScaffoldConnector extends BaseConnector {
  async syncProducts(_options: SyncOptions): Promise<SyncSummary> {
    throw new Error(
      `conector ${this.id} no sincroniza: ${this.spec.notes} (lifecycle: ${this.spec.lifecycle})`
    );
  }

  async healthCheck(): Promise<ConnectorHealth> {
    return {
      status: "not_checked",
      note: this.spec.notes,
      checkedAt: new Date().toISOString(),
      httpStatus: null,
    };
  }

  async testConnector(): Promise<ConnectorTestResult> {
    return {
      ok: false,
      steps: [
        {
          step: "robots",
          ok: false,
          detail: `sin implementación activa: ${this.spec.notes}`,
          ms: 0,
        },
      ],
      sampleUrl: null,
      sampleTitle: null,
      samplePrice: null,
      sampleImage: null,
      extractorsUsed: [],
      aiUsed: false,
      browserUsed: false,
      durationMs: 0,
    };
  }
}

/**
 * Caché de IA compartida por TODOS los conectores del proceso: dos fuentes del
 * mismo grupo (o dos jobs) que tocan la misma ficha no la pagan dos veces.
 *
 * Arranca en memoria y el servicio la sustituye por la versión con respaldo en
 * base de datos (`installSharedAiCache`) cuando hay Postgres — así importar
 * este módulo nunca obliga a tener base de datos.
 */
let sharedAiCache: AiExtractionCache = new MemoryAiCache();

function getSharedAiCache(): AiExtractionCache {
  return sharedAiCache;
}

/** Instala la caché de IA compartida (la persistente, en el arranque). */
export function installSharedAiCache(cache: AiExtractionCache): void {
  sharedAiCache = cache;
}
