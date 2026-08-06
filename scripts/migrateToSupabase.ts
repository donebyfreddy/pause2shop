/**
 * Migración de DATOS desde un Postgres origen hacia el Supabase actual.
 *
 *   SOURCE_DATABASE_URL="postgres://…" npm run db:migrate:supabase
 *   …                                  npm run db:migrate:supabase -- --apply
 *
 * Sin `--apply` hace un SIMULACRO: se conecta a los dos lados, cuenta filas,
 * comprueba que el destino está vacío y dice exactamente qué haría. No escribe
 * nada. Con `--apply` ejecuta la copia de verdad.
 *
 * QUÉ CONSERVA. El volcado es `pg_dump --data-only`, así que los IDs (uuid y
 * bigserial), las claves ajenas y los timestamps viajan tal cual: NO se
 * regeneran. Las secuencias se reajustan al final con `setval` para que el
 * siguiente insert no choque con un id ya usado.
 *
 * POR QUÉ NO `pg_restore`. `pg_dump` en formato plano (COPY) + `psql` es lo que
 * corresponde aquí: el esquema YA existe en destino (lo crean los .sql de
 * db/migrations, ver scripts/migrate.ts) y solo faltan los datos. Un
 * `pg_restore` de un dump completo intentaría recrear tablas, triggers e
 * índices que ya están, y pelearía con el DO block de pgvector.
 *
 * EL PUERTO IMPORTA. Supabase expone el pooler en dos modos: 6543 es
 * *transaction mode* y no admite las sentencias a nivel de sesión que usa la
 * restauración; 5432 en el MISMO host del pooler es *session mode* y sí. El
 * script cambia el puerto solo para el volcado/restauración; la app sigue
 * usando el 6543 que tiene en DATABASE_URL.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

import { PROJECT_ROOT, describeDatabaseUrl, loadEnv } from "./loadEnv";

/**
 * Tablas que NO se copian. `_catalog_migrations` es el libro de a bordo del
 * destino: ya tiene sus propias filas de cuando se aplicó el esquema, y
 * pisarlas con las del origen haría creer que faltan migraciones.
 */
const SKIP_TABLES = ["_catalog_migrations"];

/** Columnas vectoriales a verificar después de copiar (tabla → columnas). */
const VECTOR_COLUMNS: Record<string, string[]> = {
  catalog_products: ["image_embedding", "text_embedding"],
};

type TableCount = { table: string; rows: number };

function fail(message: string, hint?: string): never {
  console.error(`\n✖ ${message}`);
  if (hint) console.error(`  → ${hint}\n`);
  process.exit(1);
}

/** TLS igual que en lib/db/pool.ts: el pooler de Supabase no verifica cadena. */
function sslFor(url: string): boolean | { rejectUnauthorized: boolean } {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    /* la validez de la URL se comprueba antes de llegar aquí */
  }
  if (hostname.endsWith(".supabase.co") || hostname.endsWith(".pooler.supabase.com")) {
    return { rejectUnauthorized: false };
  }
  return /[?&]sslmode=/i.test(url) || { rejectUnauthorized: true };
}

/**
 * Puerto en modo sesión. Solo aplica al pooler de Supabase: 6543 (transaction)
 * → 5432 (session). Cualquier otro host se deja intacto.
 */
function toSessionMode(url: string): string {
  const u = new URL(url);
  if (u.hostname.endsWith(".pooler.supabase.com") && u.port === "6543") {
    u.port = "5432";
  }
  return u.toString();
}

async function connect(url: string, label: string): Promise<Client> {
  const client = new Client({ connectionString: url, ssl: sslFor(url), connectionTimeoutMillis: 20_000 });
  try {
    await client.connect();
  } catch (err) {
    fail(
      `No se pudo conectar al ${label}: ${err instanceof Error ? err.message : String(err)}`,
      label === "origen"
        ? "Comprueba SOURCE_DATABASE_URL. Si el proveedor tiene cuota agotada, libérala antes."
        : "Comprueba DATABASE_URL (Supabase → Connect → Transaction pooler)."
    );
  }
  return client;
}

/** Tablas base del esquema public, en orden alfabético. */
async function listTables(client: Client): Promise<string[]> {
  const res = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`
  );
  return res.rows.map((r) => r.table_name).filter((t) => !SKIP_TABLES.includes(t));
}

async function countRows(client: Client, tables: string[]): Promise<TableCount[]> {
  const out: TableCount[] = [];
  for (const table of tables) {
    // format('%I') deja que Postgres cite el identificador: nada de concatenar.
    const res = await client.query<{ n: string }>(
      `select count(*)::text as n from ${client.escapeIdentifier(table)}`
    );
    out.push({ table, rows: Number(res.rows[0].n) });
  }
  return out;
}

function requireBinary(name: string): void {
  const probe = spawnSync(name, ["--version"], { encoding: "utf8" });
  if (probe.error) {
    fail(
      `Falta \`${name}\` en el PATH.`,
      "Instala las client tools de Postgres (macOS: brew install libpq o postgresql)."
    );
  }
}

