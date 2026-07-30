import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Motor de ingesta migrado de catalog-scraper (servicio independiente sin
    // este linter). Trabaja con JSON-LD/JSON embebido no tipado de sitios de
    // terceros y con proveedores de embeddings intercambiables: `any` ahí es
    // la abstracción correcta, no descuido. No relajamos esto para el resto
    // de la app.
    files: ["lib/catalogIngestion/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
