import type { Browser, BrowserContext, Page, Route } from "playwright-core";
import { getConfig } from "../config/index";
import { getScraperConfig } from "../config/scraper";
import { logger } from "../observability/logger";
import { countConnectorError } from "../observability/metrics";
import {
  acquireDomainSlot,
  ensureRobotsAllowed,
  RobotsDisallowedError,
} from "../connectors/base/httpClient";

/**
 * Servicio de navegador reutilizable sobre Playwright.
 *
 * Existe porque muchas tiendas sirven la ficha por JavaScript: el HTML plano
 * no trae ni precio ni galería. Renderizar es entonces la única forma de leer
 * datos PÚBLICOS que la tienda ya muestra a cualquier visitante.
 *
 * Lo que este servicio hace, y lo que NO hace:
 *
 *  ✔ Un solo navegador por proceso, con contextos aislados por dominio/job.
 *  ✔ User-Agent identificable, con contacto — nos presentamos.
 *  ✔ robots.txt comprobado ANTES de navegar, y crawl-delay respetado.
 *  ✔ Rate limit y concurrencia COMPARTIDOS con el cliente HTTP.
 *  ✔ Bloqueo de vídeo/fuentes/trackers: menos ancho de banda para la tienda.
 *  ✔ Detección de challenge/CAPTCHA para RENDIRSE y reportarlo.
 *  ✔ Circuit breaker por dominio y cierre seguro.
 *
 *  ✘ NO resuelve CAPTCHAs ni evade protecciones anti-bot.
 *  ✘ NO falsea el User-Agent para parecer un humano.
 *  ✘ NO toca contenido privado ni áreas autenticadas.
 *
 * Si una tienda nos presenta un challenge, la respuesta correcta es parar y
 * marcar la fuente como `blocked_or_challenged`.
 */

/** Recursos que nunca necesitamos para leer una ficha. */
const BLOCKED_RESOURCE_TYPES = new Set(["media", "font", "websocket", "eventsource", "manifest"]);

/** Dominios de analítica/publicidad: no aportan datos y ralentizan. */
const BLOCKED_HOST_PATTERN =
  /(google-analytics|googletagmanager|doubleclick|facebook\.net|connect\.facebook|hotjar|segment\.(io|com)|newrelic|nr-data|optimizely|criteo|taboola|outbrain|bing\.com\/bat|clarity\.ms|tiktok\.com\/i18n|snapchat|adobedtm|demdex|branch\.io|amplitude|mixpanel|intercom|zendesk|drift\.com|usercentrics|onetrust|cookiebot|trustarc)/i;

/** Señales de que la página es un muro anti-bot, no la ficha. */
const CHALLENGE_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /just a moment|checking your browser|cf[-_]?challenge|cf-browser-verification/i, label: "Cloudflare challenge" },
  { pattern: /captcha|recaptcha|hcaptcha|turnstile/i, label: "CAPTCHA" },
  { pattern: /access denied|acceso denegado|permission denied|forbidden/i, label: "acceso denegado" },
  { pattern: /are you a (human|robot)|verify you are human|pardon our interruption/i, label: "verificación humana" },
  { pattern: /incapsula|imperva|_incap_|distil|perimeterx|px-captcha|datadome/i, label: "WAF anti-bot" },
  { pattern: /request unsuccessful.*incident id/i, label: "bloqueo por WAF" },
];

export class BrowserChallengeError extends Error {
  constructor(
    readonly url: string,
    readonly signal: string,
    readonly httpStatus: number | null
  ) {
    super(
      `la página presenta un challenge/verificación (${signal}) en ${url}` +
        (httpStatus ? ` [HTTP ${httpStatus}]` : "") +
        "; no se intenta eludir"
    );
    this.name = "BrowserChallengeError";
  }
}

export class BrowserUnavailableError extends Error {
  constructor(reason: string) {
    super(`no hay navegador disponible: ${reason}`);
    this.name = "BrowserUnavailableError";
  }
}

