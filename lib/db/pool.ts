import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * Pool de Postgres compartido (Neon). La conexión se hace SIEMPRE desde el
 * servidor (route handlers con runtime = "nodejs"); las credenciales nunca
 * llegan al cliente. Si no hay DATABASE_URL, el catálogo cae a un repositorio
 * en memoria (ver lib/catalog) — mismo patrón "modo demo" que la visión sin
 * OPENAI_API_KEY.
 *
 * Este módulo es la ÚNICA lectura de DATABASE_URL para conectar. El cliente
 * tipado (Drizzle) se monta encima en lib/db/index.ts y comparte este pool.
 */

let warnedInvalidUrl = false;

/**
 * ¿Hay una base de datos Postgres configurada?
 *
 * Solo cuenta como configurada si la URL tiene esquema postgres:// — con una
 * URL de otra forma (p. ej. un endpoint REST https://) `pg` intentaría
 * conectar a un host/puerto sin sentido y cada petición pagaría el
 * connectionTimeout entero antes de fallar.
 */
export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    if (!warnedInvalidUrl) {
      warnedInvalidUrl = true;
      console.warn(
        "[db] DATABASE_URL no es una cadena postgres:// . Se usará el catálogo " +
          "en memoria. Copia la connection string del pooler desde el " +
          "dashboard de Neon → Connect."
      );
    }
    return false;
  }
  return true;
}

/**
 * Configuración TLS. Neon exige TLS y su certificado es válido y público, así
 * que verificamos la cadena en vez de desactivarla: `rejectUnauthorized: false`
 * aceptaría cualquier certificado y tiraría por tierra la protección contra
 * man-in-the-middle sobre una conexión que lleva la contraseña de la base.
 *
 * Si la URL ya trae `sslmode`, dejamos que `pg` lo interprete y no pasamos
 * objeto `ssl` — pasar ambos hace que el objeto gane silenciosamente sobre lo
 * que dice la cadena, que es justo la clase de sorpresa que no queremos aquí.
 * `DATABASE_SSL=false` sigue siendo el escape para un Postgres local sin TLS.
 */
function sslConfig(url: string): boolean | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL === "false") return false;
  if (/[?&]sslmode=/i.test(url)) return true;
  return { rejectUnauthorized: true };
}

// Reutilizamos el pool entre recargas en caliente de Next dev para no agotar
// las conexiones de Postgres.
const globalForPool = globalThis as unknown as { __pausePool?: Pool };

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está configurada.");
  }
  if (!globalForPool.__pausePool) {
    globalForPool.__pausePool = new Pool({
      connectionString,
      ssl: sslConfig(connectionString),
      max: 5,
      idleTimeoutMillis: 30_000,
      /**
       * Los límites siguen existiendo para que un host inalcanzable falle
       * rápido en vez de colgarse hasta el timeout TCP del SO (~75-85 s)
       * ocupando un slot del pool. Pero están calibrados para Neon, no para un
       * Postgres siempre caliente.
       *
       * Neon escala a cero: tras un rato sin tráfico el compute se suspende y
       * la PRIMERA conexión tiene que despertarlo. Medido en este proyecto,
       * ese arranque en frío tarda ~3 s (y puede ir a más si la región va
       * cargada), mientras que las queries en caliente van en 300-500 ms.
       *
       * Con los 3 s / 5 s de antes, la primera petición después de cada
       * periodo de inactividad caía justo en el límite y fallaba de forma
       * intermitente — el clásico "la primera vez nunca carga". 15 s da
       * margen al arranque en frío y sigue estando muy lejos de los 75 s.
       */
      connectionTimeoutMillis: 15_000,
      query_timeout: 15_000,
      statement_timeout: 15_000,
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
