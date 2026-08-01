/**
 * Perfilado del matching de catálogo, etapa por etapa.
 *
 *   npm run matching:profile
 *
 * Mide contra la base de datos REAL, no contra mocks: el cuello de botella de
 * este pipeline ha estado siempre en la frontera con Postgres (tamaño del
 * payload, ausencia de índice) y un banco en memoria lo escondería.
 *
 * Imprime cada etapa por separado para poder atacar la que domina en lugar de
 * optimizar a ojo.
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { loadEnv } from "./loadEnv";
loadEnv();

type Sample = { label: string; ms: number[] };

const samples: Sample[] = [];

function record(label: string, ms: number) {
  const found = samples.find((s) => s.label === label);
  if (found) found.ms.push(ms);
  else samples.push({ label, ms: [ms] });
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  record(label, performance.now() - t0);
  return out;
}

function stats(ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    avg: sum / sorted.length,
    p50: p(0.5),
    p95: p(0.95),
    max: sorted[sorted.length - 1],
  };
}

function report(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(78));
  console.log(
    `${"etapa".padEnd(38)}${"n".padStart(4)}${"media".padStart(10)}${"p50".padStart(10)}${"p95".padStart(10)}`
  );
  for (const s of samples) {
    const st = stats(s.ms);
    console.log(
      s.label.padEnd(38) +
        String(st.n).padStart(4) +
        `${st.avg.toFixed(1)} ms`.padStart(10) +
        `${st.p50.toFixed(1)} ms`.padStart(10) +
        `${st.p95.toFixed(1)} ms`.padStart(10)
    );
  }
  console.log("─".repeat(78));
}

const CROP_PATH =
  process.env.PROFILE_CROP ??
  "/private/tmp/claude-501/-Users-federicomencuccini-projects-app-ai-finder/988419fb-cf10-4065-aac1-83874a68cbf5/scratchpad/exact.jpg";
const ROUNDS = Number(process.env.PROFILE_ROUNDS) || 5;

async function main() {
  const crop = readFileSync(CROP_PATH);
  console.log(`Perfilado del matching · crop ${crop.byteLength} B · ${ROUNDS} rondas`);

  /* --------------------------- 1. embeddings --------------------------- */
  const { getEmbeddingProvider } = await import("../lib/catalogIngestion/embeddings/index");

  const tCold = performance.now();
  const provider = await getEmbeddingProvider();
  const coldMs = performance.now() - tCold;
  console.log(
    `\nProvider de embeddings: dim=${provider.dimension()} · ARRANQUE EN FRÍO ${coldMs.toFixed(0)} ms`
  );

  for (let i = 0; i < ROUNDS; i++) {
    await timed("embedding del crop (caliente)", () => provider.embedImage(crop));
  }

  /* ------------------------- 2. imagen completa ------------------------ */
  const { processImageBuffer } = await import("../lib/catalogIngestion/images/processor");
  for (let i = 0; i < ROUNDS; i++) {
    await timed("procesar crop (hash+phash+emb)", () => processImageBuffer(crop));
  }

  /* ------------------------ 3. consulta vectorial ---------------------- */
  const { getPool } = await import("../lib/catalogIngestion/database/pool");
  const pool = getPool();

  const dims = await pool.query<{ dim: number; n: string }>(
    "select embedding_dimension as dim, count(*)::int as n from catalog_products where image_embedding is not null group by 1 order by n desc"
  );
  console.log(
    "\nEmbeddings indexados: " +
      dims.rows.map((r) => `dim=${r.dim} → ${r.n}`).join(" · ")
  );

  const idx = await pool.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where tablename = 'catalog_products' and indexdef ilike '%image_embedding%'"
  );
  console.log(
    `Índice vectorial: ${idx.rowCount ? idx.rows.map((r) => r.indexdef).join(" | ") : "NINGUNO (escaneo secuencial)"}`
  );

  const probe = await pool.query(
    "select image_embedding from catalog_products where embedding_dimension = 512 limit 1"
  );
  const vec = probe.rows[0]?.image_embedding;
  if (!vec) throw new Error("no hay embeddings de 512 dimensiones en el catálogo");

  for (let i = 0; i < ROUNDS; i++) {
    await timed("pgvector top-50 (solo ids)", async () => {
      await pool.query(
        `select id from catalog_products
          where is_active and embedding_dimension = 512
          order by image_embedding <=> $1 limit 50`,
        [vec]
      );
    });
  }

  for (let i = 0; i < ROUNDS; i++) {
    await timed("pgvector top-300 (doc sin emb)", async () => {
      await pool.query(
        `select doc - 'imageEmbedding' - 'textEmbedding' as doc,
                1 - (image_embedding <=> $1) as similarity
           from catalog_products
          where is_active and embedding_dimension = 512
          order by image_embedding <=> $1 limit 300`,
        [vec]
      );
    });
  }

  /* ------------------- 4. camino completo del catálogo ----------------- */
  const { getStore } = await import("../lib/catalogIngestion/catalog/store");
  const { matchProducts } = await import("../lib/catalogIngestion/catalog/matching");
  const store = await getStore();

  const img = await processImageBuffer(crop);
  for (let i = 0; i < ROUNDS; i++) {
    await timed("matchProducts completo", async () => {
      await matchProducts(store, {
        imageSha256: img.sha256,
        perceptualHash: img.perceptualHash,
        imageEmbedding: img.embedding,
        category: "clothing",
        topK: 8,
        minScore: 0.5,
      });
    });
  }

  report("RESULTADOS");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
