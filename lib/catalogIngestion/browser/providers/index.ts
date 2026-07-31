import { getScraperConfig } from "../../config/scraper";
import { LocalPlaywrightProvider } from "./local";
import { RemoteBrowserProvider } from "./remote";
import type { BrowserProvider, BrowserProviderId } from "./types";
import { VercelChromiumProvider } from "./vercel";

export type { BrowserHealth, BrowserProvider, BrowserProviderId } from "./types";
export { LocalPlaywrightProvider } from "./local";
export { RemoteBrowserProvider } from "./remote";
export { VercelChromiumProvider } from "./vercel";
export { sanitizeEndpoint } from "./types";

/**
 * Qué provider toca.
 *
 * `SCRAPER_BROWSER_PROVIDER` manda. Si no está definida se autodetecta, porque
 * el caso importante (estar dentro de una función de Vercel) es detectable y no
 * queremos que un despliegue falle solo por olvidar una variable.
 *
 * Un `SCRAPER_REMOTE_BROWSER_URL` definido gana sobre la autodetección: si
 * alguien se ha pagado un navegador gestionado, es porque quiere usarlo.
 */
export function resolveProviderId(
  env: NodeJS.ProcessEnv = process.env
): BrowserProviderId {
  const explicit = env.SCRAPER_BROWSER_PROVIDER?.trim().toLowerCase();
  if (explicit === "local" || explicit === "vercel" || explicit === "remote") {
    return explicit;
  }
  if (explicit) {
    console.warn(
      `[browser] SCRAPER_BROWSER_PROVIDER="${explicit}" no reconocido; se autodetecta.`
    );
  }
  // Compatibilidad con la variable histórica del servicio anterior.
  if (env.SCRAPER_REMOTE_BROWSER_URL?.trim() || env.SCRAPER_BROWSER_WS_ENDPOINT?.trim()) {
    return "remote";
  }
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME) return "vercel";
  return "local";
}

export function createBrowserProvider(
  env: NodeJS.ProcessEnv = process.env
): BrowserProvider {
  const config = getScraperConfig();
  const timeoutMs = config.navigationTimeoutMs;
  const id = resolveProviderId(env);

  switch (id) {
    case "remote":
      return new RemoteBrowserProvider({
        endpoint:
          env.SCRAPER_REMOTE_BROWSER_URL?.trim() ||
          env.SCRAPER_BROWSER_WS_ENDPOINT?.trim() ||
          "",
        timeoutMs,
      });
    case "vercel":
      return new VercelChromiumProvider({
        timeoutMs,
        packUrl: env.CHROMIUM_PACK_URL?.trim() || null,
        headless: true,
      });
    case "local":
      return new LocalPlaywrightProvider({
        headless: config.headless,
        timeoutMs,
        executablePath: config.chromiumPath ?? null,
      });
  }
}
