import { arch, platform } from "node:os";
import type { Browser } from "playwright-core";

import type { BrowserHealth, BrowserProvider } from "./types";
import { probeLaunch } from "./types";

/**
 * Chromium empaquetado para serverless, vía `@sparticuz/chromium`.
 *
 * Por qué existe: en una función de Vercel `playwright-core` no tiene binario
 * que lanzar y descargar Chromium en caliente no es viable. Sparticuz publica
 * un build de Chromium comprimido, pensado para Lambda, que se descomprime en
 * `/tmp` la primera vez y se reutiliza en invocaciones posteriores de la misma
 * instancia (Fluid Compute reutiliza instancias, así que el arranque en frío se
 * paga pocas veces).
 *
 * Este provider SOLO tiene sentido en Linux x64. El binario está compilado para
 * Amazon Linux; en macOS o arm64 falla con un `spawn ... Exec format error` que
 * no explica nada, así que preferimos negarnos con un mensaje claro.
 *
 * Sobre `/tmp`: Sparticuz descomprime ahí (único directorio escribible). No lo
 * borramos entre invocaciones a propósito — es la caché que evita pagar la
 * descompresión cada vez. Sí limpiamos el perfil de usuario, que sí crece.
 */
export class VercelChromiumProvider implements BrowserProvider {
  readonly id = "vercel" as const;

  constructor(
    private readonly options: {
      timeoutMs: number;
      /**
       * URL de un pack de Chromium remoto (el modo de `@sparticuz/chromium-min`).
       * Si se define, Sparticuz descarga de ahí en vez de usar el binario
       * empaquetado: sirve para adelgazar la función.
       */
      packUrl?: string | null;
      /** Fuerza headless; en serverless no hay display, así que siempre true. */
      headless?: boolean;
    }
  ) {}

  private assertSupportedPlatform(): void {
    const os = platform();
    const cpu = arch();
    if (os !== "linux" || cpu !== "x64") {
      throw new Error(
        `el Chromium de @sparticuz/chromium es un binario de Linux x64 y aquí ` +
          `estamos en ${os}/${cpu}. Usa SCRAPER_BROWSER_PROVIDER=local en tu ` +
          "máquina, o =remote contra un navegador gestionado."
      );
    }
  }

  async launch(): Promise<Browser> {
    this.assertSupportedPlatform();

    const [{ chromium }, sparticuzModule] = await Promise.all([
      import("playwright-core"),
      import("@sparticuz/chromium"),
    ]);
    // El paquete es CJS con `default`: según el interop puede venir en `.default`.
    const sparticuz = sparticuzModule.default ?? sparticuzModule;

    // `executablePath(packUrl?)` descomprime en /tmp y devuelve la ruta. Con
    // packUrl, descarga primero. Es la llamada que puede tardar en frío.
    const executablePath = await sparticuz.executablePath(
      this.options.packUrl?.trim() || undefined
    );
    if (!executablePath) {
      throw new Error(
        "@sparticuz/chromium no devolvió executablePath. Si usas " +
          "@sparticuz/chromium-min, CHROMIUM_PACK_URL es obligatoria."
      );
    }

    // Los args de Sparticuz traen lo necesario para un entorno sin /dev/shm ni
    // sandbox. Añadimos solo lo nuestro y sin duplicar.
    const args = [...sparticuz.args];
    for (const extra of ["--disable-background-networking"]) {
      if (!args.includes(extra)) args.push(extra);
    }

    return chromium.launch({
      headless: this.options.headless ?? true,
      executablePath,
      args,
      timeout: this.options.timeoutMs,
    });
  }

  async healthCheck(): Promise<BrowserHealth> {
    // Antes de intentar lanzar, la comprobación de plataforma da un motivo
    // legible en vez de un error de spawn.
    try {
      this.assertSupportedPlatform();
    } catch (err) {
      return {
        ok: false,
        provider: this.id,
        browserVersion: null,
        target: this.options.packUrl?.trim() || "@sparticuz/chromium",
        reason: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      };
    }
    return probeLaunch(this, this.options.packUrl?.trim() || "@sparticuz/chromium");
  }
}
