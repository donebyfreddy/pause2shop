import { defineConfig, devices } from "@playwright/test";

const PORT = 3115;

/**
 * E2E del selector de idioma. Se apunta solo a `/` y `/studio` — no
 * requieren base de datos ni autenticación (a diferencia de `/admin`, que sí
 * las requiere vía `ADMIN_PASSWORD` y el store del catálogo).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // Fija el idioma de partida del navegador a español: sin esto, cada test
    // heredaría el idioma del sistema operativo vía Accept-Language/navigator.language
    // (por diseño: es justo lo que hace la detección inicial), haciendo los
    // asserts sobre "arranca en español" no deterministas entre máquinas.
    locale: "es-ES",
  },
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Viewport/UA de iPhone 13 pero motor Chromium: solo Chromium está
    // instalado en este entorno y el objetivo es probar el layout/interacción
    // móvil, no el motor WebKit en sí.
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
