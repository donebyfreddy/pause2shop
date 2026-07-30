/**
 * Verificación de la conexión a Neon.
 *
 *   npm run db:verify
 *
 * Contesta, en este orden, las cuatro preguntas que uno se hace cuando "la base
 * de datos no va":
 *   1. ¿Hay DATABASE_URL y tiene forma de connection string de Postgres?
 *   2. ¿Se puede abrir una conexión TLS y hacer una query?
 *   3. ¿Están aplicadas todas las migraciones de db/migrations?
 *   4. ¿Existen las tablas que el código espera, y está pgvector?
 *
 * Sale con código 1 si algo falla, para poder usarse como gate en CI.
 * No imprime NUNCA la connection string: solo host y base de datos.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

import { PROJECT_ROOT, describeDatabaseUrl, loadEnv } from "./loadEnv";

/** Tablas que el código da por existentes. Espejo de lib/db/schema.ts. */
const EXPECTED_TABLES = [
  "analysis_jobs",
  "analyzed_frames",
  "audit_logs",
  "catalog_ai_extractions",
  "catalog_ai_usage",
  "catalog_job_logs",
  "catalog_prices",
  "catalog_product_images",
  "catalog_product_variants",
  "catalog_products",
  "catalog_sources",
  "catalog_sync_errors",
  "catalog_sync_jobs",
  "detected_items",
  "external_search_results",
  "item_appearances",
  "item_feedback",
  "item_tracks",
  "media_contents",
  "media_frames",
  "media_scenes",
  "product_matches",
  "product_recommendations",
  "provider_usage",
  "video_sources",
  "visual_search_cache",
];

let failed = false;

function pass(label: string, detail = ""): void {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label: string, detail: string, hint?: string): void {
  failed = true;
  console.error(`  ✖ ${label} — ${detail}`);
  if (hint) console.error(`      → ${hint}`);
}

function warn(label: string, detail: string): void {
  console.warn(`  ! ${label} — ${detail}`);
}

async function main(): Promise<void> {
  loadEnv();
  console.log("\nVerificación de la conexión a la base de datos\n");

  // 1 — configuración -------------------------------------------------------
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    fail(
      "DATABASE_URL",
      "no está configurada",
      "Añádela a .env.local (Neon → Connect → connection string del -pooler)."
    );
    process.exit(1);
  }
  if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
    fail(
      "DATABASE_URL",
      "no es una cadena postgres:// ni postgresql://",
      "Debe ser una connection string de Postgres, no un endpoint HTTP."
    );
    process.exit(1);
  }
  pass("DATABASE_URL", describeDatabaseUrl(connectionString));

  const host = new URL(connectionString).hostname;
  if (host.endsWith(".neon.tech") && !host.includes("-pooler.")) {
    warn(
      "Endpoint",
      "es la conexión directa de Neon, no el pooler. En serverless cada " +
        "invocación abre su propia conexión y se agota el límite: usa el host -pooler."
    );
  }

  const ssl =
    process.env.DATABASE_SSL === "false"
      ? false
      : /[?&]sslmode=/i.test(connectionString) || { rejectUnauthorized: true };
  if (ssl === false) {
    warn("TLS", "desactivado por DATABASE_SSL=false (solo para Postgres local)");
  }

  // 2 — conectividad --------------------------------------------------------
  const client = new Client({ connectionString, ssl, connectionTimeoutMillis: 10_000 });
  const startedAt = process.hrtime.bigint();
  try {
    await client.connect();
  } catch (err) {
    fail(
      "Conexión",
      err instanceof Error ? err.message : String(err),
      "Comprueba que la contraseña es la vigente y que el proyecto de Neon existe."
    );
    process.exit(1);
  }
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  try {
    const info = await client.query<{
      db: string;
      usr: string;
      version: string;
    }>("select current_database() as db, current_user as usr, version() as version");
    const { db, usr, version } = info.rows[0];
    pass(
      "Conexión",
      `${Math.round(elapsedMs)} ms · ${version.split(" ").slice(0, 2).join(" ")} · db="${db}" · user="${usr}"`
    );

    // 3 — migraciones aplicadas --------------------------------------------
    const onDisk = readdirSync(join(PROJECT_ROOT, "db", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b, "en"));

    const hasLedger = await client.query<{ exists: boolean }>(
      "select to_regclass('_catalog_migrations') is not null as exists"
    );
    if (!hasLedger.rows[0].exists) {
      fail(
        "Migraciones",
        "la tabla _catalog_migrations no existe: no se ha migrado nunca",
        "Ejecuta: npm run db:migrate"
      );
    } else {
      const applied = new Set(
        (
          await client.query<{ name: string }>(
            "select name from _catalog_migrations"
          )
        ).rows.map((r) => r.name)
      );
      const pending = onDisk.filter((f) => !applied.has(f));
      if (pending.length > 0) {
        fail(
          "Migraciones",
          `${pending.length} pendiente(s): ${pending.join(", ")}`,
          "Ejecuta: npm run db:migrate"
        );
      } else {
        pass("Migraciones", `${onDisk.length}/${onDisk.length} aplicadas`);
      }
    }

    // 4 — tablas y extensiones ---------------------------------------------
    const present = new Set(
      (
        await client.query<{ table_name: string }>(
          "select table_name from information_schema.tables where table_schema = 'public'"
        )
      ).rows.map((r) => r.table_name)
    );
    const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
    if (missing.length > 0) {
      fail(
        "Tablas",
        `faltan ${missing.length}: ${missing.join(", ")}`,
        "Ejecuta: npm run db:migrate"
      );
    } else {
      pass("Tablas", `las ${EXPECTED_TABLES.length} esperadas existen`);
    }

    const vector = await client.query<{ installed: boolean }>(
      "select exists (select 1 from pg_extension where extname = 'vector') as installed"
    );
    if (vector.rows[0].installed) {
      pass("pgvector", "instalada: búsqueda vectorial con índice disponible");
    } else {
      warn(
        "pgvector",
        "no instalada: los embeddings caen a jsonb (funciona, pero sin índice vectorial)"
      );
    }

    // Escritura real: un permiso de solo lectura pasaría todo lo anterior.
    try {
      await client.query("begin");
      await client.query(
        "insert into audit_logs (actor, action, detail) values ($1, $2, $3)",
        ["db:verify", "connection_check", JSON.stringify({ elapsedMs: Math.round(elapsedMs) })]
      );
      await client.query("rollback");
      pass("Escritura", "INSERT permitido (probado y revertido con ROLLBACK)");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      fail(
        "Escritura",
        err instanceof Error ? err.message : String(err),
        "El rol de la connection string no puede escribir."
      );
    }
  } finally {
    await client.end();
  }

  if (failed) {
    console.error("\n✖ La verificación ha encontrado problemas.\n");
    process.exit(1);
  }
  console.log("\n✓ Base de datos operativa.\n");
}

main().catch((err) => {
  console.error("\n✖ Error verificando la base de datos:\n", err);
  process.exit(1);
});
