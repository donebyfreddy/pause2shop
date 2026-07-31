/**
 * Modelo normalizado del catálogo. Un producto "maestro" agrupa variantes
 * (color/talla), imágenes e histórico de precios. Este es el contrato interno
 * que comparten conectores, stores y API.
 */

export type Availability = "in_stock" | "out_of_stock" | "unknown";

/**
 * Procedencia de la ficha.
 *
 * `dataset_demo` son productos importados de un dataset público de
 * investigación: sirven para probar el matching visual sin depender del
 * scraping de tiendas reales. No tienen precio, ni stock, ni URL de compra,
 * porque el dataset no los trae — y por eso NO se puede ofrecer "Comprar"
 * sobre ellos. Se marcan aparte precisamente para que nadie los confunda con
 * catálogo comercial vivo.
 */
export type Origin = "scraped" | "externally_discovered" | "dataset_demo";

/**
 * Estado del embedding de una ficha. Existe porque `image_embedding is not
 * null` no distingue tres casos que hay que tratar distinto: nunca intentado,
 * intentado y fallido, y omitido a propósito. Sin la distinción no se puede
 * reintentar solo lo fallido.
 */
export type EmbeddingStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "skipped";

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

/**
 * Trazabilidad de la importación desde un dataset. Permite reimportar tras un
 * cambio upstream (comparando `version`) y borrar un dataset concreto sin
 * tocar el catálogo scrapeado.
 */
export interface DatasetProvenance {
  /** Id del dataset en el registro interno, ej. "fashion-product-images-small". */
  id: string;
  /** Repo real del que se leyó, ej. "hgjun/fashion-product-images-small". */
  repo: string;
  provider: "huggingface" | "kaggle";
  /** Revisión/commit del dataset, o "unknown" si el proveedor no la expone. */
  version: string;
  split: string;
  /** Índice de fila en el split — hace la importación reanudable y auditable. */
  rowIndex: number;
  importedAt: string;
  /**
   * Campos que este dataset NO contiene y que por tanto quedan a null. Se
   * enumeran explícitamente para que la UI pueda decir "dato no disponible en
   * dataset" en vez de dejar un hueco que parezca un fallo de scraping.
   */
  unavailableFields: string[];
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
  /** Ciclo de vida del embedding. Ver `EmbeddingStatus`. */
  embeddingStatus: EmbeddingStatus;
  /**
   * Proveedor y dimensión con los que se generó `imageEmbedding`. Se guardan
   * porque un índice con vectores de 64d (hash) y 512d (CLIP) mezclados hace
   * que `matchProducts` descarte los de dimensión distinta en silencio: sin
   * esto, un reindex a medias parece funcionar y en realidad no busca nada.
   */
  embeddingProvider: string | null;
  embeddingDimension: number | null;
  /** Dataset de procedencia. Solo en `origin = "dataset_demo"`. */
  dataset: DatasetProvenance | null;
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

/**
 * Normaliza un producto persistido por una versión anterior del esquema.
 *
 * Hace falta porque el catálogo se lee del `doc` jsonb, no de las columnas: una
 * ficha guardada antes de que existiera `embeddingStatus` vuelve sin ese campo,
 * y el tipo lo declara obligatorio. Sin esta hidratación, el código que hace
 * `product.embeddingStatus === "pending"` recibiría `undefined` y contaría mal.
 *
 * El estado se deduce del dato que sí hay: si tiene vector, está listo.
 */
export function hydrateProduct(raw: CatalogProduct): CatalogProduct {
  if (raw.embeddingStatus && raw.dataset !== undefined) return raw;
  return {
    ...raw,
    embeddingStatus:
      raw.embeddingStatus ?? (raw.imageEmbedding ? "ready" : "pending"),
    embeddingProvider: raw.embeddingProvider ?? null,
    embeddingDimension:
      raw.embeddingDimension ?? raw.imageEmbedding?.length ?? null,
    dataset: raw.dataset ?? null,
  };
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
  | "downloading"
  | "scraping"
  | "normalizing"
  | "uploading_images"
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
  "downloading",
  "scraping",
  "normalizing",
  "uploading_images",
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
  | "retry_failed"
  | "dataset_import";

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
  /** Imágenes subidas con éxito a storage persistente. */
  imagesUploaded: number;
  /** Imágenes que ya estaban en storage y no se resubieron. */
  imagesSkipped: number;
  /** Embeddings generados con éxito en este job. */
  embeddingsReady: number;
  /** Fichas guardadas con el embedding en cola (embeddingStatus=pending). */
  embeddingsQueued: number;
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
    imagesUploaded: 0,
    imagesSkipped: 0,
    embeddingsReady: 0,
    embeddingsQueued: 0,
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
  /**
   * Los tres siguientes se filtran en SERVIDOR a propósito.
   *
   * El admin filtraba `origin` en cliente sobre la página ya cargada, con un
   * aviso de que solo aplicaba a esos 24 resultados. Con un catálogo de miles de
   * fichas eso no es un filtro: es una coincidencia. `color` y `gender` viven en
   * el `doc` jsonb y `embeddingStatus` tiene columna e índice propios.
   */
  color?: string;
  gender?: string;
  embeddingStatus?: EmbeddingStatus;
  page?: number;
  limit?: number;
}
