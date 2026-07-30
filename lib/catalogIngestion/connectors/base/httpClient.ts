import { getConfig } from "../../config/index";
import { logger } from "../../observability/logger";
import { countDomainRequest } from "../../observability/metrics";
import { parseRobots, isPathAllowed, type RobotsRules } from "./robots";

/**
 * Cliente HTTP "educado" compartido por todos los conectores:
 *
 * - robots.txt comprobado ANTES de cada fetch (caché por dominio, 1h)
 * - User-Agent identificable (catalog-scraper/1.0 + contacto)
 * - rate limit por dominio (default 1 req/s, respeta Crawl-delay si es mayor)
 * - concurrencia global limitada
 * - retries con backoff exponencial + jitter, solo para errores transitorios
 * - timeout por petición
 *
 * NUNCA se implementa evasión anti-bot: si un dominio devuelve 403/429
 * persistente, el circuit breaker del conector lo marca `unavailable`.
 */

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt no permite acceder a ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export interface FetchResult {
  status: number;
  body: string;
  contentType: string;
}

export type FetchFn = (url: string, accept?: string) => Promise<FetchResult>;

interface DomainState {
  robots: RobotsRules | null;
  robotsFetchedAt: number;
  nextAllowedAt: number;
  chain: Promise<void>;
}

const domains = new Map<string, DomainState>();
const ROBOTS_TTL_MS = 60 * 60 * 1000;

