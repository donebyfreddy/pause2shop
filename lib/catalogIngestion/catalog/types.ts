/**
 * Modelo normalizado del catálogo. Un producto "maestro" agrupa variantes
 * (color/talla), imágenes e histórico de precios. Este es el contrato interno
 * que comparten conectores, stores y API.
 */

export type Availability = "in_stock" | "out_of_stock" | "unknown";
export type Origin = "scraped" | "externally_discovered";

export interface ProductVariant {
  id: string;
  color: string | null;
  size: string | null;
  sku: string | null;
  price: number | null;
  currency: string | null;
  availability: Availability;
}

export interface ProductImage {
  url: string; // URL original en la tienda — siempre se conserva como referencia
  localPath: string | null; // versión optimizada en data/images/ (si se descargó)
  sha256: string | null;
  perceptualHash: string | null; // dHash 64-bit en hex
  width: number | null;
  height: number | null;
}

export interface PricePoint {
  price: number;
  originalPrice: number | null;
  currency: string;
  recordedAt: string;
}

/**
 * Trazabilidad de la extracción de una ficha: con qué extractores se resolvió,
 * si hizo falta navegador o IA, y la evidencia por campo.
 *
 * Es lo que permite al admin responder "¿de dónde ha salido este precio?" sin
 * volver a la tienda, y lo que hace auditable el uso de IA.
 */
export interface ProductExtractionMeta {
  extractorsUsed: string[];
  primaryExtractor: string | null;
  aiUsed: boolean;
  browserUsed: boolean;
  aiModel: string | null;
  aiCostUsd: number;
  aiTokens: number;
  /** Confianza agregada 0–1 de la extracción. */
  confidence: number;
  evidence: Array<{
    field: string;
    source: string;
    snippet: string;
    confidence: number;
  }>;
  warnings: string[];
  extractedAt: string;
  durationMs: number;
}

export interface CatalogProduct {
  id: string;
  source: string;
  sourceProductId: string;
  canonicalUrl: string;
  brand: string | null;
  title: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  collection: string | null;
  color: string | null;
  secondaryColors: string[];
  material: string | null;
  pattern: string | null;
  style: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string | null;
  availability: Availability;
  merchant: string | null;
  country: string | null;
  locale: string | null;
  images: ProductImage[];
  primaryImage: string | null;
  variants: ProductVariant[];
  sizes: string[];
  sku: string | null;
  gtin: string | null;
  sourceMetadata: Record<string, unknown>;
  /** Cómo se extrajo (extractores, IA, evidencia). Null en productos externos. */
  extraction: ProductExtractionMeta | null;
  contentHash: string | null; // hash del contenido normalizado — detecta cambios
  perceptualHash: string | null; // dHash de la imagen principal
  textEmbedding: number[] | null;
  imageEmbedding: number[] | null;
  priceHistory: PricePoint[];
  firstSeenAt: string;
  lastSeenAt: string;
  scrapedAt: string;
  updatedAt: string;
  isActive: boolean;
  origin: Origin;
  /** Score reportado por el proveedor externo (solo origin=externally_discovered). */
  externalScore: number | null;
}

/** Producto tal y como sale de un conector, antes de dedup/persistencia. */
export type NormalizedProduct = Omit<
  CatalogProduct,
  | "id"
  | "priceHistory"
  | "firstSeenAt"
  | "lastSeenAt"
  | "updatedAt"
  | "isActive"
  | "externalScore"
>;

/**
 * Estado del job. Los estados intermedios (`discovering`…`embedding`) son la
 * ETAPA en curso y se muestran tal cual en el admin; `running` se conserva como
 * estado genérico para jobs que no reportan etapa.
 *
 * Todo lo que no es terminal cuenta como "activo": usa `isActiveJobStatus()` en
 * vez de comparar contra "running", que dejaría fuera las etapas.
 */
export type JobStatus =
  | "queued"
  | "running"
  | "discovering"
  | "scraping"
  | "normalizing"
  | "saving"
  | "embedding"
  | "partially_completed"
  | "completed"
  | "failed"
  | "cancelled";

/** Estados en los que el job está en curso (no terminal). */
export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  "running",
  "discovering",
  "scraping",
  "normalizing",
  "saving",
  "embedding",
];

export function isActiveJobStatus(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return ["completed", "partially_completed", "failed", "cancelled"].includes(status);
}

export type JobType =
  | "sync_full"
  | "sync_incremental"
  | "refresh_prices"
  | "refresh_availability"
  | "reindex_embeddings"
  | "cleanup_inactive"
  | "retry_failed";

/**
 * Contadores del job. Todos son observables desde el admin y ninguno se
 * inventa: `withAi` + `withoutAi` = fichas extraídas con éxito, y el coste es
 * la suma de las llamadas realmente pagadas (los aciertos de caché son 0).
 */
export interface JobProgress {
  discovered: number;
  fetched: number;
  new: number;
  updated: number;
  duplicates: number;
  errors: number;
  /** Descartadas a propósito: listados, fichas sin datos mínimos. */
  ignored: number;
  /** Reintentos consumidos (no fichas: intentos). */
  retries: number;
  /** Fichas cuya extracción necesitó la IA. */
  withAi: number;
  /** Fichas resueltas SIN IA (datos estructurados o DOM). */
  withoutAi: number;
  /** Fichas que necesitaron renderizado con navegador. */
  withBrowser: number;
  /** Coste estimado en USD de las llamadas a la IA de este job. */
  aiCostUsd: number;
  aiTokens: number;
  /** Etapa en curso. Null en jobs que no reportan etapas. */
  stage: string | null;
}

/** Progreso a cero. Único sitio donde se construye: evita contadores olvidados. */
export function emptyJobProgress(): JobProgress {
  return {
    discovered: 0,
    fetched: 0,
    new: 0,
    updated: 0,
    duplicates: 0,
    errors: 0,
    ignored: 0,
    retries: 0,
    withAi: 0,
    withoutAi: 0,
    withBrowser: 0,
    aiCostUsd: 0,
    aiTokens: 0,
    stage: null,
  };
}

/** Normaliza un progreso persistido por una versión anterior del esquema. */
export function hydrateJobProgress(raw: Partial<JobProgress> | null | undefined): JobProgress {
  return { ...emptyJobProgress(), ...(raw ?? {}) };
}

export interface JobError {
  url: string;
  message: string;
  at: string;
}

export interface JobRecord {
  jobId: string;
  type: JobType;
  source: string | null;
  mode: "full" | "incremental" | null;
  limit: number | null;
  status: JobStatus;
  progress: JobProgress;
  /** Checkpoint persistente: permite reanudar un sync donde se quedó. */
  checkpoint: Record<string, unknown>;
  errors: JobError[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  cancelRequested: boolean;
}

export interface SourceState {
  id: string;
  paused: boolean;
  lastSyncAt: string | null;
}

export interface ProductFilters {
  source?: string;
  category?: string;
  brand?: string;
  q?: string;
  active?: boolean;
  origin?: Origin;
  page?: number;
  limit?: number;
}
