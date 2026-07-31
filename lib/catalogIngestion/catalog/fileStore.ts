import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type {
  CatalogProduct,
  JobRecord,
  PricePoint,
  ProductFilters,
  SourceState,
} from "./types";
import { hydrateProduct } from "./types";
import type { CatalogStore, ExtractionStats, StoreStats } from "./store";
import { aggregateExtractionStats } from "./store";
import { getConfig } from "../config/index";
import { normalizeText } from "../normalization/normalize";

/**
 * Store en fichero JSON (data/catalog.json). Es el backend por defecto cuando
 * no hay DATABASE_URL válida — el .env heredado del proyecto tiene la URL REST
 * de Neon, así que este backend es el que sostiene la demo E2E completa.
 *
 * La búsqueda vectorial se hace por similitud coseno en memoria: con miles de
 * productos es instantánea; para cientos de miles hace falta Postgres+pgvector.
 * Escritura atómica (tmp + rename) para no corromper el fichero si el proceso
 * muere a mitad de un save.
 */

interface FileData {
  products: Record<string, CatalogProduct>;
  sources: Record<string, SourceState>;
  jobs: Record<string, JobRecord>;
  duplicatesDetected: number;
}

export class FileCatalogStore implements CatalogStore {
  readonly backend = "file" as const;
  private data: FileData = { products: {}, sources: {}, jobs: {}, duplicatesDetected: 0 };
  private path = "";
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(customPath?: string) {
    this.path = customPath ?? join(getConfig().dataDir, "catalog.json");
  }

  async init(): Promise<void> {
    mkdirSync(join(this.path, ".."), { recursive: true });
    if (existsSync(this.path)) {
      try {
        this.data = JSON.parse(readFileSync(this.path, "utf8"));
        this.data.duplicatesDetected ??= 0;
        this.data.jobs ??= {};
        this.data.sources ??= {};
        // Igual que en Postgres: el fichero puede venir de un esquema anterior.
        // Se hidrata una vez al cargar en vez de en cada lectura.
        for (const [id, product] of Object.entries(this.data.products)) {
          this.data.products[id] = hydrateProduct(product);
        }
      } catch {
        // Fichero corrupto: empezamos vacío antes que impedir el arranque.
        this.data = { products: {}, sources: {}, jobs: {}, duplicatesDetected: 0 };
      }
    }
  }

  async close(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.flush();
  }

