/**
 * Cliente de base de datos (Neon Postgres) — punto de entrada único.
 *
 *   import { db, schema, isDatabaseConfigured } from "@/lib/db";
 *
 * SOLO SERVIDOR. La connection string se lee exclusivamente de
 * `process.env.DATABASE_URL` y nunca se serializa a la respuesta ni se
 * imprime: los helpers de diagnóstico devuelven host y base de datos, jamás
 * la URL completa (ver `describeConnection`).
 *
 * Drizzle se monta SOBRE el mismo `pg.Pool` que ya usa el código con SQL
 * crudo (lib/db/pool.ts). Un solo pool, un solo presupuesto de conexiones:
 * Neon las cobra por proyecto y el pooler tiene un techo, así que abrir un
 * segundo pool para el ORM sería pagar dos veces por lo mismo.
 *
 * Convivencia con SQL crudo: las queries existentes (lib/catalogIngestion,
 * lib/catalog) siguen funcionando sin cambios. Drizzle es la vía tipada para
 * lo nuevo, no un big-bang de reescritura.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { getPool, isDatabaseConfigured } from "./pool";
import * as schema from "./schema";

export { schema, isDatabaseConfigured };
export * from "./schema";
export { getPool, query, withTransaction } from "./pool";

// Reutilizamos la instancia entre recargas en caliente de Next dev, igual que
// el pool: cada `drizzle()` nuevo re-construye el mapa de tablas sin necesidad.
const globalForDb = globalThis as unknown as {
  __pauseDrizzle?: NodePgDatabase<typeof schema>;
};

/**
 * Cliente Drizzle tipado. Lanza si no hay `DATABASE_URL`: quien pueda
 * funcionar sin base de datos debe comprobar `isDatabaseConfigured()` antes
 * y caer al repositorio en memoria (mismo patrón "modo demo" que la visión
 * sin OPENAI_API_KEY).
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalForDb.__pauseDrizzle) {
    globalForDb.__pauseDrizzle = drizzle(getPool(), { schema });
  }
  return globalForDb.__pauseDrizzle;
}

/**
 * Azúcar para `getDb()`. Es un getter perezoso a propósito: si fuese una
 * constante evaluada al importar, cualquier módulo que toque `@/lib/db`
 * reventaría en build sin DATABASE_URL configurada.
 */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get: (_target, prop, receiver) =>
    Reflect.get(getDb() as object, prop, receiver),
});

/**
 * Descripción de la conexión SEGURA PARA LOGS Y RESPUESTAS: host, base de
 * datos y si parece Neon. Nunca usuario ni contraseña.
 */
export function describeConnection(): {
  host: string;
  database: string;
  isNeon: boolean;
  pooled: boolean;
} | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      database: url.pathname.replace(/^\//, "") || "(default)",
      isNeon: url.hostname.endsWith(".neon.tech"),
      // Neon expone dos endpoints por rama: el directo y el `-pooler`
      // (PgBouncer). En serverless queremos SIEMPRE el pooler.
      pooled: url.hostname.includes("-pooler."),
    };
  } catch {
    return null;
  }
}
