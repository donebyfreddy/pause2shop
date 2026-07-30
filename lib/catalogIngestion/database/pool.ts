import pg from "pg";
import { loadEnv } from "../config/index";
import { logger } from "../observability/logger";

/**
 * Pool de Postgres compartido (Neon), mismo patrón resiliente que
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
          "fichero (data/). Copia la connection string del endpoint -pooler " +
          "desde el dashboard de Neon → Connect."
      );
    }
    return false;
  }
  return true;
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está configurada.");
  }
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    pool = new pg.Pool({
      connectionString,
      // Neon exige TLS y su certificado es válido: verificamos la cadena en vez
      // de aceptar cualquiera. Si la URL ya trae `sslmode`, dejamos que `pg` lo
      // interprete. Mismo criterio que lib/db/pool.ts (sslConfig).
      ssl:
        process.env.DATABASE_SSL === "false"
          ? false
          : /[?&]sslmode=/i.test(connectionString) || {
              rejectUnauthorized: true,
            },
      max: 5,
      idleTimeoutMillis: 30_000,
      // Neon escala a cero y la primera conexión tras la inactividad tiene que
      // despertar el compute (~3 s medidos). Con 3 s el arranque en frío fallaba
      // de forma intermitente. Ver el comentario extenso en lib/db/pool.ts.
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
