/**
 * Banco de pruebas de la búsqueda vectorial a escala.
 *
 *   npm run matching:bench
 *
 * Mide cómo escala la consulta con 1.000 y 10.000 productos, con y sin índice
 * HNSW, y con varias detecciones concurrentes.
 *
 * Usa una tabla APARTE (`catalog_products_bench`) con la misma forma y el mismo
 * tipo de columna que la real. No se siembran productos sintéticos en
 * `catalog_products`: un fallo a mitad de limpieza dejaría basura en el
 * catálogo de verdad, y el catálogo de verdad es lo que se está midiendo.
 *
 * IMPORTANTE al leer los resultados: entre este proceso y Neon hay ~200 ms de
 * ida y vuelta. Ese suelo se mide aparte (`RTT`) y hay que restarlo para
 * estimar producción, donde funciones y base están en la misma región.
 */
import { performance } from "node:perf_hooks";

import { loadEnv } from "./loadEnv";
loadEnv();

import { Client } from "pg";

/**
 * Cliente PROPIO, no el pool de la aplicación.
 *
 * El pool de la app tiene `query_timeout: 15_000` —correcto para servir
 * peticiones, porque una consulta colgada no puede bloquear un request—, pero
 * sembrar 10.000 filas y construir un índice HNSW tarda más que eso a
 * propósito. Con el pool de la app el banco moría en el sembrado.
 */
function benchClient(): Client {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("falta DATABASE_URL");
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 600_000,
    query_timeout: 600_000,
    connectionTimeoutMillis: 30_000,
  });
}

const DIM = 512;
const SCALES = (process.env.BENCH_SCALES ?? "1000,10000")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const CONCURRENCY = [1, 3, 5];
const ROUNDS = 7;

