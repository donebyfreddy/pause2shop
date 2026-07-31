import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { FileCatalogStore } from "../../lib/catalogIngestion/catalog/fileStore";
import { DatasetImporter, resolveOptions } from "../../lib/catalogIngestion/datasets/importer";
import { FASHION_PRODUCT_IMAGES_SMALL } from "../../lib/catalogIngestion/datasets/registry";
import type { FashionDatasetRow } from "../../lib/catalogIngestion/datasets/types";
import type { DatasetReader } from "../../lib/catalogIngestion/datasets/reader";
import sharp from "sharp";
import { tempDataDir } from "./helpers";

/**
 * Importador de dataset con un lector FALSO.
 *
 * El lector se sustituye a propósito: estos tests comprueban idempotencia,
 * reanudación y tolerancia a filas corruptas, y ninguna de esas propiedades
 * depende de HuggingFace. Pegarse a la red haría los tests lentos, frágiles y
 * dependientes de que un dataset externo no cambie.
 */

let store: FileCatalogStore;

/**
 * Imagen ÚNICA por fila.
 *
 * Detalle que costó un test rojo y merece quedar escrito: si todas las filas
 * comparten los mismos bytes, comparten el sha256 y el dedup por
 * `exact_image_hash` las fusiona en UNA sola ficha. Es el comportamiento
 * correcto (dos ids distintos con la misma foto exacta son la misma prenda
 * listada dos veces) y es real: en la importación de 1.000 filas del dataset
 * aparecieron 5 casos así. Para aislar el dedup por id, cada fila necesita su
 * propia imagen.
 */
const imageCache = new Map<number, Buffer>();
async function uniqueImage(id: number): Promise<Buffer> {
  const cached = imageCache.get(id);
  if (cached) return cached;
  const buffer = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: id % 251, g: (id * 7) % 251, b: (id * 13) % 251 },
    },
  })
    .jpeg()
    .toBuffer();
  imageCache.set(id, buffer);
  return buffer;
}

/** Filas sintéticas con ids únicos, como el dataset real. */
function fakeRows(count: number, startId = 1000): FashionDatasetRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    gender: i % 2 === 0 ? "Men" : "Women",
    masterCategory: i % 3 === 0 ? "Footwear" : "Apparel",
    subCategory: "Topwear",
    articleType: i % 3 === 0 ? "Casual Shoes" : "Shirts",
    baseColour: "Blue",
    season: "Fall",
    year: 2011,
    usage: "Casual",
    productDisplayName: `Puma Men Producto ${startId + i}`,
    imageUrl: `https://fake.test/${startId + i}.jpg`,
    rowIndex: i,
  }));
}

/**
 * Instala un lector falso. `failImageFor` simula una imagen no descargable y
 * `corruptImageFor` unos bytes que no son una imagen: los dos casos deben
 * omitir SOLO esa fila.
 */
function fakeReader(options: {
  rows: FashionDatasetRow[];
  failImageFor?: Set<number>;
  corruptImageFor?: Set<number>;
  throwAtRow?: number;
}): { reader: DatasetReader; loads: number[] } {
  const loads: number[] = [];
  const fake: DatasetReader = {
    provider: "huggingface",
    inspect: async () => ({
      descriptor: FASHION_PRODUCT_IMAGES_SMALL,
      totalRows: options.rows.length,
      version: "testrev",
      sizeBytes: 1234,
      features: { id: "int64" },
      sample: options.rows[0] ?? null,
      reachable: true,
      unreachableReason: null,
    }),
    async *streamRows({ offset, limit }) {
      const end = Math.min(offset + limit, options.rows.length);
      for (let i = offset; i < end; i += 1) {
        if (options.throwAtRow != null && i === options.throwAtRow) {
          throw new Error("fallo simulado del proveedor");
        }
        yield options.rows[i];
      }
    },
    loadImage: async (row) => {
      loads.push(row.id);
      if (options.failImageFor?.has(row.id)) return null;
      if (options.corruptImageFor?.has(row.id)) {
        return { buffer: Buffer.from("esto no es una imagen"), contentType: "image/jpeg" };
      }
      return { buffer: await uniqueImage(row.id), contentType: "image/jpeg" };
    },
  };
  return { reader: fake, loads };
}

beforeEach(async () => {
  const dir = tempDataDir("dataset-importer");
  store = new FileCatalogStore(join(dir, "catalog.json"));
  await store.init();
  // Sin subida de imágenes: el storage se prueba aparte y aquí interesa la
  // lógica de importación, no el proveedor de blobs.
  process.env.CATALOG_DATASET_UPLOAD_IMAGES = "false";
  process.env.CATALOG_IMAGE_EMBEDDING_PROVIDER = "hash";
  process.env.CATALOG_EMBEDDING_PROVIDER = "hash";
  // Storage `local` con una base pública: publica en memoria, sin red y sin
  // necesitar credenciales de blob. Suficiente para los casos que SÍ suben
  // imagen; el driver real de Vercel Blob se prueba aparte.
  process.env.STORAGE_PROVIDER = "local";
  process.env.PUBLIC_MEDIA_BASE_URL = "https://media.test";
});