// Semáforo global de concurrencia — evita abrir N sockets a la vez aunque
// haya varios jobs en paralelo.
let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  const { maxConcurrency } = getConfig();
  if (inFlight < maxConcurrency) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function releaseSlot(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

function getDomainState(host: string): DomainState {
  let state = domains.get(host);
  if (!state) {
    state = { robots: null, robotsFetchedAt: 0, nextAllowedAt: 0, chain: Promise.resolve() };
    domains.set(host, state);
  }
  return state;
}

async function rawFetch(url: string, accept: string): Promise<FetchResult> {
  const config = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": config.userAgent,
        accept,
        "accept-language": "es-ES,es;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      status: res.status,
      body,
      contentType: res.headers.get("content-type") ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getRobots(origin: string, host: string): Promise<RobotsRules> {
  const state = getDomainState(host);
  const now = Date.now();
  if (state.robots && now - state.robotsFetchedAt < ROBOTS_TTL_MS) return state.robots;
  try {
    const res = await rawFetch(`${origin}/robots.txt`, "text/plain");
    if (res.status >= 200 && res.status < 300) {
      state.robots = parseRobots(res.body, getConfig().userAgent);
    } else {
      // 4xx = no hay robots → todo permitido. 5xx: permitimos también, pero
      // el rate limit conservador nos mantiene educados.
      state.robots = { allows: [], disallows: [], crawlDelaySeconds: null, sitemaps: [] };
    }
  } catch {
    state.robots = { allows: [], disallows: [], crawlDelaySeconds: null, sitemaps: [] };
  }
  state.robotsFetchedAt = now;
  return state.robots ?? { allows: [], disallows: [], crawlDelaySeconds: null, sitemaps: [] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Espera el turno del dominio (rate limit serializado por dominio). */
async function waitForDomainTurn(host: string, crawlDelaySeconds: number | null): Promise<void> {
  const config = getConfig();
  const state = getDomainState(host);
  const intervalMs = Math.max(config.rateLimitPerDomainMs, (crawlDelaySeconds ?? 0) * 1000);
  // Encadenamos las esperas para que dos fetch simultáneos al mismo dominio
  // no se cuelen: cada uno reserva su hueco en la cadena.
  const myTurn = state.chain.then(async () => {
    const wait = state.nextAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    state.nextAllowedAt = Date.now() + intervalMs;
  });
  state.chain = myTurn.catch(() => {});
  await myTurn;
}

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Fetch educado con robots + rate limit + retries. Lanza RobotsDisallowedError
 * si robots.txt prohíbe la ruta (no se reintenta: no es un fallo, es respeto).
 */
export async function politeFetch(url: string, accept = "text/html,application/xhtml+xml,application/json"): Promise<FetchResult> {
  const config = getConfig();
  const parsed = new URL(url);
  const robots = await getRobots(parsed.origin, parsed.host);
  if (!isPathAllowed(robots, parsed.pathname + parsed.search)) {
    throw new RobotsDisallowedError(url);
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (attempt > 0) {
      // Backoff exponencial con jitter: 1s, 2s, 4s… ±25%
      const base = 1000 * 2 ** (attempt - 1);
      await sleep(base + Math.random() * base * 0.5);
    }
    await waitForDomainTurn(parsed.host, robots.crawlDelaySeconds);
    await acquireSlot();
    try {
      countDomainRequest(parsed.host);
      const res = await rawFetch(url, accept);
      if (isTransient(res.status) && attempt < config.maxRetries) {
        lastError = new Error(`HTTP ${res.status} en ${url}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.debug("fetch fallido", { url, attempt, error: lastError.message });
    } finally {
      releaseSlot();
    }
  }
  throw lastError ?? new Error(`fetch agotó reintentos: ${url}`);
}

/** Descarga binaria educada (imágenes). Mismo pipeline de robots/rate limit. */
export async function politeFetchBinary(url: string): Promise<{ status: number; body: Buffer; contentType: string }> {
  const config = getConfig();
  const parsed = new URL(url);
  const robots = await getRobots(parsed.origin, parsed.host);
  if (!isPathAllowed(robots, parsed.pathname + parsed.search)) {
    throw new RobotsDisallowedError(url);
  }
  await waitForDomainTurn(parsed.host, robots.crawlDelaySeconds);
  await acquireSlot();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    countDomainRequest(parsed.host);
    const res = await fetch(url, {
      headers: { "user-agent": config.userAgent, accept: "image/*" },
      redirect: "follow",
      signal: controller.signal,
    });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body, contentType: res.headers.get("content-type") ?? "" };
  } finally {
    clearTimeout(timer);
    releaseSlot();
  }
}

/**
 * Sitemaps declarados en el robots.txt del dominio. Es la vía estándar (y
 * educada) de descubrir catálogo sin adivinar rutas: si la tienda publica sus
 * sitemaps, nos dice ella misma dónde están. Devuelve [] si no hay o falla.
 */
export async function discoverSitemapsFromRobots(url: string): Promise<string[]> {
  try {
    const parsed = new URL(url);
    const robots = await getRobots(parsed.origin, parsed.host);
    return robots.sitemaps.filter((s) => /^https?:\/\//i.test(s));
  } catch {
    return [];
  }
}

/** Crawl-delay declarado por el dominio (null si no declara ninguno). */
export async function domainCrawlDelay(url: string): Promise<number | null> {
  try {
    const parsed = new URL(url);
    const robots = await getRobots(parsed.origin, parsed.host);
    return robots.crawlDelaySeconds;
  } catch {
    return null;
  }
}

/**
 * Comprueba robots.txt para una URL y devuelve el crawl-delay declarado.
 * Lanza `RobotsDisallowedError` si la ruta está prohibida.
 *
 * Es la misma comprobación que hace `politeFetch`, expuesta aparte para que
 * el servicio de Playwright pueda respetarla ANTES de abrir una página: un
 * navegador que navega a una URL prohibida es igual de irrespetuoso que un
 * fetch, y la política es la misma para las dos vías.
 */
export async function ensureRobotsAllowed(url: string): Promise<{
  crawlDelaySeconds: number | null;
  robots: RobotsRules;
}> {
  const parsed = new URL(url);
  const robots = await getRobots(parsed.origin, parsed.host);
  if (!isPathAllowed(robots, parsed.pathname + parsed.search)) {
    throw new RobotsDisallowedError(url);
  }
  return { crawlDelaySeconds: robots.crawlDelaySeconds, robots };
}

/**
 * Espera el turno del dominio y reserva un slot de concurrencia global.
 * Devuelve la función de liberación — el llamante DEBE invocarla en `finally`.
 * Compartir estos semáforos con `politeFetch` es lo que evita que HTTP y
 * navegador se pisen y acaben haciendo el doble de peticiones al mismo host.
 */
export async function acquireDomainSlot(
  url: string,
  crawlDelaySeconds: number | null
): Promise<() => void> {
  const parsed = new URL(url);
  await waitForDomainTurn(parsed.host, crawlDelaySeconds);
  await acquireSlot();
  countDomainRequest(parsed.host);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseSlot();
  };
}

/** Solo para tests: limpia el estado por dominio. */
export function resetHttpClientState(): void {
  domains.clear();
}
