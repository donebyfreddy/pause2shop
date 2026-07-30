/**
 * Aplicador de migraciones para Neon (o cualquier Postgres).
 *
 *   npm run db:migrate
 *
 * Lee DATABASE_URL del entorno, aplica en orden los .sql de db/migrations/ y
 * registra los aplicados en _catalog_migrations. Es idempotente: las
 * migraciones ya aplicadas se omiten.
 *
 * El DDL vive en .sql a mano y NO en drizzle-kit generate a propósito: las
 * migraciones llevan triggers, índices parciales y GIN, backfills y un DO
 * block que degrada pgvector a jsonb si la extensión no está. Un `generate`
 * por diff no reproduce eso y borraría la mitad en el primer push. Drizzle es
 * la capa de consulta tipada (lib/db/schema.ts), no la autoridad del esquema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

import { PROJECT_ROOT, describeDatabaseUrl, loadEnv } from "./loadEnv";

const MIGRATIONS_DIR = join(PROJECT_ROOT, "db", "migrations");

async function main(): Promise<void> {
  loadEnv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "\n✖ Falta DATABASE_URL. Configúrala en .env.local antes de migrar.\n" +
        "  (En Neon: dashboard del proyecto → Connect → connection string\n" +
        "   del endpoint -pooler.)\n"
    );
    process.exit(1);
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    console.error(
      "\n✖ DATABASE_URL no es una URL válida. Debe comenzar por " +
        "postgres:// o postgresql://.\n"
    );
    process.exit(1);
  }

  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    console.error(
      `\n✖ DATABASE_URL usa ${databaseUrl.protocol}//, pero las migraciones ` +
        "requieren una cadena postgres:// o postgresql://.\n" +
        "  Cópiala del dashboard de Neon → Connect (endpoint -pooler).\n"
    );
    process.exit(1);
  }

  // Nunca la URL completa: lleva la contraseña y esto se ejecuta en CI.
  console.log(`\nBase de datos: ${describeDatabaseUrl(connectionString)}\n`);

  // Neon exige TLS con certificado válido; ver lib/db/pool.ts (sslConfig).
  const ssl =
    process.env.DATABASE_SSL === "false"
      ? false
      : /[?&]sslmode=/i.test(connectionString) || { rejectUnauthorized: true };

  const client = new Client({ connectionString, ssl });
  await client.connect();

  try {
    await client.query(`
      create table if not exists _catalog_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const applied = new Set<string>(
      (await client.query("select name from _catalog_migrations")).rows.map(
        (r: { name: string }) => r.name
      )
    );

    // El orden es el del prefijo de fecha del nombre, y tiene que ser estable
    // entre máquinas: `sort()` a secas depende del locale por defecto.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b, "en"));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`• ${file} (ya aplicada)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      console.log(`→ aplicando ${file} …`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into _catalog_migrations(name) values ($1)",
          [file]
        );
        await client.query("commit");
        count++;
        console.log(`✓ ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    console.log(
      count === 0
        ? "\n✓ Sin cambios: la base de datos ya está al día."
        : `\n✓ ${count} migración(es) aplicada(s).`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("\n✖ Error aplicando migraciones:\n", err);
  process.exit(1);
});
