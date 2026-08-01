import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import {
  matchProductsDetailed,
  type MatchTimings,
} from "../lib/catalogIngestion/catalog/matching";
import { compatibleCategories } from "../lib/catalogIngestion/normalization/normalize";
import type {
  CatalogStore,
  VectorSearchHit,
  VectorSearchOptions,
} from "../lib/catalogIngestion/catalog/store";
import type { CatalogProduct } from "../lib/catalogIngestion/catalog/types";
import { hydrateProduct } from "../lib/catalogIngestion/catalog/types";

/**
 * Rendimiento y forma del matching de catálogo.
 *
 * Estos tests NO miden la base de datos —eso lo hace `npm run matching:bench`
 * contra Postgres real, porque un mock mediría la velocidad del mock—. Lo que
 * comprueban aquí es lo que sí puede romperse en silencio y es puramente
 * nuestro:
 *
 *  - que la búsqueda pida top-K y no el catálogo entero;
 *  - que los filtros VIAJEN a la base en vez de aplicarse después;
 *  - que jamás se genere un embedding de catálogo durante una búsqueda;
 *  - que el coste en memoria no crezca con el tamaño del catálogo;
 *  - que varias detecciones concurrentes se aíslen unas de otras.
 *
 * El presupuesto de tiempo se aplica solo al trabajo EN MEMORIA (ranking), que
 * es determinista. Medir latencia de red en un test unitario daría fallos
 * aleatorios en CI.
 */

const DIM = 32;

function vector(seed: number): number[] {
  const v = Array.from({ length: DIM }, (_, i) => Math.sin(seed * (i + 1)));
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
  return v.map((x) => x / norm);
}

function product(i: number, over: Partial<CatalogProduct> = {}): CatalogProduct {
  // `hydrateProduct` completa lo que falte; el cast es para poder pasarle el
  // parcial que representa una fila recién leída de la proyección slim.
  return hydrateProduct({
    id: `p-${i}`,
    source: "bench",
    sourceProductId: `s-${i}`,
    title: `Producto ${i}`,
    category: ["t-shirt", "shoes", "bag"][i % 3],
    isActive: true,
    primaryImage: `https://cdn.example/${i}.jpg`,
    images: [{ url: `https://cdn.example/${i}.jpg`, localPath: null, sha256: null, perceptualHash: null, width: 800, height: 800 }],
    ...over,
  } as unknown as CatalogProduct);
}

/**
 * Store falso que se comporta como el de Postgres: resuelve la similitud "en
 * la base" y NUNCA entrega el catálogo entero a través de `allProducts`.
 * Registra lo que se le pide para poder afirmar sobre ello.
 */
function fakeStore(size: number) {
  const products = Array.from({ length: size }, (_, i) => product(i));
  const calls: VectorSearchOptions[] = [];
  let allProductsCalls = 0;

  const store: Partial<CatalogStore> = {
    backend: "postgres",
    async allProducts() {
      allProductsCalls++;
      return products;
    },
    async searchByImageEmbedding(
      _embedding: number[],
      opts: VectorSearchOptions
    ): Promise<VectorSearchHit[]> {
      calls.push(opts);
      let pool = products;
      // El filtrado ocurre "en la base", como en el store real.
      if (opts.categories?.length) {
        pool = pool.filter((p) => opts.categories!.includes(p.category ?? ""));
      }
      return pool.slice(0, opts.limit).map((p, i) => ({
        product: p,
        similarity: Math.max(0, 0.99 - i * 0.001),
      }));
    },
  };

  return {
    store: store as CatalogStore,
    calls,
    get allProductsCalls() {
      return allProductsCalls;
    },
  };
}

async function search(size: number, category?: string) {
  const fake = fakeStore(size);
  const t0 = performance.now();
  const { matches, timings } = await matchProductsDetailed(fake.store, {
    imageEmbedding: vector(1),
    category: category ?? null,
    topK: 8,
    minScore: 0.5,
  });
  return { fake, matches, timings, wallMs: performance.now() - t0 };
}

/* --------------------------- forma de la consulta -------------------------- */

test("la búsqueda pide top-K, no el catálogo entero", async () => {
  for (const size of [1_000, 10_000]) {
    const { fake } = await search(size);
    assert.equal(fake.calls.length, 1, `${size}: una sola consulta vectorial`);
    // Con topK=8 el límite es un puñado de candidatos, nunca el catálogo.
    assert.ok(
      fake.calls[0].limit <= 64,
      `${size}: pidió ${fake.calls[0].limit} candidatos; debe ser un top-K corto`
    );
    assert.equal(
      fake.allProductsCalls,
      0,
      `${size}: NO debe recorrer el catálogo en memoria habiendo búsqueda vectorial`
    );
  }
});

