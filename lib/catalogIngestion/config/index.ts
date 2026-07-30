import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Configuración central. Cargamos .env manualmente (mismo patrón que
 * pause2shop/scripts/migrate.ts) para no depender de dotenv: menos
 * dependencias, comportamiento idéntico en CLI, tests y servidor.
 */

export const ROOT = tmpdir();

/** Carga .env.local y .env sin pisar variables ya presentes en el entorno. */
export function loadEnv(): void {
  // Next.js loads .env files before evaluating server modules. Keeping this
  // compatibility hook avoids filesystem tracing in the Vercel bundle.
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export interface Config {
  port: number;
  apiKey: string;
  dataDir: string;
  imagesDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  // Embeddings
  imageEmbeddingProvider: "local" | "hash";
  imageEmbeddingModel: string;
  textEmbeddingProvider: "local" | "hash";
  minImageScore: number;
  // Scraping ético: límites conservadores por defecto
  rateLimitPerDomainMs: number;
  maxConcurrency: number;
  requestTimeoutMs: number;
  maxRetries: number;
  circuitBreakerThreshold: number;
  userAgent: string;
  // Dedup
  perceptualHashMaxDistance: number;
  embeddingDedupThreshold: number;
  // Jobs
  jobWorkers: number;
}

/** Config viva: se lee del entorno en cada llamada para que los tests puedan
 * ajustar variables sin reimportar módulos. */
export function getConfig(): Config {
  loadEnv();
  const ephemeralRoot = join(tmpdir(), "pause2shop-catalog");
  return {
    port: num("PORT", 4100),
    apiKey: str("CATALOG_SERVICE_API_KEY", ""),
    dataDir: str("CATALOG_DATA_DIR", ephemeralRoot),
    imagesDir: str("CATALOG_IMAGES_DIR", join(ephemeralRoot, "images")),
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) || "info",
    // `CATALOG_EMBEDDING_PROVIDER`/`CATALOG_EMBEDDING_MODEL` son los nombres
    // unificados (fijan imagen y texto a la vez); `CATALOG_IMAGE_*`/
    // `CATALOG_TEXT_*` siguen funcionando para configurar cada uno por
    // separado y ganan si ambos están presentes.
    imageEmbeddingProvider:
      (process.env.CATALOG_IMAGE_EMBEDDING_PROVIDER ?? process.env.CATALOG_EMBEDDING_PROVIDER) === "local"
        ? "local"
        : "hash",
    imageEmbeddingModel: str(
      "CATALOG_IMAGE_EMBEDDING_MODEL",
      str("CATALOG_EMBEDDING_MODEL", "Xenova/clip-vit-base-patch32")
    ),
    textEmbeddingProvider:
      (process.env.CATALOG_TEXT_EMBEDDING_PROVIDER ?? process.env.CATALOG_EMBEDDING_PROVIDER) === "local"
        ? "local"
        : "hash",
    minImageScore: num("CATALOG_MIN_IMAGE_SCORE", 0.82),
    rateLimitPerDomainMs: num("CATALOG_RATE_LIMIT_MS", 1000),
    maxConcurrency: num("CATALOG_MAX_CONCURRENCY", 2),
    requestTimeoutMs: num("CATALOG_REQUEST_TIMEOUT_MS", 15000),
    maxRetries: num("CATALOG_MAX_RETRIES", 2),
    circuitBreakerThreshold: num("CATALOG_CIRCUIT_BREAKER_THRESHOLD", 5),
    userAgent: str(
      "CATALOG_USER_AGENT",
      "catalog-scraper/1.0 (+https://github.com/app-ai-finder; contact: federico.mencuccini@hirint.io)"
    ),
    perceptualHashMaxDistance: num("CATALOG_PHASH_MAX_DISTANCE", 6),
    embeddingDedupThreshold: num("CATALOG_EMBEDDING_DEDUP_THRESHOLD", 0.96),
    jobWorkers: num("CATALOG_JOB_WORKERS", 1),
  };
}
