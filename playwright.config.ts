import { defineConfig, devices } from "@playwright/test";

const PORT = 3115;

/**
 * E2E de la landing pública y del selector de idioma. Se apunta a rutas
 * públicas (`/`, `/studio`, `/arquitectura`, `/legal/*`) — no requieren base de
 * datos ni autenticación, a diferencia de `/admin`, que sí las necesita vía
 * `ADMIN_PASSWORD` y el store del catálogo.
 *
 * `E2E_BASE_URL` permite apuntar a un servidor YA levantado (el `next dev` de
 * trabajo, o una URL de preview) en lugar de construir uno propio. Sirve para
 * dos cosas: iterar rápido sobre un test sin esperar un build de producción, y
 * poder validar la landing cuando otra rama del repo tiene el build en rojo por
 * un fichero que no es de esta parte del producto.
 */
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: EXTERNAL_BASE_URL ?? `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // Fija el idioma de partida del navegador a español: sin esto, cada test
    // heredaría el idioma del sistema operativo vía Accept-Language/navigator.language
    // (por diseño: es justo lo que hace la detección inicial), haciendo los
    // asserts sobre "arranca en español" no deterministas entre máquinas.
    locale: "es-ES",
  },
  // Con `E2E_BASE_URL` no se levanta nada: se prueba contra lo que ya hay.
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
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
