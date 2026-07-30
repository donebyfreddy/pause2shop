import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  BrowserChallengeError,
  BrowserUnavailableError,
  PlaywrightService,
} from "../../lib/catalogIngestion/browser/playwrightService";
import { getScraperConfig } from "../../lib/catalogIngestion/config/scraper";

/**
 * Tests del servicio de navegador.
 *
 * No se lanza Chromium: eso lo cubre el smoke test contra tiendas reales. Aquí
 * se verifica la POLÍTICA, que es la parte que no debe cambiar por descuido:
 * que se puede desactivar, que se rinde ante un challenge en vez de insistir, y
 * que la configuración se lee del entorno.
 */

beforeEach(() => {
  delete process.env.SCRAPER_BROWSER_WS_ENDPOINT;
  delete process.env.SCRAPER_CHROMIUM_PATH;
  process.env.SCRAPER_PLAYWRIGHT_ENABLED = "true";
});

test("Desactivado por configuración: no intenta lanzar navegador", async () => {
  process.env.SCRAPER_PLAYWRIGHT_ENABLED = "false";
  const service = new PlaywrightService();
  assert.equal(service.isEnabled(), false);
  assert.equal(await service.unavailableReason(), "SCRAPER_PLAYWRIGHT_ENABLED=false");
  await assert.rejects(
    () => service.render("https://example.com"),
    (err: Error) => err instanceof BrowserUnavailableError && /ENABLED=false/.test(err.message)
  );
});

test("Cerrado: rechaza nuevas peticiones en vez de colgarse", async () => {
  const service = new PlaywrightService();
  await service.close();
  await assert.rejects(
    () => service.render("https://example.com"),
    (err: Error) => err instanceof BrowserUnavailableError && /cerrado/.test(err.message)
  );
});

test("close() es idempotente", async () => {
  const service = new PlaywrightService();
  await assert.doesNotReject(async () => {
    await service.close();
    await service.close();
  });
});

test("El error de challenge dice el motivo y deja claro que no se elude", () => {
  const err = new BrowserChallengeError("https://tienda.com/p/1", "Cloudflare challenge", 403);
  assert.match(err.message, /Cloudflare challenge/);
  assert.match(err.message, /no se intenta eludir/);
  assert.equal(err.httpStatus, 403);
  assert.equal(err.name, "BrowserChallengeError");
});

test("El snapshot reporta estado real, sin inventar disponibilidad", () => {
  const service = new PlaywrightService();
  const snapshot = service.snapshot();
  assert.equal(snapshot.connected, false, "no hay navegador hasta que se lanza");
  assert.equal(snapshot.openPages, 0);
  assert.equal(snapshot.contexts, 0);
  assert.deepEqual(snapshot.circuits, []);
});

test("Un dominio sin fallos no tiene el circuito abierto", () => {
  const service = new PlaywrightService();
  assert.equal(service.isCircuitOpen("https://tienda.com/p/1"), false);
  // Una URL inválida no debe lanzar al consultar el circuito.
  assert.equal(service.isCircuitOpen("no-es-una-url"), false);
});

test("Un endpoint remoto configurado se refleja en la configuración", () => {
  process.env.SCRAPER_BROWSER_WS_ENDPOINT = "wss://navegador.example.com?token=secreto";
  const config = getScraperConfig();
  assert.equal(config.browserWsEndpoint, "wss://navegador.example.com?token=secreto");
});

/* --------------------------- Configuración ----------------------------- */

test("La configuración del scraper se lee del entorno con topes sensatos", () => {
  process.env.SCRAPER_MAX_CONCURRENCY = "999";
  process.env.SCRAPER_REQUEST_DELAY_MS = "-50";
  process.env.SCRAPER_AI_MAX_HTML_CHARS = "10";
  process.env.SCRAPER_BATCH_SIZE = "7";
  const config = getScraperConfig();
  assert.equal(config.maxConcurrency, 16, "acotado: no se abren 999 páginas");
  assert.equal(config.requestDelayMs, 0, "un retardo negativo no tiene sentido");
  assert.equal(config.aiMaxHtmlChars, 2000, "hay un mínimo útil de HTML");
  assert.equal(config.batchSize, 7);

  delete process.env.SCRAPER_MAX_CONCURRENCY;
  delete process.env.SCRAPER_REQUEST_DELAY_MS;
  delete process.env.SCRAPER_AI_MAX_HTML_CHARS;
  delete process.env.SCRAPER_BATCH_SIZE;
  const defaults = getScraperConfig();
  assert.equal(defaults.maxConcurrency, 2, "por defecto, conservador");
  assert.equal(defaults.requestDelayMs, 1200);
  assert.equal(defaults.batchSize, 10);
});

test("Los interruptores aceptan las formas habituales de booleano", () => {
  for (const value of ["true", "1", "yes", "on", "TRUE"]) {
    process.env.SCRAPER_HEADLESS = value;
    assert.equal(getScraperConfig().headless, true, `"${value}" debe ser true`);
  }
  for (const value of ["false", "0", "no", "off"]) {
    process.env.SCRAPER_HEADLESS = value;
    assert.equal(getScraperConfig().headless, false, `"${value}" debe ser false`);
  }
  delete process.env.SCRAPER_HEADLESS;
  assert.equal(getScraperConfig().headless, true, "por defecto sin ventana");
});