test("los filtros viajan a la base, no se aplican después", async () => {
  const { fake } = await search(1_000, "prenda superior");
  const opts = fake.calls[0];

  // "prenda superior" es un descriptor grueso del modelo de visión: tiene que
  // llegar a SQL ya expandido a las categorías finas que puede casar.
  assert.ok(opts.categories?.length, "debe mandar categorías compatibles");
  assert.ok(
    opts.categories!.includes("t-shirt"),
    `las categorías enviadas (${opts.categories}) deben incluir las finas de la familia`
  );
  assert.equal(opts.requireImage, true, "debe exigir imagen presentable en SQL");
});

test("compatibleCategories no filtra cuando no puede acotar con seguridad", () => {
  // Sin categoría, o con una desconocida, filtrar sería dejar fuera lo bueno.
  assert.equal(compatibleCategories(null), null);
  assert.equal(compatibleCategories(""), null);
  assert.equal(compatibleCategories("all"), null);
  assert.equal(compatibleCategories("chorizo"), null);

  // Con una familia conocida sí acota, e incluye sus categorías finas.
  const clothing = compatibleCategories("clothing");
  assert.ok(clothing && clothing.includes("t-shirt") && clothing.includes("dress"));
  assert.ok(!clothing!.includes("shoes"), "no puede colarse otra familia");

  // Con una categoría fina acota a ella y a su familia.
  const fine = compatibleCategories("t-shirt");
  assert.ok(fine && fine.includes("t-shirt") && fine.includes("clothing"));
});

/* ------------------------------ escalabilidad ------------------------------ */

test("el trabajo en memoria NO crece con el tamaño del catálogo", async () => {
  const small = await search(1_000);
  const large = await search(10_000);

  // Es la propiedad que hace que el sistema escale: con la preselección en la
  // base, multiplicar por 10 el catálogo no multiplica el ranking. Si esto
  // falla, alguien ha vuelto a traerse el catálogo entero a memoria.
  assert.equal(
    small.timings.candidateCount,
    large.timings.candidateCount,
    "el nº de candidatos a puntuar debe ser el mismo con 1.000 que con 10.000"
  );
  assert.ok(small.timings.usedVectorIndex && large.timings.usedVectorIndex);
  assert.equal(large.timings.fullScanMs, 0, "no debe haber recorrido completo");
});

test("presupuesto de ranking en memoria: < 50 ms con 10.000 productos", async () => {
  const { timings } = await search(10_000);
  assert.ok(
    timings.rankingMs < 50,
    `el ranking tardó ${timings.rankingMs.toFixed(1)} ms; presupuesto 50 ms`
  );
});

test("los tiempos se reportan por etapa y son coherentes", async () => {
  const { timings } = await search(1_000);
  const keys: Array<keyof MatchTimings> = [
    "vectorSearchMs",
    "rankingMs",
    "textEmbeddingMs",
    "fullScanMs",
    "totalMs",
  ];
  for (const k of keys) {
    assert.equal(typeof timings[k], "number", `falta la etapa ${k}`);
    assert.ok((timings[k] as number) >= 0, `${k} no puede ser negativo`);
  }
  // El total tiene que cubrir sus partes; si no, se está midiendo mal.
  assert.ok(
    timings.totalMs >= timings.rankingMs,
    "el total debe incluir al menos el ranking"
  );
  // Sin consulta de texto no debe haberse generado ningún embedding de texto.
  assert.equal(timings.textEmbeddingMs, 0);
});

/* ------------------------------ concurrencia ------------------------------- */

test("varias detecciones simultáneas se resuelven y se aíslan entre sí", async () => {
  const fake = fakeStore(10_000);
  // Una de las cinco falla: con Promise.all se perderían las otras cuatro.
  let call = 0;
  const original = fake.store.searchByImageEmbedding!.bind(fake.store);
  fake.store.searchByImageEmbedding = async (emb, opts) => {
    call++;
    if (call === 3) throw new Error("proveedor caído");
    return original(emb, opts);
  };

  const settled = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      matchProductsDetailed(fake.store, {
        imageEmbedding: vector(i + 1),
        topK: 8,
        minScore: 0.5,
      })
    )
  );

  assert.equal(settled.length, 5);
  const ok = settled.filter((s) => s.status === "fulfilled");
  assert.equal(ok.length, 5, "un fallo de la base degrada a recorrido, no rompe");

  // La que falló cayó al camino de respaldo en memoria; las demás usaron índice.
  const usedIndex = ok.filter(
    (s) => (s as PromiseFulfilledResult<{ timings: MatchTimings }>).value.timings.usedVectorIndex
  );
  assert.equal(usedIndex.length, 4);
});

/* ------------------------ embeddings del catálogo -------------------------- */

test("una búsqueda por imagen NO genera embeddings de catálogo", async () => {
  // El store falso no puede generar embeddings: si `matchProducts` intentara
  // calcular alguno del catálogo, tendría que pedir los productos completos y
  // `allProducts` quedaría registrado. Los del catálogo están precalculados en
  // la base y lo único que se embebe por búsqueda es el crop, fuera de aquí.
  const { fake, timings } = await search(10_000);
  assert.equal(fake.allProductsCalls, 0);
  assert.equal(timings.textEmbeddingMs, 0);
});
