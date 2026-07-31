/**
 * Contrato del importador de datasets de catálogo.
 *
 * ¿Por qué existe? Probar el matching visual requería scrapear Zara, Mango o
 * H&M, y esas tres bloquean por IP. Un dataset público de investigación da
 * miles de fichas de moda con foto sin depender de ninguna tienda ni de que
 * nadie nos deje entrar.
 *
 * El precio de esa independencia es que el dataset NO trae datos comerciales:
 * no hay precio, ni stock, ni URL de compra, ni merchant, ni SKU vigente. Esos
 * campos se quedan a null y se declaran en `unavailableFields`. Inventarlos
 * sería peor que no tenerlos: un precio falso en un catálogo es un bug que se
 * propaga hasta la UI de compra.
 */
import type { NormalizedProduct } from "../catalog/types";

export type DatasetProviderId = "huggingface" | "kaggle";

/** Fila cruda del dataset, con los nombres de campo tal cual vienen. */
export interface FashionDatasetRow {
  id: number;
  gender: string | null;
  masterCategory: string | null;
  subCategory: string | null;
  articleType: string | null;
  baseColour: string | null;
  season: string | null;
  year: number | null;
  usage: string | null;
  productDisplayName: string | null;
  /** URL de la imagen. Efímera/firmada en HuggingFace: se descarga al momento. */
  imageUrl: string | null;
  /** Índice de la fila dentro del split — la clave del checkpoint. */
  rowIndex: number;
}

/** Descriptor de un dataset soportado. */
export interface DatasetDescriptor {
  id: string;
  repo: string;
  /** Repo original del que deriva, para citar la procedencia. */
  originRepo: string;
  provider: DatasetProviderId;
  kaggleRef: string | null;
  split: string;
  config: string;
  license: string;
  /** Campos que el dataset SÍ trae de forma fiable. */
  availableFields: readonly string[];
  /** Campos que NO trae y que quedan a null. */
  unavailableFields: readonly string[];
}

export interface DatasetInfo {
  descriptor: DatasetDescriptor;
  /** Filas totales del split, según el proveedor. */
  totalRows: number | null;
  /** Revisión/commit del dataset, o "unknown". */
  version: string;
  /** Bytes del split, si el proveedor los expone. */
  sizeBytes: number | null;
  /** Esquema real leído del proveedor: nombre -> tipo. */
  features: Record<string, string>;
  /** Una fila de muestra, ya normalizada a `FashionDatasetRow`. */
  sample: FashionDatasetRow | null;
  reachable: boolean;
  /** Por qué no es alcanzable, cuando `reachable` es false. */
  unreachableReason: string | null;
}

export interface DatasetImportOptions {
  source: DatasetProviderId;
  limit: number;
  offset: number;
  batchSize: number;
  /** Filtro por `masterCategory` (ej. Apparel, Footwear). Vacío = sin filtro. */
  categories: string[];
  /** Filtro por `gender` (Men, Women, Boys, Girls, Unisex). Vacío = sin filtro. */
  genders: string[];
  generateEmbeddings: boolean;
  uploadImages: boolean;
  dryRun: boolean;
  /** Dataset a importar. Por defecto, el único registrado. */
  datasetId?: string;
}

export interface DatasetImportCounters {
  rowsRead: number;
  created: number;
  /** Fichas que EXISTÍAN y cuyo contenido ha cambiado de verdad. */
  updated: number;
  /**
   * Fichas que existían y no han cambiado: solo se ha refrescado `lastSeenAt`.
   *
   * Se cuenta aparte porque meterlas en `updated` era engañoso: una
   * reimportación idéntica reportaba "995 actualizados" cuando no había
   * reescrito ni un campo, y eso ocultó que una corrección del mapeo de
   * categorías no se estaba propagando.
   */
  unchanged: number;
  duplicates: number;
  skipped: number;
  errors: number;
  imagesUploaded: number;
  imagesSkipped: number;
  embeddingsReady: number;
  embeddingsQueued: number;
  embeddingsFailed: number;
}

export interface DatasetImportResult {
  jobId: string;
  datasetId: string;
  status: "completed" | "partially_completed" | "failed" | "cancelled" | "dry_run";
  counters: DatasetImportCounters;
  durationMs: number;
  /** Fila por la que continuaría un `resume`. */
  nextOffset: number;
  dryRun: boolean;
  /** Muestra de lo que se habría guardado. Solo en dry run. */
  preview: NormalizedProduct[];
  errors: Array<{ rowIndex: number; sourceProductId: string | null; message: string }>;
  /** Avisos honestos: storage efímero, embeddings no semánticos, etc. */
  warnings: string[];
}

/**
 * El importador. `inspect` no escribe nada y sirve para comprobar que el
 * dataset es alcanzable antes de lanzar una importación de mil fichas.
 */
export interface CatalogDatasetImporter {
  inspect(datasetId?: string): Promise<DatasetInfo>;
  import(options: Partial<DatasetImportOptions>): Promise<DatasetImportResult>;
  resume(jobId: string): Promise<DatasetImportResult>;
}

/** Estado persistido en `JobRecord.checkpoint` de un `dataset_import`. */
export interface DatasetImportCheckpoint {
  datasetId: string;
  options: DatasetImportOptions;
  /** Siguiente fila a leer. Es lo que hace la importación reanudable. */
  nextOffset: number;
  /** Fila final (exclusiva) del rango pedido. */
  endOffset: number;
  counters: DatasetImportCounters;
  version: string;
}
