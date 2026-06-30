/**
 * Aplicador de migraciones para cualquier Postgres / Supabase.
 *
 *   npm run db:migrate
 *
 * Lee DATABASE_URL (de .env.local / .env), aplica en orden los .sql de
 * supabase/migrations/ y registra los aplicados en _catalog_migrations.
 * Es idempotente: las migraciones ya aplicadas se omiten.
 *
 * Alternativa con Supabase CLI:  supabase db push
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

/** Carga sencilla de variables de entorno desde .env.local y .env. */
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

async function main(): Promise<void> {
  loadEnv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "\n✖ Falta DATABASE_URL. Configúrala en .env.local antes de migrar.\n" +
        "  (En Supabase: Project Settings → Database → Connection string)\n"
    );
    process.exit(1);
  }

  const ssl =
    process.env.DATABASE_SSL === "false"
      ? false
      : { rejectUnauthorized: false };

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

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

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
