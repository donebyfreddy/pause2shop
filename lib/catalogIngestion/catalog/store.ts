import type {
  CatalogProduct,
  JobRecord,
  PricePoint,
  ProductFilters,
  SourceState,
} from "./types";
import { isDatabaseConfigured } from "../database/pool";
import { logger } from "../observability/logger";

/**
 * Abstracción de persistencia con dos backends (mismo patrón resiliente que
 * pause2shop/lib/catalog): PostgresCatalogStore cuando hay DATABASE_URL
 * válida, FileCatalogStore (JSON en data/) en caso contrario. TODO el sistema
 * — API, jobs, demo — funciona completo con el backend de fichero.
 */

export interface StoreStats {
  totalProducts: number;
  activeProducts: number;
  bySource: Record<string, number>;
  byOrigin: Record<string, number>;
  withImages: number;
  withEmbeddings: number;
  duplicatesDetected: number;
  jobs: Record<string, number>;
}

/**
 * Cómo se han extraído los productos de una fuente. Es lo que responde en el
 * admin a "¿cuánto de esta fuente ha necesitado IA?" con datos, no con una
 * impresión.
 */
export interface ExtractionStats {
  total: number;
  withAi: number;
  withoutAi: number;
  withBrowser: number;
  /** 0–1. Null si no hay productos con metadatos de extracción. */
  aiRatio: number | null;
  /** Confianza media de la extracción, o null. */
  avgConfidence: number | null;
  aiCostUsd: number;
  /** Cuántos productos ha resuelto cada extractor principal. */
  byPrimaryExtractor: Record<string, number>;
}

export function emptyExtractionStats(): ExtractionStats {
  return {
    total: 0,
    withAi: 0,
    withoutAi: 0,
    withBrowser: 0,
    aiRatio: null,
    avgConfidence: null,
    aiCostUsd: 0,
    byPrimaryExtractor: {},
  };
}

export interface CatalogStore {
  readonly backend: "postgres" | "file";
  init(): Promise<void>;
  close(): Promise<void>;

  // --- productos ---
  saveProduct(product: CatalogProduct): Promise<void>;
  getProduct(id: string): Promise<CatalogProduct | null>;
  listProducts(filters: ProductFilters): Promise<{ items: CatalogProduct[]; total: number }>;
  findBySourceProductId(source: string, sourceProductId: string): Promise<CatalogProduct | null>;
  findByCanonicalUrl(url: string): Promise<CatalogProduct | null>;
  findBySku(sku: string): Promise<CatalogProduct | null>;
  findByGtin(gtin: string): Promise<CatalogProduct | null>;
  findByImageSha256(sha256: string): Promise<CatalogProduct | null>;
  /** Candidatos para matching/dedup en memoria. En Postgres se limita el
   * conjunto; con pgvector la búsqueda vectorial se hace en SQL. */
  allProducts(): Promise<CatalogProduct[]>;
  setActive(id: string, active: boolean): Promise<void>;
  recordPrice(id: string, point: PricePoint): Promise<void>;
  countProducts(source?: string): Promise<number>;
  incrementDuplicates(n?: number): Promise<void>;

  // --- fuentes ---
  getSourceState(id: string): Promise<SourceState>;
  setSourceState(state: SourceState): Promise<void>;

  // --- jobs ---
  saveJob(job: JobRecord): Promise<void>;
  getJob(jobId: string): Promise<JobRecord | null>;
  listJobs(limit: number): Promise<JobRecord[]>;

  stats(): Promise<StoreStats>;
  /** Estadísticas de extracción, globales o de una fuente. */
  extractionStats(source?: string): Promise<ExtractionStats>;
}

/** Agrega estadísticas de extracción en memoria (lo usan los dos backends). */
export function aggregateExtractionStats(products: CatalogProduct[]): ExtractionStats {
  const stats = emptyExtractionStats();
  let confidenceSum = 0;
  let confidenceCount = 0;
  for (const p of products) {
    const meta = p.extraction;
    if (!meta) continue;
    stats.total++;
    if (meta.aiUsed) stats.withAi++;
    else stats.withoutAi++;
    if (meta.browserUsed) stats.withBrowser++;
    stats.aiCostUsd += meta.aiCostUsd ?? 0;
    if (typeof meta.confidence === "number") {
      confidenceSum += meta.confidence;
      confidenceCount++;
    }
    const primary = meta.primaryExtractor ?? "desconocido";
    stats.byPrimaryExtractor[primary] = (stats.byPrimaryExtractor[primary] ?? 0) + 1;
  }
  stats.aiRatio = stats.total > 0 ? Math.round((stats.withAi / stats.total) * 100) / 100 : null;
  stats.avgConfidence =
    confidenceCount > 0 ? Math.round((confidenceSum / confidenceCount) * 100) / 100 : null;
  stats.aiCostUsd = Math.round(stats.aiCostUsd * 1e6) / 1e6;
  return stats;
}

let activeStore: CatalogStore | null = null;

/** Selección automática del backend según isDatabaseConfigured(). */
export async function getStore(): Promise<CatalogStore> {
  if (activeStore) return activeStore;
  if (isDatabaseConfigured()) {
    const { PostgresCatalogStore } = await import("./postgresStore");
    const store = new PostgresCatalogStore();
    try {
      await store.init();
      activeStore = store;
      logger.info("store: backend postgres activo");
      return store;
    } catch (err) {
      if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        throw new Error(
          `catalog ingestion requires reachable Postgres in production: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      logger.warn("store: postgres no disponible, degradando a fichero", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error(
      "catalog ingestion requires DATABASE_URL in production; filesystem persistence is not durable on Vercel"
    );
  }
  const { FileCatalogStore } = await import("./fileStore");
  const store = new FileCatalogStore();
  await store.init();
  activeStore = store;
  logger.info("store: backend fichero activo (data/)");
  return store;
}

/** Solo para tests: inyecta o resetea el store activo. */
export function setStoreForTests(store: CatalogStore | null): void {
  activeStore = store;
}
