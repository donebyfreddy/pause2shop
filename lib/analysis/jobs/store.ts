import { isDatabaseConfigured } from "@/lib/db/pool";
import { PostgresAnalysisJobStore } from "./pgStore";
import type {
  AnalysisJobRecord,
  JobRuntimeState,
  MatchProgressState,
  UniqueProductRecord,
} from "./types";

/**
 * Store de jobs de análisis con dos implementaciones (mismo patrón que
 * lib/catalog): memoria (siempre disponible, modo demo) y Postgres
 * (migración 20260718000005_analysis_jobs.sql, vía isDatabaseConfigured()).
 *
 * ESCALADO A MÚLTIPLES WORKERS (documentación de diseño):
 *  - Todo el estado del job (checkpoint, tracker serializado, escenas,
 *    apariciones) vive aquí, no en variables del route handler: cualquier
 *    instancia puede continuar un job leyendo el runtime state.
 *  - El motor asume UN escritor por job a la vez (los lotes del cliente son
 *    secuenciales). Para N workers en paralelo bastaría con: (a) particionar
 *    el vídeo en segmentos disjuntos por worker, (b) un `SELECT … FOR UPDATE`
 *    sobre la fila del job al guardar el runtime state, y (c) una fase de
 *    merge de trackers por segmento — el dedup global ya fusiona tracks entre
 *    segmentos, así que el merge es el mismo código de dedup.
 *  - Los frames (data URLs) NO se persisten: solo metadata (media_frames) y
 *    el mejor frame/crop por track dentro del runtime state.
 */

export type FrameMetaRow = {
  timestampSeconds: number;
  analyzed: boolean;
  sceneId: number | null;
  /** Por qué se conservó o descartó — ver `FrameSamplingReason`. */
  reason: string;
};

export interface AnalysisJobStore {
  readonly kind: "memory" | "postgres";
  createJob(job: AnalysisJobRecord, state: JobRuntimeState): Promise<void>;
  getJob(id: string): Promise<AnalysisJobRecord | null>;
  /** Reemplazo completo del registro (status/checkpoint/counters/timings). */
  updateJob(job: AnalysisJobRecord): Promise<void>;
  getRuntimeState(id: string): Promise<JobRuntimeState | null>;
  saveRuntimeState(id: string, state: JobRuntimeState): Promise<void>;
  /** Metadata de frames recibidos (índice contentId+timestamp en Postgres). */
  recordFrames(id: string, rows: FrameMetaRow[]): Promise<void>;
  saveProducts(id: string, products: UniqueProductRecord[]): Promise<void>;
  getProducts(id: string): Promise<UniqueProductRecord[]>;
  /**
   * Actualiza SOLO el progreso en vivo de un producto ya persistido (fila
   * creada por `saveProducts` antes de arrancar el matching). No toca el resto
   * de columnas: evita el race de dos productos escribiéndose a la vez.
   */
  updateProductProgress(
    jobId: string,
    productId: string,
    progress: MatchProgressState
  ): Promise<void>;
  findReusableJob(
    fileHash: string,
    catalogVersion: string,
    analysisVersion: string
  ): Promise<AnalysisJobRecord | null>;
  /** Job más reciente para este hash, sea cual sea su estado o versión. */
  findLatestJobByHash(fileHash: string): Promise<AnalysisJobRecord | null>;
  listJobs(limit?: number): Promise<AnalysisJobRecord[]>;
}

type MemoryJobEntry = {
  job: AnalysisJobRecord;
  state: JobRuntimeState;
  frames: FrameMetaRow[];
  products: UniqueProductRecord[];
};

/** Implementación en memoria: siempre disponible (demo sin DATABASE_URL). */
export class InMemoryAnalysisJobStore implements AnalysisJobStore {
  readonly kind = "memory" as const;
  private readonly jobs = new Map<string, MemoryJobEntry>();

  private entry(id: string): MemoryJobEntry | null {
    return this.jobs.get(id) ?? null;
  }

  async createJob(job: AnalysisJobRecord, state: JobRuntimeState): Promise<void> {
    // Clonado profundo: el motor muta sus copias; el store guarda snapshots.
    this.jobs.set(job.id, {
      job: structuredClone(job),
      state: structuredClone(state),
      frames: [],
      products: [],
    });
  }

  async getJob(id: string): Promise<AnalysisJobRecord | null> {
    const e = this.entry(id);
    return e ? structuredClone(e.job) : null;
  }

  async updateJob(job: AnalysisJobRecord): Promise<void> {
    const e = this.entry(job.id);
    if (!e) throw new Error(`Job ${job.id} no existe.`);
    e.job = structuredClone(job);
  }

  async getRuntimeState(id: string): Promise<JobRuntimeState | null> {
    const e = this.entry(id);
    return e ? structuredClone(e.state) : null;
  }

  async saveRuntimeState(id: string, state: JobRuntimeState): Promise<void> {
    const e = this.entry(id);
    if (!e) throw new Error(`Job ${id} no existe.`);
    e.state = structuredClone(state);
  }

  async recordFrames(id: string, rows: FrameMetaRow[]): Promise<void> {
    const e = this.entry(id);
    if (!e) throw new Error(`Job ${id} no existe.`);
    e.frames.push(...rows);
  }

  async saveProducts(id: string, products: UniqueProductRecord[]): Promise<void> {
    const e = this.entry(id);
    if (!e) throw new Error(`Job ${id} no existe.`);
    e.products = structuredClone(products);
  }

  async getProducts(id: string): Promise<UniqueProductRecord[]> {
    const e = this.entry(id);
    return e ? structuredClone(e.products) : [];
  }

  async updateProductProgress(
    id: string,
    productId: string,
    progress: MatchProgressState
  ): Promise<void> {
    const e = this.entry(id);
    if (!e) return;
    const product = e.products.find((p) => p.productId === productId);
    if (product) product.matchProgress = progress;
  }

  async findReusableJob(
    fileHash: string,
    catalogVersion: string,
    analysisVersion: string
  ): Promise<AnalysisJobRecord | null> {
    const found = [...this.jobs.values()]
      .map((entry) => entry.job)
      .filter(
        (job) =>
          job.media.fileHash === fileHash &&
          job.media.catalogVersion === catalogVersion &&
          job.media.analysisVersion === analysisVersion &&
          job.status === "completed"
      )
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
    return found ? structuredClone(found) : null;
  }

  async findLatestJobByHash(fileHash: string): Promise<AnalysisJobRecord | null> {
    const found = [...this.jobs.values()]
      .map((entry) => entry.job)
      .filter((job) => job.media.fileHash === fileHash)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return found ? structuredClone(found) : null;
  }

  async listJobs(limit = 100): Promise<AnalysisJobRecord[]> {
    return [...this.jobs.values()]
      .map((entry) => entry.job)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }
}

// El store en memoria sobrevive a recargas en caliente de Next dev (mismo
// patrón que el pool de pg): sin esto, cada edición perdería los jobs.
const globalForStore = globalThis as unknown as {
  __pauseAnalysisJobStore?: AnalysisJobStore;
};

/**
 * Devuelve el store activo: Postgres si hay DATABASE_URL válida, memoria si
 * no. La elección se hace UNA vez por proceso (los jobs no deben saltar de
 * store a mitad de análisis).
 */
export function getAnalysisJobStore(): AnalysisJobStore {
  if (!globalForStore.__pauseAnalysisJobStore) {
    globalForStore.__pauseAnalysisJobStore = isDatabaseConfigured()
      ? new PostgresAnalysisJobStore()
      : new InMemoryAnalysisJobStore();
  }
  return globalForStore.__pauseAnalysisJobStore;
}