export interface RenderOptions {
  /** Clave de aislamiento del contexto: normalmente el id del job o el dominio. */
  isolationKey?: string;
  /** Espera adicional a un selector concreto (ej. el precio) antes de leer. */
  waitForSelector?: string;
  /** `domcontentloaded` es lo bastante bueno y mucho más rápido que `load`. */
  waitUntil?: "domcontentloaded" | "load" | "networkidle" | "commit";
  /** Tiempo extra tras la carga para que hidrate el framework. */
  settleMs?: number;
  /** Bloquear también imágenes (útil cuando solo se quieren datos). */
  blockImages?: boolean;
  locale?: string;
}

export interface RenderResult {
  url: string;
  /** URL final tras redirecciones. */
  finalUrl: string;
  /** ¿Hubo redirección a otra ruta? */
  redirected: boolean;
  html: string;
  httpStatus: number | null;
  durationMs: number;
  /** Intentos consumidos (1 = fue a la primera). */
  attempts: number;
}

interface DomainCircuit {
  failures: number;
  open: boolean;
  openedAt: number;
  lastError: string;
}

/** Tiempo que un circuito permanece abierto antes de admitir una sonda. */
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;

export class PlaywrightService {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private contexts = new Map<string, BrowserContext>();
  private circuits = new Map<string, DomainCircuit>();
  /** Páginas abiertas ahora mismo — techo duro adicional al semáforo global. */
  private openPages = 0;
  private closed = false;

  /** ¿Está habilitado el renderizado por configuración? */
  isEnabled(): boolean {
    return getScraperConfig().playwrightEnabled;
  }

