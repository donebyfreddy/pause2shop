import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * Pool de Postgres compartido. La conexión se hace SIEMPRE desde el servidor
 * (route handlers con runtime = "nodejs"); las credenciales nunca llegan al
 * cliente. Si no hay DATABASE_URL, el catálogo cae a un repositorio en memoria
 * (ver lib/catalog) — mismo patrón "modo demo" que la visión sin OPENAI_API_KEY.
 */

/** ¿Hay una base de datos Postgres configurada? */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

// Reutilizamos el pool entre recargas en caliente de Next dev para no agotar
// las conexiones de Postgres.
const globalForPool = globalThis as unknown as { __pausePool?: Pool };

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está configurada.");
  }
  if (!globalForPool.__pausePool) {
    globalForPool.__pausePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === "false"
          ? false
          : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForPool.__pausePool;
}

/** Helper tipado para una query suelta. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}

/** Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT/ROLLBACK). */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