test("importa el número pedido de filas", async () => {
  const { reader } = fakeReader({ rows: fakeRows(20) });
  const result = await new DatasetImporter({ store, reader }).import({
    limit: 10,
    batchSize: 5,
    uploadImages: false,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.counters.rowsRead, 10);
  assert.equal(result.counters.created, 10);
  assert.equal(result.counters.errors, 0);
  const { total } = await store.listProducts({ limit: 100 });
  assert.equal(total, 10);
});

test("repetir la importación NO duplica: actualiza", async () => {
  const { reader } = fakeReader({ rows: fakeRows(20) });
  const importer = new DatasetImporter({ store, reader });
  const first = await importer.import({ limit: 10, batchSize: 5, uploadImages: false });
  assert.equal(first.counters.created, 10);

  const second = await importer.import({ limit: 10, batchSize: 5, uploadImages: false });
  assert.equal(second.counters.created, 0, "nada nuevo en la segunda pasada");
  // `unchanged`, no `updated`: los datos son idénticos, así que no se ha
  // reescrito ningún campo. Contarlas como "actualizadas" era lo que ocultó que
  // una corrección del mapeo de categorías no se estaba propagando.
  assert.equal(second.counters.unchanged, 10, "existían y NO han cambiado");
  assert.equal(second.counters.updated, 0, "cero cambios reales");

  const { total } = await store.listProducts({ limit: 100 });
  assert.equal(total, 10, "el catálogo sigue teniendo diez fichas, no veinte");
});

test("un cambio real de contenido SÍ cuenta como actualizado", async () => {
  // El contrapunto del test anterior: si algo cambia de verdad, tiene que verse.
  // La taxonomía entra en el contentHash precisamente por esto.
  const rows = fakeRows(5);
  const first = fakeReader({ rows });
  const importer = new DatasetImporter({ store, reader: first.reader });
  await importer.import({ limit: 5, batchSize: 5, uploadImages: false });

  const changed = rows.map((r) => ({ ...r, articleType: "Watches", baseColour: "Black" }));
  const second = fakeReader({ rows: changed });
  const result = await new DatasetImporter({ store, reader: second.reader }).import({
    limit: 5,
    batchSize: 5,
    uploadImages: false,
  });
  assert.equal(result.counters.updated, 5, "cambiar categoría y color es un cambio real");
  assert.equal(result.counters.unchanged, 0);

  const { items } = await store.listProducts({ limit: 10 });
  for (const p of items) {
    assert.equal(p.category, "watch", "la nueva categoría se ha propagado");
    assert.equal(p.color, "black");
  }
});

test("una imagen no descargable omite SOLO esa fila", async () => {
  const { reader } = fakeReader({ rows: fakeRows(10), failImageFor: new Set([1003, 1007]) });
  const result = await new DatasetImporter({ store, reader }).import({
    limit: 10,
    batchSize: 10,
    uploadImages: false,
  });
  assert.equal(result.counters.created, 8, "las otras ocho entran");
  assert.equal(result.counters.errors, 2);
  // El error identifica la fila, que es lo que permite reintentarla.
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((e) => e.sourceProductId));
  // Y el estado refleja que quedó incompleta en vez de decir "completado".
  assert.equal(result.status, "partially_completed");
});

test("una imagen corrupta se omite sin tumbar la importación", async () => {
  const { reader } = fakeReader({ rows: fakeRows(6), corruptImageFor: new Set([1002]) });
  const result = await new DatasetImporter({ store, reader }).import({
    limit: 6,
    batchSize: 6,
    uploadImages: false,
  });
  assert.equal(result.counters.created, 5);
  assert.equal(result.counters.errors, 1);
  assert.ok(
    result.errors[0].message.includes("corrupta") ||
      result.errors[0].message.includes("formato") ||
      result.errors[0].message.includes("dimensiones"),
    `el motivo debe explicar el descarte, se recibió: ${result.errors[0].message}`
  );
});

