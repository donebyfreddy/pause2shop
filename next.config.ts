import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const BROWSER_ROUTE_GLOBS = ["/api/catalog/**", "/api/cron/catalog-jobs"];

const BROWSER_TRACE_FILES = [
  "./node_modules/playwright-core/browsers.json",
  "./node_modules/playwright-core/**/*",
  "./node_modules/@sparticuz/chromium/**/*",
];

/**
 * CLIP (transformers.js + runtime ONNX) SOLO en el endpoint de matching visual.
 *
 * Los vectores del catálogo se calculan offline por CLI, pero el recorte que
 * manda el usuario hay que embeberlo en la petición. Sin CLIP aquí el proveedor
 * degrada a `hash` (64 dimensiones) y `matchProducts` descarta en silencio todo
 * el catálogo, que está a 512 — búsqueda visual que devuelve cero sin un solo
 * error en los logs.
 *
 * ALCANCE MÍNIMO A PROPÓSITO. En el plan Hobby hay un techo de 12 funciones, y
 * Vercel solo se mantiene por debajo fusionando rutas en lambdas hasta un tope
 * de tamaño. Cargar estos ~138 MB en muchas rutas impide la fusión y cada ruta
 * pasa a ser su propia función: probado con `/api/**` y con
 * vision+analysis+catalog, y el despliegue falla con
 * "No more than 12 Serverless Functions". Playwright + Chromium (79 MB en las
 * rutas de catálogo) ya se comen casi todo el margen.
 *
 * Consecuencia asumida: la búsqueda por imagen desde /admin
 * (`/api/catalog/search/image`) y el pipeline de vídeo (`/api/analysis/**`)
 * siguen en `hash`. Con plan Pro desaparece el techo y se puede extender.
 */
const EMBEDDING_TRACE_FILES = [
  "./node_modules/@huggingface/transformers/package.json",
  "./node_modules/@huggingface/transformers/src/**/*",
  "./node_modules/@huggingface/transformers/dist/**/*",
  "./node_modules/@huggingface/transformers/node_modules/**/*",
  "./node_modules/onnxruntime-node/package.json",
  "./node_modules/onnxruntime-node/dist/**/*",
  "./node_modules/onnxruntime-node/lib/**/*",
  "./node_modules/onnxruntime-node/bin/napi-v3/linux/**/*",
  "./node_modules/onnxruntime-common/**/*",
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  serverExternalPackages: [
    "playwright-core",
    "@sparticuz/chromium",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
  outputFileTracingIncludes: {
    ...Object.fromEntries(
      BROWSER_ROUTE_GLOBS.map((route) => [route, BROWSER_TRACE_FILES])
    ),
    "/api/vision/match-object": EMBEDDING_TRACE_FILES,
  },
};

export default withNextIntl(nextConfig);
