/**
 * Carga de variables de entorno para las tareas CLI (db:migrate, db:verify,
 * env:check…). Next hace esto solo en dev/build, pero un script suelto
 * ejecutado con tsx arranca con el entorno pelado.
 *
 * Precedencia, la misma que Next:
 *   entorno heredado (CI, `vercel env`)  >  .env.local  >  .env
 *
 * Sin esto, una DATABASE_URL puesta solo en `.env.local` — que es donde debe
 * estar, porque es el fichero que Git ignora — sería invisible para los
 * scripts, y acabaríamos duplicando el secreto en `.env` para que "funcione".
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parse(contents: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(trimmed.slice(0, eq).trim(), value);
  }
  return out;
}

export function loadEnv(): void {
  // El entorno heredado gana siempre: lo capturamos ANTES de tocar nada.
  const inherited = new Set(Object.keys(process.env));

  // Orden ascendente de prioridad: el último fichero pisa al anterior.
  for (const file of [".env", ".env.local"]) {
    const path = join(PROJECT_ROOT, file);
    if (!existsSync(path)) continue;
    for (const [key, value] of parse(readFileSync(path, "utf8"))) {
      if (inherited.has(key)) continue;
      process.env[key] = value;
    }
  }
}

/**
 * Descripción de una connection string SEGURA PARA IMPRIMIR: host, base de
 * datos y forma del endpoint. Nunca usuario, contraseña ni la URL entera —
 * estos scripts se ejecutan en CI, donde stdout acaba en un log que cualquiera
 * con acceso al build puede leer.
 */
export function describeDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const database = url.pathname.replace(/^\//, "") || "(default)";
    let flavour = "Postgres";
    if (url.hostname.endsWith(".pooler.supabase.com")) {
      flavour = "Supabase (pooler)";
    } else if (url.hostname.endsWith(".supabase.co")) {
      flavour = "Supabase (conexión directa)";
    }
    return `${flavour} · ${url.hostname} · db="${database}"`;
  } catch {
    return "(DATABASE_URL no es una URL válida)";
  }
}