function randomVector(): number[] {
  const v = Array.from({ length: DIM }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((x) => x / norm);
}

type Timing = { p50: number; p95: number; avg: number };

function stats(ms: number[]): Timing {
  const s = [...ms].sort((a, b) => a - b);
  return {
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    avg: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

const fmt = (t: Timing) =>
  `${t.p50.toFixed(1).padStart(8)} ${t.p95.toFixed(1).padStart(8)} ${t.avg.toFixed(1).padStart(8)}`;

async function main() {
  const pool = benchClient();
  await pool.connect();

  /* ------------------------------- suelo de red ------------------------------ */
  const rtt: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const a = performance.now();
    await pool.query("select 1");
    rtt.push(performance.now() - a);
  }
  const rttStats = stats(rtt);
  console.log(`\nSuelo de red (select 1): p50 ${rttStats.p50.toFixed(1)} ms\n`);

  await pool.query(`drop table if exists catalog_products_bench`);
  await pool.query(`
    create table catalog_products_bench (
      id uuid primary key default gen_random_uuid(),
      category text,
      is_active boolean not null default true,
      image_embedding vector(${DIM}),
      embedding_dimension integer,
      doc jsonb not null
    )`);

  const query = randomVector();
  const results: string[] = [];

  try {
    let seeded = 0;
    for (const scale of SCALES) {
      /* ------------------------------- sembrado ------------------------------ */
      const toAdd = scale - seeded;
      const BATCH = 250;
      const tSeed = performance.now();
      for (let i = 0; i < toAdd; i += BATCH) {
        const n = Math.min(BATCH, toAdd - i);
        const values: string[] = [];
        const params: unknown[] = [];
        for (let j = 0; j < n; j++) {
          const base = params.length;
          params.push(
            ["t-shirt", "shoes", "bag", "dress", "watch"][(i + j) % 5],
            JSON.stringify(randomVector()),
            DIM,
            JSON.stringify({
              id: null,
              title: `Producto sintético ${i + j}`,
              category: "t-shirt",
              images: [{ url: "https://cdn.example/x.jpg" }],
              primaryImage: "https://cdn.example/x.jpg",
              isActive: true,
            })
          );
          values.push(`($${base + 1}, true, $${base + 2}::vector, $${base + 3}, $${base + 4}::jsonb)`);
        }
        await pool.query(
          `insert into catalog_products_bench (category, is_active, image_embedding, embedding_dimension, doc)
           values ${values.join(",")}`,
          params
        );
      }
      seeded = scale;
      console.log(
        `Sembrados ${scale} productos (${((performance.now() - tSeed) / 1000).toFixed(1)} s)`
      );

      // ANALYZE tras la carga masiva. NO es opcional: sin estadísticas frescas
      // el planificador subestima la tabla y con 10.000 filas descartaba el
      // índice HNSW, quedándose en escaneo secuencial (31 ms en vez de <1 ms).
      // Es el mismo riesgo en producción después de cada importación grande.
      await pool.query(`analyze catalog_products_bench`);

      /* -------------------------- SIN índice (seq scan) ---------------------- */
      await pool.query(`drop index if exists idx_bench_hnsw`);
      const noIdx: number[] = [];
      const noIdxServer: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const a = performance.now();
        await pool.query(
          `select id from catalog_products_bench
            where is_active and image_embedding is not null
            order by image_embedding <=> $1::vector limit 24`,
          [JSON.stringify(query)]
        );
        noIdx.push(performance.now() - a);
        noIdxServer.push(await serverMs(pool, query, false));
      }

      /* --------------------------- CON índice HNSW --------------------------- */
      const tIdx = performance.now();
      await pool.query(
        `create index idx_bench_hnsw on catalog_products_bench
           using hnsw (image_embedding vector_cosine_ops)`
      );
      const buildMs = performance.now() - tIdx;
      // Otra vez tras crear el índice: el planificador necesita saber que existe
      // y con qué correlación, o no lo elegirá.
      await pool.query(`analyze catalog_products_bench`);

      const withIdx: number[] = [];
      const withIdxServer: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const a = performance.now();
        await pool.query(
          `select id from catalog_products_bench
            where is_active and image_embedding is not null
            order by image_embedding <=> $1::vector limit 24`,
          [JSON.stringify(query)]
        );
        withIdx.push(performance.now() - a);
        withIdxServer.push(await serverMs(pool, query, true));
      }

      results.push(
        `\n${scale} productos · índice HNSW construido en ${(buildMs / 1000).toFixed(1)} s`,
        `${"".padEnd(30)}${"p50".padStart(9)}${"p95".padStart(9)}${"media".padStart(9)}`,
        `  sin índice (cliente)        ${fmt(stats(noIdx))}`,
        `  sin índice (servidor)       ${fmt(stats(noIdxServer))}`,
        `  HNSW (cliente)              ${fmt(stats(withIdx))}`,
        `  HNSW (servidor)             ${fmt(stats(withIdxServer))}`
      );

      /* ------------------------------ concurrencia --------------------------- */
      for (const c of CONCURRENCY) {
        const runs: number[] = [];
        for (let i = 0; i < 5; i++) {
          const a = performance.now();
          // Promise.allSettled: una detección que falle no puede tumbar al resto.
          const settled = await Promise.allSettled(
            Array.from({ length: c }, () =>
              pool.query(
                `select id from catalog_products_bench
                  where is_active and image_embedding is not null
                  order by image_embedding <=> $1::vector limit 24`,
                [JSON.stringify(randomVector())]
              )
            )
          );
          runs.push(performance.now() - a);
          const failed = settled.filter((s) => s.status === "rejected").length;
          if (failed) console.warn(`  ⚠ ${failed}/${c} consultas fallaron`);
        }
        results.push(`  ${c} detecciones a la vez (HNSW) ${fmt(stats(runs))}`);
      }
    }
  } finally {
    await pool.query(`drop table if exists catalog_products_bench`);
    console.log("\nTabla de pruebas eliminada.");
  }

  console.log("\nRESULTADOS (ms)");
  console.log("═".repeat(60));
  for (const line of results) console.log(line);
  console.log("═".repeat(60));
  console.log(
    `Suelo de red de este enlace: ${rttStats.p50.toFixed(0)} ms.` +
      " Réstalo del tiempo de cliente para estimar producción (misma región)."
  );
  await pool.end();
}

/** Tiempo de ejecución EN EL SERVIDOR, según el propio plan de Postgres. */
async function serverMs(
  pool: Client,
  query: number[],
  expectIndex: boolean
): Promise<number> {
  const res = await pool.query<{ "QUERY PLAN": string }>(
    `explain (analyze, format text)
     select id from catalog_products_bench
      where is_active and image_embedding is not null
      order by image_embedding <=> $1::vector limit 24`,
    [JSON.stringify(query)]
  );
  const text = res.rows.map((r) => Object.values(r)[0]).join("\n");
  if (expectIndex && !/Index Scan/.test(text)) {
    console.warn("  ⚠ se esperaba Index Scan y el plan usa otra estrategia");
  }
  const m = /Execution Time: ([\d.]+) ms/.exec(text);
  return m ? Number(m[1]) : Number.NaN;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
