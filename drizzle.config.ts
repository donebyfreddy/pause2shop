import { defineConfig } from "drizzle-kit";

/**
 * Configuración de drizzle-kit — SOLO PARA INTROSPECCIÓN Y DIFF.
 *
 * `drizzle-kit generate` / `push` NO se usan en este proyecto y no hay script
 * de npm que los invoque, a propósito. El DDL vive en los .sql a mano de
 * db/migrations/ (ver scripts/migrate.ts) porque lleva cosas que un diff de
 * Drizzle no reproduce: triggers (set_updated_at), índices parciales y GIN, un
 * DO block que degrada pgvector a jsonb si la extensión no está, y backfills.
 * Un `push` las borraría en silencio.
 *
 * Lo que sí es útil:
 *   npx drizzle-kit check  → ¿el esquema tipado cuadra con la base real?
 *   npx drizzle-kit pull   → reintrospecciona si alguien tocó la base a mano.
 *
 * Regla: la migración .sql primero, el espejo en lib/db/schema.ts después.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    // Se lee del entorno y nunca se escribe aquí. drizzle-kit no carga
    // .env.local por su cuenta: usa `npx dotenv -e .env.local -- drizzle-kit …`
    // o exporta la variable antes de invocarlo.
    url: process.env.DATABASE_URL ?? "",
  },
  // Nuestro propio runner lleva el registro en `_catalog_migrations`; que
  // drizzle-kit no cree su tabla paralela y nos deje dos verdades.
  migrations: {
    table: "_catalog_migrations",
    schema: "public",
  },
  strict: true,
  verbose: true,
});
