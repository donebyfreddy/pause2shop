import type { Browser } from "playwright-core";

import type { BrowserHealth, BrowserProvider } from "./types";
import { probeLaunch } from "./types";

/**
 * Chromium instalado en la máquina. Es el provider de desarrollo.
 *
 * `playwright-core` NO trae binarios (eso es el paquete `playwright`), así que
 * aquí hace falta que alguien los haya puesto:
 *
 *   npx playwright install chromium
 *
 * o bien apuntar `PLAYWRIGHT_EXECUTABLE_PATH` (o el `SCRAPER_CHROMIUM_PATH`
 * histórico) a un Chrome/Chromium del sistema.
 *
 * Aquí NO se usa nunca el binario de Sparticuz: está compilado para Amazon
 * Linux x64 y en macOS falla con un error de formato que no explica nada.
 */
export class LocalPlaywrightProvider implements BrowserProvider {
  readonly id = "local" as const;

  constructor(
    private readonly options: {
      headless: boolean;
      timeoutMs: number;
      /** Ruta explícita al binario; si falta, Playwright usa su registry. */
      executablePath?: string | null;
      args?: string[];
    }
  ) {}

  private resolveExecutablePath(): string | null {
    return (
      this.options.executablePath?.trim() ||
      process.env.PLAYWRIGHT_EXECUTABLE_PATH?.trim() ||
      process.env.SCRAPER_CHROMIUM_PATH?.trim() ||
      null
    );
  }

  async launch(): Promise<Browser> {
    const { chromium } = await import("playwright-core");
    const executablePath = this.resolveExecutablePath();
    try {
      return await chromium.launch({
        headless: this.options.headless,
        executablePath: executablePath ?? undefined,
        args: this.options.args ?? [
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-background-networking",
        ],
        timeout: this.options.timeoutMs,
      });
    } catch (err) {
      const first = (err instanceof Error ? err.message : String(err)).split("\n")[0];
      throw new Error(
        `${first} — instala un Chromium con \`npx playwright install chromium\`, ` +
          "apunta PLAYWRIGHT_EXECUTABLE_PATH a un binario, o usa " +
          "SCRAPER_BROWSER_PROVIDER=remote con SCRAPER_REMOTE_BROWSER_URL"
      );
    }
  }

  healthCheck(): Promise<BrowserHealth> {
    return probeLaunch(this, this.resolveExecutablePath() ?? "playwright registry");
  }
}