  /** Guardado con debounce: los syncs escriben cientos de veces seguidas. */
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 250);
    // No mantengas vivo el proceso solo por un save pendiente
    this.saveTimer.unref?.();
  }

  private flush(): void {
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.path);
  }

  async saveProduct(product: CatalogProduct): Promise<void> {
    this.data.products[product.id] = product;
    this.scheduleSave();
  }

  async getProduct(id: string): Promise<CatalogProduct | null> {
    return this.data.products[id] ?? null;
  }

  async listProducts(filters: ProductFilters): Promise<{ items: CatalogProduct[]; total: number }> {
    const q = filters.q ? normalizeText(filters.q) : null;
    let items = Object.values(this.data.products).filter((p) => {
      if (filters.source && p.source !== filters.source) return false;
      if (filters.category && p.category !== filters.category) return false;
      if (filters.brand && normalizeText(p.brand) !== normalizeText(filters.brand)) return false;
      if (filters.active !== undefined && p.isActive !== filters.active) return false;
      if (filters.origin && p.origin !== filters.origin) return false;
      if (filters.embeddingStatus && p.embeddingStatus !== filters.embeddingStatus) return false;
      if (filters.color && normalizeText(p.color) !== normalizeText(filters.color)) return false;
      if (filters.gender && normalizeText(p.gender) !== normalizeText(filters.gender)) return false;
      if (q && !normalizeText(`${p.title} ${p.brand} ${p.description}`).includes(q)) return false;
      return true;
    });
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const total = items.length;
    const limit = Math.min(filters.limit ?? 20, 100);
    const page = Math.max(filters.page ?? 1, 1);
    items = items.slice((page - 1) * limit, page * limit);
    return { items, total };
  }

  async findBySourceProductId(source: string, sourceProductId: string): Promise<CatalogProduct | null> {
    return (
      Object.values(this.data.products).find(
        (p) => p.source === source && p.sourceProductId === sourceProductId
      ) ?? null
    );
  }

  async findByCanonicalUrl(url: string): Promise<CatalogProduct | null> {
    return Object.values(this.data.products).find((p) => p.canonicalUrl === url) ?? null;
  }

  async findBySku(sku: string): Promise<CatalogProduct | null> {
    return (
      Object.values(this.data.products).find(
        (p) => p.sku === sku || p.variants.some((v) => v.sku === sku)
      ) ?? null
    );
  }

  async findByGtin(gtin: string): Promise<CatalogProduct | null> {
    return Object.values(this.data.products).find((p) => p.gtin === gtin) ?? null;
  }

  async findByImageSha256(sha256: string): Promise<CatalogProduct | null> {
    return (
      Object.values(this.data.products).find((p) =>
        p.images.some((i) => i.sha256 === sha256)
      ) ?? null
    );
  }

  async allProducts(): Promise<CatalogProduct[]> {
    return Object.values(this.data.products);
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const p = this.data.products[id];
    if (!p) return;
    p.isActive = active;
    p.updatedAt = new Date().toISOString();
    this.scheduleSave();
  }

  async recordPrice(id: string, point: PricePoint): Promise<void> {
    const p = this.data.products[id];
    if (!p) return;
    p.priceHistory.push(point);
    // Histórico acotado: 200 puntos por producto son años de datos diarios
    if (p.priceHistory.length > 200) p.priceHistory = p.priceHistory.slice(-200);
    this.scheduleSave();
  }

  async countProducts(source?: string): Promise<number> {
    if (!source) return Object.keys(this.data.products).length;
    return Object.values(this.data.products).filter((p) => p.source === source).length;
  }

  async countProductsBySource(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const p of Object.values(this.data.products)) {
      counts.set(p.source, (counts.get(p.source) ?? 0) + 1);
    }
    return counts;
  }

  async incrementDuplicates(n = 1): Promise<void> {
    this.data.duplicatesDetected += n;
    this.scheduleSave();
  }

  async getSourceState(id: string): Promise<SourceState> {
    return this.data.sources[id] ?? { id, paused: false, lastSyncAt: null };
  }

  async getAllSourceStates(): Promise<Map<string, SourceState>> {
    return new Map(Object.entries(this.data.sources));
  }

  async setSourceState(state: SourceState): Promise<void> {
    this.data.sources[state.id] = state;
    this.scheduleSave();
  }

  async saveJob(job: JobRecord): Promise<void> {
    this.data.jobs[job.jobId] = job;
    this.scheduleSave();
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    return this.data.jobs[jobId] ?? null;
  }

  async listJobs(limit: number): Promise<JobRecord[]> {
    return Object.values(this.data.jobs)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async stats(): Promise<StoreStats> {
    const products = Object.values(this.data.products);
    const bySource: Record<string, number> = {};
    const byOrigin: Record<string, number> = {};
    const jobs: Record<string, number> = {};
    for (const p of products) {
      bySource[p.source] = (bySource[p.source] ?? 0) + 1;
      byOrigin[p.origin] = (byOrigin[p.origin] ?? 0) + 1;
    }
    for (const j of Object.values(this.data.jobs)) {
      jobs[j.status] = (jobs[j.status] ?? 0) + 1;
    }
    return {
      totalProducts: products.length,
      activeProducts: products.filter((p) => p.isActive).length,
      bySource,
      byOrigin,
      withImages: products.filter((p) => p.images.length > 0).length,
      withEmbeddings: products.filter((p) => p.imageEmbedding != null).length,
      duplicatesDetected: this.data.duplicatesDetected,
      jobs,
    };
  }

  async extractionStats(source?: string): Promise<ExtractionStats> {
    const products = Object.values(this.data.products).filter(
      (p) => !source || p.source === source
    );
    return aggregateExtractionStats(products);
  }

  async extractionStatsBySource(): Promise<Map<string, ExtractionStats>> {
    const bySource = new Map<string, CatalogProduct[]>();
    for (const p of Object.values(this.data.products)) {
      const bucket = bySource.get(p.source);
      if (bucket) bucket.push(p);
      else bySource.set(p.source, [p]);
    }
    return new Map(
      [...bySource].map(([source, products]) => [
        source,
        aggregateExtractionStats(products),
      ])
    );
  }
}
