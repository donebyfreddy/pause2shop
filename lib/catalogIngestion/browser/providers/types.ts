import type { Browser } from "playwright-core";

/**
 * De dónde sale el navegador.
 *
 * Existe porque "lanzar Chromium" significa tres cosas distintas según dónde
 * corra el proceso, y antes esa decisión estaba embebida en `PlaywrightService`
 * con un `if (browserWsEndpoint)` y un `launch()` a pelo. El `launch()` a pelo
 * funciona en un portátil (donde `npx playwright install` ha dejado binarios) y
 * NO funciona en una función de Vercel, donde `playwright-core` no trae ninguno.
 *
 * Separarlo permite además decir por qué NO se puede navegar, que es la mitad
 * del valor: un "no disponible" opaco en el admin no ayuda a nadie.
 */
export interface BrowserHealth {
  /** ¿Se puede lanzar un navegador ahora mismo? */
  ok: boolean;
  provider: BrowserProviderId;
  /** Versión del navegador si se pudo arrancar. */
  browserVersion: string | null;
  /** Ruta o endpoint que se usó, ya saneado de credenciales. */
  target: string | null;
  /** Motivo del fallo, en lenguaje humano y accionable. Null si `ok`. */
  reason: string | null;
  /** Cuánto costó comprobarlo (arranque en frío incluido). */
  durationMs: number;
}

export type BrowserProviderId = "local" | "vercel" | "remote";

export interface BrowserProvider {
  readonly id: BrowserProviderId;
  /**
   * Lanza (o conecta con) un navegador. Quien llama es responsable de
   * cerrarlo; `PlaywrightService` lo hace en su `close()`.
   */
  launch(): Promise<Browser>;
  /**
   * Comprueba que el provider puede dar un navegador. Arranca uno de verdad y
   * lo cierra: un health check que solo mira variables de entorno miente en
   * cuanto el binario no existe o no es ejecutable.
   */
  healthCheck(): Promise<BrowserHealth>;
}

/** Oculta tokens de una URL de CDP antes de logearla o devolverla al admin. */
export function sanitizeEndpoint(endpoint: string): string {
  return endpoint.replace(/((?:token|key|apiKey|api_key)=)[^&]+/gi, "$1***");
}

/**
 * Health check genérico: arranca, pregunta la versión y cierra SIEMPRE.
 * Compartido por los tres providers para que ninguno se olvide del `finally`.
 */
export async function probeLaunch(
  provider: BrowserProvider,
  target: string | null
): Promise<BrowserHealth> {
  const started = Date.now();
  let browser: Browser | null = null;
  try {
    browser = await provider.launch();
    return {
      ok: true,
      provider: provider.id,
      browserVersion: browser.version(),
      target,
      reason: null,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      provider: provider.id,
      browserVersion: null,
      target,
      reason: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  } finally {
    // Cerrar aquí y no en el llamante: un health check que se deja un Chromium
    // colgado agota la memoria de la función en tres invocaciones.
    if (browser) await browser.close().catch(() => undefined);
  }
}