test("un fallo del proveedor a mitad conserva lo ya importado y deja checkpoint", async () => {
  // El proveedor revienta en la fila 7: las seis primeras ya estaban guardadas y
  // no deben perderse. Es la diferencia entre reanudable y volver a empezar.
  const { reader } = fakeReader({ rows: fakeRows(20), throwAtRow: 7 });
  const result = await new DatasetImporter({ store, reader }).import({
    limit: 20,
    batchSize: 5,
    uploadImages: false,
  });
  assert.equal(result.status, "partially_completed");
  // Siete, no cinco: el primer lote completo (5) MÁS las dos filas que ya
  // estaban en el lote a medio llenar cuando el proveedor falló. El manejador
  // de error hace un último flush a propósito, para no tirar trabajo ya hecho.
  assert.equal(result.counters.created, 7, "se conserva incluso el lote a medias");
  assert.ok(result.nextOffset > 0, "el checkpoint apunta más allá del inicio");
  const { total } = await store.listProducts({ limit: 100 });
  assert.equal(total, 7);
});

test("el offset permite importar un rango distinto sin solapar", async () => {
  const { reader } = fakeReader({ rows: fakeRows(20) });
  const importer = new DatasetImporter({ store, reader });
  await importer.import({ limit: 5, offset: 0, batchSize: 5, uploadImages: false });
  const second = await importer.import({ limit: 5, offset: 5, batchSize: 5, uploadImages: false });
  assert.equal(second.counters.created, 5, "el segundo rango son fichas nuevas");
  const { total } = await store.listProducts({ limit: 100 });
  assert.equal(total, 10);
});

test("reanudar continúa desde el checkpoint y no relee lo hecho", async () => {
  const rows = fakeRows(20);
  const { reader, loads } = fakeReader({ rows });

  // Primer tramo: cinco filas.
  const importer = new DatasetImporter({ store, reader });
  const first = await importer.import({ limit: 5, offset: 0, batchSize: 5, uploadImages: false });
  const readFirst = loads.length;
  assert.equal(first.counters.created, 5);

  // El job se persiste a mano con el checkpoint que dejaría el handler real.
  const jobId = "11111111-1111-4111-8111-111111111111";
  await store.saveJob({
    jobId,
    type: "dataset_import",
    source: FASHION_PRODUCT_IMAGES_SMALL.id,
    mode: null,
    limit: 20,
    status: "partially_completed",
    progress: {
      discovered: 20, fetched: 5, new: 5, updated: 0, duplicates: 0, errors: 0,
      ignored: 0, retries: 0, withAi: 0, withoutAi: 5, withBrowser: 0,
      aiCostUsd: 0, aiTokens: 0, imagesUploaded: 0, imagesSkipped: 0,
      embeddingsReady: 0, embeddingsQueued: 5, stage: "saving",
    },
    checkpoint: {
      datasetId: FASHION_PRODUCT_IMAGES_SMALL.id,
      options: resolveOptions({ limit: 20, offset: 0, batchSize: 5, uploadImages: false }),
      nextOffset: first.nextOffset,
      endOffset: 20,
      counters: first.counters,
      version: "testrev",
    },
    errors: [],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: 0,
    cancelRequested: false,
  });

  const resumed = await new DatasetImporter({ store, reader }).resume(jobId);
  assert.equal(resumed.counters.created, 20, "los contadores acumulan sobre el tramo previo");
  assert.equal(resumed.nextOffset, 20, "termina el rango original");

  const { total } = await store.listProducts({ limit: 100 });
  assert.equal(total, 20, "veinte fichas en total, sin duplicar las cinco primeras");

  // Lo importante: no volvió a leer las cinco primeras filas.
  const rereadFirstFive = loads.slice(readFirst).filter((id) => id < 1005);
  assert.equal(rereadFirstFive.length, 0, "reanudar no debe releer lo ya importado");
});

test("resume rechaza jobs que no son de importación de dataset", async () => {
  await store.saveJob({
    jobId: "22222222-2222-4222-8222-222222222222",
    type: "sync_full",
    source: "zara",
    mode: "full",
    limit: null,
    status: "failed",
    progress: {
      discovered: 0, fetched: 0, new: 0, updated: 0, duplicates: 0, errors: 0,
      ignored: 0, retries: 0, withAi: 0, withoutAi: 0, withBrowser: 0,
      aiCostUsd: 0, aiTokens: 0, imagesUploaded: 0, imagesSkipped: 0,
      embeddingsReady: 0, embeddingsQueued: 0, stage: null,
    },
    checkpoint: {},
    errors: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    durationMs: 0,
    cancelRequested: false,
  });
  // Sin reader: falla al validar el tipo de job, antes de tocar el dataset.
  await assert.rejects(
    () => new DatasetImporter({ store }).resume("22222222-2222-4222-8222-222222222222"),
    /no dataset_import/
  );
});