async function main(): Promise<void> {
  loadEnv();
  const apply = process.argv.includes("--apply");

  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;

  if (!sourceUrl) {
    fail(
      "Falta SOURCE_DATABASE_URL (la base de datos de ORIGEN).",
      'Ejemplo: SOURCE_DATABASE_URL="postgres://…" npm run db:migrate:supabase'
    );
  }
  if (!targetUrl) {
    fail("Falta DATABASE_URL (el Supabase de DESTINO).", "Configúrala en .env.local.");
  }
  for (const [url, label] of [
    [sourceUrl, "SOURCE_DATABASE_URL"],
    [targetUrl, "DATABASE_URL"],
  ] as const) {
    if (!/^postgres(ql)?:\/\//i.test(url)) fail(`${label} no es una cadena postgres://.`);
  }

  requireBinary("pg_dump");
  requireBinary("psql");

  console.log(`\n${apply ? "MIGRACIÓN DE DATOS" : "SIMULACRO (sin --apply no se escribe nada)"}`);
  console.log(`  origen  : ${describeDatabaseUrl(sourceUrl)}`);
  console.log(`  destino : ${describeDatabaseUrl(targetUrl)}\n`);

  const source = await connect(sourceUrl, "origen");
  const target = await connect(targetUrl, "destino");

  try {
    // 1 — inventario ---------------------------------------------------------
    const sourceTables = await listTables(source);
    const targetTables = await listTables(target);

    const missingInTarget = sourceTables.filter((t) => !targetTables.includes(t));
    if (missingInTarget.length > 0) {
      fail(
        `El destino no tiene ${missingInTarget.length} tabla(s) del origen: ${missingInTarget.join(", ")}`,
        "Aplica el esquema antes de migrar datos: npm run db:migrate"
      );
    }

    const before = await countRows(source, sourceTables);
    const nonEmptySource = before.filter((t) => t.rows > 0);
    const totalRows = before.reduce((acc, t) => acc + t.rows, 0);

    console.log(`Origen: ${totalRows} fila(s) en ${nonEmptySource.length} tabla(s) con datos`);
    for (const t of nonEmptySource) console.log(`  · ${t.table.padEnd(34)} ${t.rows}`);
    if (totalRows === 0) {
      console.log("\n✓ El origen no tiene datos: no hay nada que migrar.\n");
      return;
    }

    // 2 — el destino debe estar vacío ---------------------------------------
    const targetBefore = await countRows(target, sourceTables);
    const dirty = targetBefore.filter((t) => t.rows > 0);
    if (dirty.length > 0) {
      fail(
        `El destino YA tiene datos en ${dirty.length} tabla(s): ` +
          dirty.map((t) => `${t.table}=${t.rows}`).join(", "),
        "Esta migración solo corre sobre un destino vacío, para no duplicar ni pisar filas."
      );
    }
    console.log("\n✓ Destino vacío: se puede copiar conservando los IDs.");

    if (!apply) {
      console.log(
        `\nSIMULACRO: se copiarían ${totalRows} fila(s). ` +
          "Vuelve a lanzarlo con --apply para hacerlo de verdad.\n"
      );
      return;
    }

    // 3 — volcado ------------------------------------------------------------
    const outDir = join(PROJECT_ROOT, ".migration");
    mkdirSync(outDir, { recursive: true });
    const dumpFile = join(outDir, "source-data.sql");

    console.log("\n→ Volcando datos del origen (pg_dump --data-only) …");
    execFileSync(
      "pg_dump",
      [
        toSessionMode(sourceUrl),
        "--data-only",
        "--no-owner",
        "--no-privileges",
        "--no-comments",
        /**
         * SOLO el esquema `public`, y esto NO es cosmético. Si el origen es un
         * Supabase, un pg_dump sin acotar arrastra también `auth.*`,
         * `storage.*`, `realtime.*` y `vault.*` — los esquemas internos del
         * servicio, con sus usuarios, sesiones y buckets. Restaurar eso encima
         * del destino le pisaría su propio estado interno. Comprobado: un
         * volcado sin `--schema` traía 64 bloques COPY, de los que 22 eran de
         * `auth` y 8 de `storage`.
         */
        "--schema=public",
        ...SKIP_TABLES.flatMap((t) => ["--exclude-table", `public.${t}`]),
        "--file",
        dumpFile,
      ],
      { stdio: ["ignore", "inherit", "inherit"] }
    );
    console.log(`✓ Volcado: ${(statSync(dumpFile).size / 1024).toFixed(0)} KB`);

    // 4 — restauración -------------------------------------------------------
    // --single-transaction: o entra todo, o no entra nada. ON_ERROR_STOP evita
    // que psql siga alegremente después del primer error.
    console.log("→ Restaurando en Supabase (psql --single-transaction) …");
    execFileSync(
      "psql",
      [
        toSessionMode(targetUrl),
        "--single-transaction",
        "--variable=ON_ERROR_STOP=1",
        "--quiet",
        "--file",
        dumpFile,
      ],
      { stdio: ["ignore", "inherit", "inherit"] }
    );
    console.log("✓ Datos restaurados.");

    // 5 — secuencias ---------------------------------------------------------
    // pg_dump --data-only ya emite setval, pero solo para las secuencias que
    // posee una columna. Reajustamos todas por si acaso: un id repetido en el
    // primer insert después de migrar es un fallo carísimo de diagnosticar.
    console.log("→ Reajustando secuencias …");
    const seqs = await target.query<{ seq: string; tbl: string; col: string }>(
      `select s.relname as seq, t.relname as tbl, a.attname as col
         from pg_class s
         join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass
         join pg_class t on t.oid = d.refobjid
         join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
        where s.relkind = 'S'`
    );
    for (const { seq, tbl, col } of seqs.rows) {
      await target.query(
        `select setval($1, coalesce((select max(${target.escapeIdentifier(col)}) from ${target.escapeIdentifier(tbl)}), 0) + 1, false)`,
        [seq]
      );
    }
    console.log(`✓ ${seqs.rowCount} secuencia(s) reajustada(s).`);

    // 6 — validación ---------------------------------------------------------
    console.log("\nVALIDACIÓN\n");
    let problems = 0;

    // 6a. conteos
    const after = await countRows(target, sourceTables);
    const afterByTable = new Map(after.map((t) => [t.table, t.rows]));
    for (const { table, rows } of nonEmptySource) {
      const got = afterByTable.get(table) ?? 0;
      if (got === rows) {
        console.log(`  ✓ ${table.padEnd(34)} ${got}/${rows}`);
      } else {
        problems++;
        console.error(`  ✖ ${table.padEnd(34)} ${got}/${rows}  ← NO COINCIDE`);
      }
    }

    // 6b. embeddings: no basta con que la fila exista, el vector tiene que
    //     haber sobrevivido con su dimensión.
    console.log("");
    for (const [table, columns] of Object.entries(VECTOR_COLUMNS)) {
      if (!sourceTables.includes(table)) continue;
      for (const column of columns) {
        const q = `select count(*)::text n, coalesce(min(vector_dims(${target.escapeIdentifier(column)}))::text,'-') lo,
                          coalesce(max(vector_dims(${target.escapeIdentifier(column)}))::text,'-') hi
                     from ${target.escapeIdentifier(table)} where ${target.escapeIdentifier(column)} is not null`;
        const [src, dst] = await Promise.all([
          source.query<{ n: string; lo: string; hi: string }>(q),
          target.query<{ n: string; lo: string; hi: string }>(q),
        ]);
        const s = src.rows[0];
        const d = dst.rows[0];
        if (s.n === d.n && s.lo === d.lo && s.hi === d.hi) {
          console.log(`  ✓ ${table}.${column}: ${d.n} vector(es), dims ${d.lo}..${d.hi}`);
        } else {
          problems++;
          console.error(
            `  ✖ ${table}.${column}: origen ${s.n} (dims ${s.lo}..${s.hi}) vs destino ${d.n} (dims ${d.lo}..${d.hi})`
          );
        }
      }
    }

    // 6c. integridad referencial: que la copia no haya dejado huérfanos.
    const fk = await target.query<{ n: string }>(
      `select count(*)::text as n from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`
    );
    try {
      // Revalida TODAS las FK de golpe dentro de una transacción que se tira.
      await target.query("begin");
      await target.query("set constraints all immediate");
      await target.query("rollback");
      console.log(`  ✓ Integridad referencial: ${fk.rows[0].n} clave(s) ajena(s) sin huérfanos`);
    } catch (err) {
      await target.query("rollback").catch(() => {});
      problems++;
      console.error(`  ✖ Integridad referencial: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 7 — informe ------------------------------------------------------------
    console.log("\n" + "─".repeat(58));
    console.log(`  Tablas copiadas   : ${nonEmptySource.length}`);
    console.log(`  Filas copiadas    : ${after.reduce((a, t) => a + t.rows, 0)}/${totalRows}`);
    console.log(`  Secuencias        : ${seqs.rowCount}`);
    console.log(`  Volcado           : ${dumpFile}`);
    console.log(`  Problemas         : ${problems}`);
    console.log("─".repeat(58));

    if (problems > 0) {
      console.error("\n✖ La migración terminó CON PROBLEMAS. Revisa las líneas ✖ de arriba.\n");
      process.exit(1);
    }
    console.log("\n✓ Migración de datos completada y validada.\n");
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("\n✖ Error migrando los datos:\n", err);
  process.exit(1);
});
