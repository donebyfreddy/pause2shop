import pg from "pg";
import { loadEnv } from "../config/index";
import { logger } from "../observability/logger";

/**
 * Pool de Postgres compartido (Supabase), mismo patrón resiliente que
 * pause2shop/lib/db/pool.ts: si DATABASE_URL no es una cadena postgres:// NO
 * intentamos conectar — caemos al FileCatalogStore. Sin esta comprobación, cada
 * petición pagaría el connectionTimeout completo antes de fallar.
 */

let warnedInvalidUrl = false;

export function isDatabaseConfigured(): boolean {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    if (!warnedInvalidUrl) {
      warnedInvalidUrl = true;
      logger.warn(
        "DATABASE_URL no es una cadena postgres:// . Se usará el catálogo en " +
          "fichero (data/). Copia la connection string del Transaction pooler " +
          "desde el dashboard de Supabase → Connect."
      );
    }
    return false;
  }
  return true;
}

function isSupabaseHost(hostname: string): boolean {
  return hostname.endsWith(".supabase.co") || hostname.endsWith(".pooler.supabase.com");
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está configurada.");
  }
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    let hostname = "";
    try {
      hostname = new URL(connectionString).hostname;
    } catch {
      // URL inválida: fallará al conectar, no aquí.
    }
    let ssl: boolean | { rejectUnauthorized: boolean };
    if (process.env.DATABASE_SSL === "false") {
      ssl = false;
    } else if (isSupabaseHost(hostname)) {
      // El pooler de Supabase (Supavisor) sirve un certificado cuya cadena no
      // verifica contra el almacén de confianza del sistema — ver el
      // comentario extenso en lib/db/pool.ts (sslConfig).
      ssl = { rejectUnauthorized: false };
    } else {
      ssl = /[?&]sslmode=/i.test(connectionString) || { rejectUnauthorized: true };
    }
    pool = new pg.Pool({
      connectionString,
      ssl,
      max: 5,
      idleTimeoutMillis: 30_000,
      // El compute "nano" de Supabase (plan gratuito) puede tener un arranque
      // en frío tras inactividad prolongada. Ver el comentario extenso en
      // lib/db/pool.ts.
      connectionTimeoutMillis: 15_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