test("dry run no escribe nada y devuelve una muestra acotada", async () => {
  const { reader } = fakeReader({ rows: fakeRows(30) });
  const result = await new DatasetImporter({ store, reader }).import({
    limit: 30,
    batchSize: 10,
    dryRun: true,
    uploadImages: false,
  });
  assert.equal(result.status, "dry_run");
  assert.equal(result.dryRun, true);
  const { total } = await store.listProducts({ limit: 100 });
  assert.equal(total, 0, "un ensayo NO debe escribir ninguna ficha");
  assert.ok(result.preview.length > 0);
  assert.ok(result.preview.length <= 10, "la muestra se acota: 30 filas no son 30 fichas");
  assert.equal(result.preview[0].price, null);
});

test("los filtros de categoría se aplican y se cuentan como omitidas", async () => {
  const { reader } = fakeReader({ rows: fakeRows(9) });
  const result = await new DatasetImporter({ store, reader }).import({
    limit: 9,
    batchSize: 9,
    categories: ["Footwear"],
    uploadImages: false,
  });
  // fakeRows pone Footwear en una de cada tres filas.
  assert.equal(result.counters.created, 3);
  assert.equal(result.counters.skipped, 6, "las descartadas por filtro se cuentan aparte");
  assert.equal(result.counters.errors, 0, "un filtro no es un error");
});

test("la cancelación entre lotes para limpio y conserva lo hecho", async () => {
  const { reader } = fakeReader({ rows: fakeRows(30) });
  let batches = 0;
  const result = await new DatasetImporter({
    store,
    reader,
    // Se cancela tras el primer lote.
    isCancelled: () => ++batches >= 1,
  }).import({ limit: 30, batchSize: 10, uploadImages: false });

  assert.equal(result.status, "cancelled");
  assert.equal(result.counters.created, 10, "el lote en curso se completó antes de parar");
  const { total } = await store.listProducts({ limit: 100 });
  assert.equal(total, 10);
});

test("sin generar embeddings, las fichas quedan en cola y no fingen estar listas", async () => {
  const { reader } = fakeReader({ rows: fakeRows(4) });
  const result = await new DatasetImporter({ store, reader }).import({
    limit: 4,
    batchSize: 4,
    generateEmbeddings: false,
    // Con imágenes: sin ellas el estado correcto es `skipped`, no `pending`.
    uploadImages: true,
  });
  assert.equal(result.counters.embeddingsReady, 0);
  assert.equal(result.counters.embeddingsQueued, 4);
  const { items } = await store.listProducts({ limit: 10 });
  for (const p of items) {
    assert.equal(p.embeddingStatus, "pending", "queda pendiente de reindexado");
    assert.equal(p.imageEmbedding, null, "y sin vector: no se finge uno");
  }
});

test("sin subir imágenes el embedding se marca skipped, no pending", async () => {
  // Matiz importante: `pending` promete que el reindexado podrá procesarlo. Sin
  // imagen persistida eso es imposible, así que prometerlo sería mentir.
  const { reader } = fakeReader({ rows: fakeRows(3) });
  await new DatasetImporter({ store, reader }).import({
    limit: 3,
    batchSize: 3,
    uploadImages: false,
    generateEmbeddings: true,
  });
  const { items } = await store.listProducts({ limit: 10 });
  for (const p of items) assert.equal(p.embeddingStatus, "skipped");
});

test("resolveOptions aplica los defaults documentados", () => {
  const env = {} as NodeJS.ProcessEnv;
  const o = resolveOptions({}, env);
  assert.equal(o.source, "huggingface");
  assert.equal(o.limit, 1000);
  assert.equal(o.batchSize, 25);
  assert.equal(o.generateEmbeddings, true);
  assert.equal(o.uploadImages, true);
  assert.equal(o.dryRun, false);
  assert.equal(o.offset, 0);

  // El lote se acota al máximo del endpoint /rows de HuggingFace: pedir 500
  // devolvería 422 y no aceleraría nada.
  assert.equal(resolveOptions({ batchSize: 500 }, env).batchSize, 100);

  // Las variables de entorno configuran, los argumentos mandan.
  const withEnv = resolveOptions({}, {
    CATALOG_DATASET_DEFAULT_LIMIT: "50",
    CATALOG_DATASET_BATCH_SIZE: "10",
    CATALOG_DATASET_GENERATE_EMBEDDINGS: "false",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(withEnv.limit, 50);
  assert.equal(withEnv.batchSize, 10);
  assert.equal(withEnv.generateEmbeddings, false);
  assert.equal(
    resolveOptions({ limit: 7 }, { CATALOG_DATASET_DEFAULT_LIMIT: "50" } as unknown as NodeJS.ProcessEnv).limit,
    7
  );
});

test("un límite de cero no lee nada ni falla", async () => {
  const { reader } = fakeReader({ rows: fakeRows(10) });
  const result = await new DatasetImporter({ store, reader }).import({ limit: 0, uploadImages: false });
  assert.equal(result.counters.rowsRead, 0);
  assert.equal(result.status, "completed");
});