  /**
   * Motivo por el que NO se puede renderizar, o null si sí se puede. Se
   * muestra literal en el admin en vez de un "no disponible" opaco.
   */
  async unavailableReason(): Promise<string | null> {
    if (!this.isEnabled()) return "SCRAPER_PLAYWRIGHT_ENABLED=false";
    try {
      await this.ensureBrowser();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;

    const config = getScraperConfig();
    this.launching = (async () => {
      const { chromium } = await import("playwright-core");

      // Vía de producción en serverless: navegador remoto por CDP. Empaquetar
      // Chromium en la función es posible (límite de 5 GB) pero el arranque en
      // frío lo hace inviable para jobs cortos; un navegador gestionado sí.
      if (config.browserWsEndpoint) {
        logger.info("playwright: conectando a navegador remoto", {
          endpoint: config.browserWsEndpoint.replace(/(token|key)=[^&]+/gi, "$1=***"),
        });
        const browser = await chromium.connectOverCDP(config.browserWsEndpoint, {
          timeout: config.navigationTimeoutMs,
        });
        this.browser = browser;
        return browser;
      }

      const launchArgs = [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-background-networking",
      ];
      try {
        const browser = await chromium.launch({
          headless: config.headless,
          executablePath: config.chromiumPath ?? undefined,
          args: launchArgs,
          timeout: config.navigationTimeoutMs,
        });
        this.browser = browser;
        logger.info("playwright: navegador lanzado", { version: browser.version() });
        return browser;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // El fallo típico: playwright-core no trae binarios. Decimos exactamente
        // qué hacer en vez de dejar el stack de Playwright.
        throw new BrowserUnavailableError(
          `${message.split("\n")[0]} — instala un Chromium (\`npx playwright install chromium\`), ` +
            "apunta SCRAPER_CHROMIUM_PATH a un binario, o usa SCRAPER_BROWSER_WS_ENDPOINT con un navegador remoto"
        );
      }
    })().finally(() => {
      this.launching = null;
    });

    return this.launching;
  }

  /**
   * Contexto aislado por clave (job o dominio). Cada contexto tiene sus propias
   * cookies y almacenamiento: dos jobs no se contaminan entre sí.
   */
  private async contextFor(key: string, locale: string): Promise<BrowserContext> {
    const existing = this.contexts.get(key);
    if (existing) return existing;
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      // Nos identificamos: el UA lleva nuestro nombre y un contacto. No se
      // falsea para parecer un navegador humano.
      userAgent: getConfig().userAgent,
      locale,
      viewport: { width: 1366, height: 900 },
      // Sin permisos, sin geolocalización, sin service workers.
      serviceWorkers: "block",
      javaScriptEnabled: true,
      bypassCSP: false,
    });
    context.setDefaultNavigationTimeout(getScraperConfig().navigationTimeoutMs);
    context.setDefaultTimeout(getScraperConfig().navigationTimeoutMs);
    this.contexts.set(key, context);
    return context;
  }

  private circuitFor(host: string): DomainCircuit {
    let circuit = this.circuits.get(host);
    if (!circuit) {
      circuit = { failures: 0, open: false, openedAt: 0, lastError: "" };
      this.circuits.set(host, circuit);
    }
    // Pasado el enfriamiento dejamos pasar UNA sonda: un bloqueo temporal no
    // debe inhabilitar el dominio para siempre.
    if (circuit.open && Date.now() - circuit.openedAt > CIRCUIT_COOLDOWN_MS) {
      circuit.open = false;
      circuit.failures = 0;
    }
    return circuit;
  }

  isCircuitOpen(url: string): boolean {
    try {
      return this.circuitFor(new URL(url).host).open;
    } catch {
      return false;
    }
  }

  /** Instala el bloqueo de recursos innecesarios en una página. */
  private async installRouting(page: Page, blockImages: boolean): Promise<void> {
    await page.route("**/*", (route: Route) => {
      const request = route.request();
      const type = request.resourceType();
      if (BLOCKED_RESOURCE_TYPES.has(type)) return route.abort();
      if (blockImages && type === "image") return route.abort();
      let host = "";
      try {
        host = new URL(request.url()).host;
      } catch {
        /* URL rara (data:, blob:) — la dejamos pasar al handler normal */
      }
      if (host && BLOCKED_HOST_PATTERN.test(host)) return route.abort();
      return route.continue();
    });
  }

  /** ¿El HTML/título delatan un muro anti-bot? */
  private detectChallenge(html: string, title: string): string | null {
    const haystack = `${title}\n${html.slice(0, 6000)}`;
    for (const { pattern, label } of CHALLENGE_SIGNALS) {
      if (pattern.test(haystack)) return label;
    }
    return null;
  }

  /**
   * Renderiza una URL y devuelve su HTML. Respeta robots.txt, el crawl-delay y
   * la concurrencia global; se rinde ante un challenge.
   */
  async render(url: string, options: RenderOptions = {}): Promise<RenderResult> {
    if (this.closed) throw new BrowserUnavailableError("el servicio está cerrado");
    const config = getScraperConfig();
    if (!config.playwrightEnabled) {
      throw new BrowserUnavailableError("SCRAPER_PLAYWRIGHT_ENABLED=false");
    }

    const host = new URL(url).host;
    const circuit = this.circuitFor(host);
    if (circuit.open) {
      throw new BrowserUnavailableError(
        `circuit breaker abierto para ${host}: ${circuit.lastError}`
      );
    }

    // robots.txt ANTES de abrir nada. Un RobotsDisallowedError no es un fallo
    // del dominio: es respeto, así que no cuenta para el circuit breaker.
    const { crawlDelaySeconds } = await ensureRobotsAllowed(url);

    const started = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      if (attempt > 1) {
        const backoff = 1000 * 2 ** (attempt - 2);
        await new Promise((r) => setTimeout(r, backoff + Math.random() * backoff * 0.5));
      }

      const release = await acquireDomainSlot(url, crawlDelaySeconds);
      let page: Page | null = null;
      try {
        // Espera adicional configurable entre peticiones al mismo dominio:
        // `SCRAPER_REQUEST_DELAY_MS` es independiente del crawl-delay y suele
        // ser más generoso.
        if (config.requestDelayMs > 0) {
          await new Promise((r) => setTimeout(r, config.requestDelayMs));
        }

        const context = await this.contextFor(
          options.isolationKey ?? host,
          options.locale ?? "es-ES"
        );
        if (this.openPages >= config.maxConcurrency * 2) {
          throw new Error(
            `demasiadas páginas abiertas (${this.openPages}); baja SCRAPER_MAX_CONCURRENCY o espera`
          );
        }
        page = await context.newPage();
        this.openPages++;
        await this.installRouting(page, options.blockImages ?? true);

        const response = await page.goto(url, {
          waitUntil: options.waitUntil ?? "domcontentloaded",
          timeout: config.navigationTimeoutMs,
        });

        if (options.waitForSelector) {
          // Un selector ausente no es fatal: puede que la ficha no tenga ese
          // dato. Seguimos y que decida el pipeline de extracción.
          await page
            .waitForSelector(options.waitForSelector, { timeout: Math.min(8000, config.navigationTimeoutMs) })
            .catch(() => null);
        }
        if (options.settleMs) await page.waitForTimeout(options.settleMs);

        const httpStatus = response?.status() ?? null;
        const html = await page.content();
        const title = await page.title().catch(() => "");
        const finalUrl = page.url();

        const challenge = this.detectChallenge(html, title);
        if (challenge || httpStatus === 403 || httpStatus === 401 || httpStatus === 429) {
          const signal = challenge ?? `HTTP ${httpStatus}`;
          // Un challenge NO se reintenta: insistir es exactamente lo que no
          // debemos hacer. Abrimos el circuito y lo reportamos.
          circuit.failures = Number.POSITIVE_INFINITY;
          circuit.open = true;
          circuit.openedAt = Date.now();
          circuit.lastError = signal;
          throw new BrowserChallengeError(url, signal, httpStatus);
        }

        if (httpStatus != null && (httpStatus < 200 || httpStatus >= 400)) {
          throw new Error(`HTTP ${httpStatus} al renderizar ${url}`);
        }

        circuit.failures = 0;
        return {
          url,
          finalUrl,
          redirected: new URL(finalUrl).pathname !== new URL(url).pathname,
          html,
          httpStatus,
          durationMs: Date.now() - started,
          attempts: attempt,
        };
      } catch (err) {
        if (err instanceof BrowserChallengeError) throw err;
        if (err instanceof RobotsDisallowedError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        circuit.failures++;
        circuit.lastError = lastError.message;
        countConnectorError(host);
        if (circuit.failures >= getConfig().circuitBreakerThreshold) {
          circuit.open = true;
          circuit.openedAt = Date.now();
          logger.warn("playwright: circuit breaker abierto", {
            host,
            failures: circuit.failures,
            error: lastError.message,
          });
          break;
        }
      } finally {
        if (page) {
          this.openPages--;
          await page.close().catch(() => undefined);
        }
        release();
      }
    }

    throw lastError ?? new Error(`el renderizado de ${url} falló sin mensaje`);
  }

  /** Cierra el contexto de un job (libera memoria del navegador). */
  async closeContext(key: string): Promise<void> {
    const context = this.contexts.get(key);
    if (!context) return;
    this.contexts.delete(key);
    await context.close().catch(() => undefined);
  }

  /** Cierre seguro: contextos primero, navegador después. Idempotente. */
  async close(): Promise<void> {
    this.closed = true;
    for (const key of [...this.contexts.keys()]) await this.closeContext(key);
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => undefined);
  }

  /** Estado para el admin: qué dominios están en circuito abierto y por qué. */
  snapshot(): {
    enabled: boolean;
    connected: boolean;
    openPages: number;
    contexts: number;
    circuits: Array<{ host: string; open: boolean; failures: number; lastError: string }>;
  } {
    return {
      enabled: this.isEnabled(),
      connected: Boolean(this.browser?.isConnected()),
      openPages: this.openPages,
      contexts: this.contexts.size,
      circuits: [...this.circuits.entries()].map(([host, c]) => ({
        host,
        open: c.open,
        failures: Number.isFinite(c.failures) ? c.failures : -1,
        lastError: c.lastError,
      })),
    };
  }

  /** Solo para tests: reabre el servicio tras un close(). */
  reopenForTests(): void {
    this.closed = false;
    this.circuits.clear();
  }
}

/**
 * Instancia compartida por proceso. Reutilizar el navegador entre jobs es lo
 * que hace viable renderizar: lanzar Chromium cuesta ~1 s, navegar ~1 s.
 */
let shared: PlaywrightService | null = null;

export function getPlaywrightService(): PlaywrightService {
  if (!shared) shared = new PlaywrightService();
  return shared;
}

export async function closePlaywrightService(): Promise<void> {
  if (!shared) return;
  await shared.close();
  shared = null;
}
