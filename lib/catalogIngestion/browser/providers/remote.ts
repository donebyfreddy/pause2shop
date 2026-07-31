import type { Browser } from "playwright-core";

import type { BrowserHealth, BrowserProvider } from "./types";
import { probeLaunch, sanitizeEndpoint } from "./types";

/**
 * Navegador gestionado por terceros (Browserless, Browserbase, o un contenedor
 * propio) al que nos conectamos por CDP.
 *
 * Es la opción más fiable en serverless: no hay binario que empaquetar ni
 * descompresión en frío que pagar, y el proveedor mantiene el navegador al día.
 * A cambio es un servicio externo con su coste y su latencia.
 *
 * El endpoint suele llevar el token en la query, así que NUNCA se logea ni se
 * devuelve tal cual: pasa por `sanitizeEndpoint`.
 */
export class RemoteBrowserProvider implements BrowserProvider {
  readonly id = "remote" as const;

  constructor(
    private readonly options: {
      endpoint: string;
      timeoutMs: number;
    }
  ) {}

  async launch(): Promise<Browser> {
    const endpoint = this.options.endpoint.trim();
    if (!endpoint) {
      throw new Error(
        "SCRAPER_BROWSER_PROVIDER=remote requiere SCRAPER_REMOTE_BROWSER_URL " +
          "(ws:// o wss:// del navegador por CDP)"
      );
    }
    if (!/^wss?:\/\//i.test(endpoint)) {
      throw new Error(
        `SCRAPER_REMOTE_BROWSER_URL debe empezar por ws:// o wss:// (recibido: ` +
          `${sanitizeEndpoint(endpoint).slice(0, 40)}…)`
      );
    }
    const { chromium } = await import("playwright-core");
    return chromium.connectOverCDP(endpoint, { timeout: this.options.timeoutMs });
  }

  healthCheck(): Promise<BrowserHealth> {
    return probeLaunch(this, sanitizeEndpoint(this.options.endpoint || "(sin definir)"));
  }
}
