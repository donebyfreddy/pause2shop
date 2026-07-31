import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Configuración de la app Next.
 *
 * `turbopack.root` es OBLIGATORIO aquí: el repo tiene package-lock.json en la
 * raíz (orquestación del monorepo) y otro en esta app. Con dos lockfiles,
 * Turbopack infiere la raíz del repo como workspace root, y al hacerlo resuelve
 * mal `@swc/helpers` y el manifest de React Server Components: la landing
 * devuelve 500 en dev. Fijando la raíz, la resolución vuelve a ser la de esta app.
 */
/** Rutas que pueden lanzar un navegador y por tanto necesitan sus recursos. */
const BROWSER_ROUTE_GLOBS = [
  "/api/catalog/**",
  "/api/cron/catalog-jobs",
];

/**
 * Ficheros que el file tracing NO puede descubrir solo.
 *
 * `playwright-core` lee su `browsers.json` en runtime con un require de ruta
 * CALCULADA (`require(path.join(packageRoot, "browsers.json"))`), y además el
 * fichero no está en el campo `exports` del paquete: no es alcanzable como
 * módulo, solo como fichero. El tracer analiza imports estáticos, así que no
 * ve esa lectura y no copia el fichero → en la función queda
 * `Cannot find module '/var/task/node_modules/playwright-core/browsers.json'`.
 *
 * @sparticuz/chromium está por lo mismo: su valor es el binario comprimido de
 * Chromium, que ningún análisis de imports va a encontrar.
 */
const BROWSER_TRACE_FILES = [
  "./node_modules/playwright-core/browsers.json",
  "./node_modules/playwright-core/**/*",
  "./node_modules/@sparticuz/chromium/**/*",
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },

  /**
   * Fuera del bundle: se resuelven desde node_modules en runtime. Empaquetarlos
   * rompe a los dos — Playwright pierde sus recursos no-JS y el binario de
   * Chromium no es empaquetable en absoluto.
   */
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],

  outputFileTracingIncludes: Object.fromEntries(
    BROWSER_ROUTE_GLOBS.map((route) => [route, BROWSER_TRACE_FILES])
  ),
};

export default withNextIntl(nextConfig);
