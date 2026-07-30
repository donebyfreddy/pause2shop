import { isDatabaseConfigured } from "@/lib/db/pool";
import { MemoryCatalogRepository } from "./memoryRepository";
import { PostgresCatalogRepository } from "./postgresRepository";
import {
  ResilientCatalogRepository,
  type PersistenceMode,
} from "./resilientRepository";
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

// Versión del CONTRATO del repositorio. Súbela al añadir métodos a
// CatalogRepository: invalida el singleton cacheado en globalThis para que un
// dev server con hot reload no siga usando una instancia de la clase antigua
// (síntoma: "repo.listTopRecommendations is not a function").
const REPO_CONTRACT_VERSION = 2;

/**
 * Devuelve el repositorio activo: Postgres (con fallback automático a memoria
 * si la DB falla — circuit breaker en ResilientCatalogRepository) si hay
 * DATABASE_URL válida; si no, memoria directamente. Mismo patrón "modo demo"
 * que la visión sin OPENAI_API_KEY.
 */
export function getCatalogRepository(): CatalogRepository {
  const kind = `${isDatabaseConfigured() ? "postgres" : "memory"}:v${REPO_CONTRACT_VERSION}`;
  if (!globalForRepo.__pauseRepo || globalForRepo.__pauseRepoKind !== kind) {
    globalForRepo.__pauseRepo =
      kind.startsWith("postgres")
        ? new ResilientCatalogRepository(
            new PostgresCatalogRepository(),
            new MemoryCatalogRepository()
          )
        : new MemoryCatalogRepository();
    globalForRepo.__pauseRepoKind = kind;
  }
  return globalForRepo.__pauseRepo;
}

export type { PersistenceMode };

/**
 * Estado actual de la persistencia: "postgres" (sano), "memory_fallback"
 * (DATABASE_URL configurada pero la DB está fallando; se usa memoria y se
 * reintenta solo) o "memory" (sin DATABASE_URL válida).
 */
export function getPersistenceMode(): PersistenceMode {
  const repo = getCatalogRepository();
  if (repo instanceof ResilientCatalogRepository) return repo.mode;
  return "memory";
}

/** Último error de la DB si la persistencia está degradada, o null. */
export function getPersistenceError(): string | null {
  const repo = getCatalogRepository();
  if (repo instanceof ResilientCatalogRepository) return repo.lastError;
  return null;
}

/** ¿El catálogo persiste en base de datos (true) o es en memoria (false)? */
export function isPersistentCatalog(): boolean {
  return getPersistenceMode() === "postgres";
}
