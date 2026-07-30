/**
 * npm run env:check
 *
 * Valida las variables de entorno del servidor SIN imprimir ningún valor.
 * Salida por variable: configured | invalid_format | missing | placeholder | ok.
 * Nunca muestra el valor, solo su forma. Sale con código ≠0 si falta algo
 * imprescindible.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateServerEnv, type EnvStatus } from "../lib/env/validateServerEnv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

const ICON: Record<EnvStatus, string> = {
  ok: "✓",
  configured: "•",
  invalid_format: "✖",
  missing: "○",
  placeholder: "⚠",
};

function main(): void {
  loadEnv();
  const checks = validateServerEnv();

  console.log("\nComprobación de entorno (sin valores):\n");
  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const name = c.name.padEnd(width);
    const req = c.required ? " (requerida)" : "";
    const hint = c.hint ? ` — ${c.hint}` : "";
    console.log(`  ${ICON[c.status]} ${name}  ${c.status}${req}${hint}`);
  }

  const blocking = checks.filter(
    (c) =>
      c.required &&
      (c.status === "missing" ||
        c.status === "invalid_format" ||
        c.status === "placeholder"),
  );

  if (blocking.length) {
    console.log(
      `\n✖ ${blocking.length} variable(s) imprescindible(s) sin configurar correctamente: ${blocking
        .map((c) => c.name)
        .join(", ")}\n`,
    );
    process.exit(1);
  }
  console.log("\n✓ Variables imprescindibles OK.\n");
}

main();
