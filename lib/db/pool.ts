import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

/**
 * Pool de Postgres compartido (Supabase). La conexión se hace SIEMPRE desde el
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
          "dashboard de Supabase → Connect → Transaction pooler."
      );
    }
    return false;
  }
  return true;
}

function isSupabaseHost(hostname: string): boolean {
  return hostname.endsWith(".supabase.co") || hostname.endsWith(".pooler.supabase.com");
}

/**
 * Configuración TLS.
 *
 * El pooler de Supabase (Supavisor) sirve un certificado cuya cadena no
 * verifica contra el almacén de confianza del sistema (comprobado con
 * `psql sslmode=verify-full sslrootcert=system`, falla igual) — es una
 * limitación conocida del servicio, no un problema de esta app. Para esos
 * hosts la conexión sigue siendo TLS (el tráfico va cifrado), pero sin
 * verificar la cadena: `rejectUnauthorized: false`.
 *
 * Para cualquier otro Postgres (uno con certificado público verificable)
 * mantenemos verificación estricta: `rejectUnauthorized: false` a ciegas
 * tiraría por tierra la protección contra man-in-the-middle sobre una
 * conexión que lleva la contraseña de la base.
 *
 * Si la URL ya trae `sslmode` y el host no es de Supabase, dejamos que `pg`
 * lo interprete y no pasamos objeto `ssl` — pasar ambos hace que el objeto
 * gane silenciosamente sobre lo que dice la cadena, que es justo la clase de
 * sorpresa que no queremos aquí. `DATABASE_SSL=false` sigue siendo el escape
 * para un Postgres local sin TLS.
 */
function sslConfig(url: string): boolean | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL === "false") return false;
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    // URL inválida: se detecta y falla más abajo, no aquí.
  }
  if (isSupabaseHost(hostname)) return { rejectUnauthorized: false };
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
       * ocupando un slot del pool.
       *
       * El compute "nano" de Supabase (plan gratuito) también puede tener un
       * arranque en frío tras inactividad prolongada. 15 s da margen de sobra
       * sin acercarse a los 75 s del timeout TCP.
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
