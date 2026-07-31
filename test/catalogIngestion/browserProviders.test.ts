import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RemoteBrowserProvider,
  VercelChromiumProvider,
  resolveProviderId,
  sanitizeEndpoint,
} from "../../lib/catalogIngestion/browser/providers";

/**
 * Estos tests NO arrancan navegadores: comprueban la lógica de SELECCIÓN y los
 * mensajes de error, que es donde estaba el fallo real de producción (elegir un
 * provider que no puede funcionar y no decir por qué).
 *
 * Arrancar Chromium de verdad es lo que hace `npm run scraper:smoke`, y el
 * provider `vercel` solo se puede probar desplegado: su binario es Linux x64.
 */

/** Entorno base sin ninguna pista, para no heredar el de la máquina. */
function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

test("resolveProviderId: la variable explícita manda sobre la autodetección", () => {
  assert.equal(resolveProviderId(env({ SCRAPER_BROWSER_PROVIDER: "local", VERCEL: "1" })), "local");
  assert.equal(resolveProviderId(env({ SCRAPER_BROWSER_PROVIDER: "vercel" })), "vercel");
  assert.equal(resolveProviderId(env({ SCRAPER_BROWSER_PROVIDER: "remote" })), "remote");
});

test("resolveProviderId: dentro de Vercel se autodetecta `vercel`", () => {
  assert.equal(resolveProviderId(env({ VERCEL: "1" })), "vercel");
  assert.equal(resolveProviderId(env({ AWS_LAMBDA_FUNCTION_NAME: "fn" })), "vercel");
});

test("resolveProviderId: fuera de serverless y sin pistas, `local`", () => {
  assert.equal(resolveProviderId(env()), "local");
});

test("resolveProviderId: un navegador remoto configurado gana a la autodetección", () => {
  // Si alguien ha pagado un navegador gestionado, es porque quiere usarlo,
  // incluso estando dentro de Vercel.
  assert.equal(
    resolveProviderId(env({ VERCEL: "1", SCRAPER_REMOTE_BROWSER_URL: "wss://x/y" })),
    "remote"
  );
  // Alias histórico.
  assert.equal(
    resolveProviderId(env({ VERCEL: "1", SCRAPER_BROWSER_WS_ENDPOINT: "wss://x/y" })),
    "remote"
  );
});

test("resolveProviderId: un valor no reconocido cae a la autodetección, no revienta", () => {
  assert.equal(resolveProviderId(env({ SCRAPER_BROWSER_PROVIDER: "cabbage" })), "local");
  assert.equal(resolveProviderId(env({ SCRAPER_BROWSER_PROVIDER: "cabbage", VERCEL: "1" })), "vercel");
});

test("sanitizeEndpoint oculta tokens y claves", () => {
  assert.equal(
    sanitizeEndpoint("wss://chrome.example.com?token=SECRETO&launch=1"),
    "wss://chrome.example.com?token=***&launch=1"
  );
  assert.equal(sanitizeEndpoint("wss://x?apiKey=abc123"), "wss://x?apiKey=***");
  // Sin credenciales no toca nada.
  assert.equal(sanitizeEndpoint("wss://x/y"), "wss://x/y");
});

test("RemoteBrowserProvider exige un endpoint y explica cuál", async () => {
  const provider = new RemoteBrowserProvider({ endpoint: "", timeoutMs: 1000 });
  await assert.rejects(() => provider.launch(), /SCRAPER_REMOTE_BROWSER_URL/);
});

test("RemoteBrowserProvider rechaza un esquema que no sea ws:// y NO filtra el token", async () => {
  const provider = new RemoteBrowserProvider({
    endpoint: "https://chrome.example.com?token=SECRETO",
    timeoutMs: 1000,
  });
  await assert.rejects(
    () => provider.launch(),
    (err: Error) => {
      assert.match(err.message, /debe empezar por ws:\/\/ o wss:\/\//);
      assert.ok(!err.message.includes("SECRETO"), "el token no puede aparecer en el error");
      return true;
    }
  );
});

test("RemoteBrowserProvider: healthCheck sin endpoint devuelve ok=false con motivo", async () => {
  const provider = new RemoteBrowserProvider({ endpoint: "", timeoutMs: 1000 });
  const health = await provider.healthCheck();
  assert.equal(health.ok, false);
  assert.equal(health.provider, "remote");
  assert.match(health.reason ?? "", /SCRAPER_REMOTE_BROWSER_URL/);
});

test("VercelChromiumProvider se niega fuera de Linux x64 con un motivo legible", async () => {
  const provider = new VercelChromiumProvider({ timeoutMs: 1000 });
  const health = await provider.healthCheck();
  const isLinuxX64 = process.platform === "linux" && process.arch === "x64";

  if (isLinuxX64) {
    // En CI Linux sí puede intentar arrancar; no afirmamos que lo consiga
    // (depende del binario), solo que reporta el provider correcto.
    assert.equal(health.provider, "vercel");
    return;
  }

  // Este es el caso de esta máquina (macOS) y el que importa: el binario de
  // Sparticuz es de Linux, así que hay que decirlo en vez de dejar un
  // "Exec format error" del spawn.
  assert.equal(health.ok, false);
  assert.equal(health.provider, "vercel");
  assert.match(health.reason ?? "", /Linux x64/);
  assert.match(health.reason ?? "", /SCRAPER_BROWSER_PROVIDER=local/);
  assert.equal(health.durationMs, 0, "no debe intentar arrancar nada");
});

test("VercelChromiumProvider expone el pack remoto como target cuando se configura", async () => {
  const provider = new VercelChromiumProvider({
    timeoutMs: 1000,
    packUrl: "https://cdn.example.com/chromium.tar",
  });
  const health = await provider.healthCheck();
  assert.equal(health.target, "https://cdn.example.com/chromium.tar");
});
