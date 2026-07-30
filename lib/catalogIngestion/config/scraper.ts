/**
 * Configuración del scraper modular (Playwright + IA como fallback).
 *
 * Se lee del entorno en CADA llamada, igual que `getConfig()`: así los tests
 * pueden ajustar una variable sin reimportar módulos, y un cambio en el admin
 * (que escribe en el entorno del proceso) surte efecto en el siguiente job.
 *
 * Las variables `SCRAPER_*` son deliberadamente conservadoras por defecto:
 * preferimos un scraper lento y educado a uno rápido que se haga bloquear.
 */

export type ScraperLogLevel = "debug" | "info" | "warn" | "error";

export interface ScraperConfig {
  /** ¿Se permite usar OpenAI como extractor de último recurso? */
  aiEnabled: boolean;
  /** Modelo de OpenAI para la extracción de campos. */
  aiModel: string;
  /** Máximo de caracteres de HTML condensado que se envían al modelo. */
  aiMaxHtmlChars: number;
  /** ¿Se permite renderizar con Playwright cuando el HTML plano no basta? */
  playwrightEnabled: boolean;
  headless: boolean;
  /** Páginas simultáneas como máximo (global, no por dominio). */
  maxConcurrency: number;
  /** Espera mínima entre peticiones al MISMO dominio. */
  requestDelayMs: number;
  navigationTimeoutMs: number;
  maxRetries: number;
  /** Productos por lote de job (un lote = una invocación serverless). */
  batchSize: number;
  /** Techo duro de productos que procesa un job completo. */
  maxProductsPerJob: number;
  logLevel: ScraperLogLevel;
  /**
   * Navegador remoto vía CDP. Es la vía de producción en serverless: en vez de
   * empaquetar Chromium en la función, se conecta a un navegador gestionado
   * (Browserless, Browserbase, un contenedor propio…).
   */
  browserWsEndpoint: string | null;
  /** Binario de Chromium concreto (si no, se usa el de playwright/el sistema). */
  chromiumPath: string | null;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function num(name: string, fallback: number, min?: number, max?: number): number {
  const raw = process.env[name];
  const n = raw == null || raw === "" ? NaN : Number(raw);
  let value = Number.isFinite(n) ? n : fallback;
  if (min != null) value = Math.max(value, min);
  if (max != null) value = Math.min(value, max);
  return value;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw == null || raw === "" ? fallback : raw;
}

function optional(name: string): string | null {
  const raw = process.env[name];
  return raw == null || raw.trim() === "" ? null : raw.trim();
}

export function getScraperConfig(): ScraperConfig {
  return {
    aiEnabled: bool("SCRAPER_AI_ENABLED", true) && Boolean(process.env.OPENAI_API_KEY),
    aiModel: str("OPENAI_MODEL", "gpt-4o-mini"),
    aiMaxHtmlChars: num("SCRAPER_AI_MAX_HTML_CHARS", 30000, 2000, 400000),
    playwrightEnabled: bool("SCRAPER_PLAYWRIGHT_ENABLED", true),
    headless: bool("SCRAPER_HEADLESS", true),
    maxConcurrency: num("SCRAPER_MAX_CONCURRENCY", 2, 1, 16),
    requestDelayMs: num("SCRAPER_REQUEST_DELAY_MS", 1200, 0),
    navigationTimeoutMs: num("SCRAPER_NAVIGATION_TIMEOUT_MS", 30000, 1000),
    maxRetries: num("SCRAPER_MAX_RETRIES", 2, 0, 10),
    batchSize: num("SCRAPER_BATCH_SIZE", 10, 1, 500),
    maxProductsPerJob: num("SCRAPER_MAX_PRODUCTS_PER_JOB", 100, 1, 10000),
    logLevel: (str("SCRAPER_LOG_LEVEL", "info") as ScraperLogLevel) || "info",
    browserWsEndpoint: optional("SCRAPER_BROWSER_WS_ENDPOINT"),
    chromiumPath: optional("SCRAPER_CHROMIUM_PATH"),
  };
}

/**
 * ¿Por qué NO está disponible la IA? Devuelve null si sí lo está. El admin
 * muestra este motivo literal en vez de un booleano opaco.
 */
export function aiUnavailableReason(): string | null {
  if (!process.env.OPENAI_API_KEY) return "falta OPENAI_API_KEY en el entorno del servidor";
  if (!bool("SCRAPER_AI_ENABLED", true)) return "SCRAPER_AI_ENABLED=false";
  return null;
}
