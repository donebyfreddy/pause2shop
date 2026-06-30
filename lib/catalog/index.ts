import { isDatabaseConfigured } from "@/lib/db/pool";
import { MemoryCatalogRepository } from "./memoryRepository";
import { PostgresCatalogRepository } from "./postgresRepository";
import type { CatalogRepository } from "./repository";

export * from "./types";
export type { CatalogRepository } from "./repository";
export {
  generateItemFingerprint,
  normalizeDetectedItem,
  timestampBucket,
  inferItemType,
  normalizeText,
} from "./normalize";

// Singleton entre recargas en caliente para que el modo memoria conserve datos
// durante la vida del proceso.
const globalForRepo = globalThis as unknown as {
  __pauseRepo?: CatalogRepository;
  __pauseRepoKind?: string;
};

/**
 * Devuelve el repositorio activo: Postgres si hay DATABASE_URL, si no, memoria.
 * Mismo patrón "modo demo" que la visión sin OPENAI_API_KEY.
 */
export function getCatalogRepository(): CatalogRepository {
  const kind = isDatabaseConfigured() ? "postgres" : "memory";
  if (!globalForRepo.__pauseRepo || globalForRepo.__pauseRepoKind !== kind) {
    globalForRepo.__pauseRepo =
      kind === "postgres"
        ? new PostgresCatalogRepository()
        : new MemoryCatalogRepository();
    globalForRepo.__pauseRepoKind = kind;
  }
  return globalForRepo.__pauseRepo;
}

/** ¿El catálogo persiste en base de datos (true) o es en memoria (false)? */
export function isPersistentCatalog(): boolean {
  return isDatabaseConfigured();
}
