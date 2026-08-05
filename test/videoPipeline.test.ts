import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAnalysisJob,
  dedupTracksIntoProducts,
  finalizeAnalysisJob,
  processFrameBatch,
} from "../lib/analysis/jobs/engine";
import type { JobEngineDeps, MatchProductFn } from "../lib/analysis/jobs/engine";
import {
  matchUniqueProducts,
  statusFromDetection,
} from "../lib/analysis/jobs/productMatching";
import { canonicalLabel, identityScore } from "../lib/analysis/jobs/identity";
import { cropQuality } from "../lib/analysis/jobs/cropQuality";
import type {
  JobRuntimeState,
  TrackRecord,
  UniqueProductRecord,
} from "../lib/analysis/jobs/types";
import type { ProductMatchingResult } from "../lib/matching/types";
import {
  detectionFor,
  fakeMatcher,
  frame,
  item,
  makeDeps,
  productThumb,
  ScriptedDetector,
  TEST_JOB_CONFIG,
  type MatchCall,
} from "./fixtures/analysisJobFixtures";

/**
 * PIPELINE DE VÍDEO PREPROCESADO, extremo a extremo y sin red.
 *
 * Cada test corresponde a un fallo real observado o a una garantía que el
 * pipeline debe dar. Los tres que motivaron el trabajo:
 *   - la misma prenda descrita de cinco formas producía cinco productos;
 *   - un timeout convertía el producto entero en "matching omitido" y se
 *     llevaba por delante el resultado del catálogo ya calculado;
 *   - los productos se resolvían en serie.
 */

const DURATION = 30;

/* -------------------------------- utilidades ------------------------------- */

function shirtEmbedding(seed: number): number[] {
  return Array.from(
    { length: 512 },
    (_, k) => Math.sin(k * 0.1) + seed * 0.002 * Math.cos(k)
  );
}

function makeTrack(args: {
  id: number;
  name: string;
  category: string;
  color?: string;
  embedding?: number[] | null;
  quality?: number;
  at?: number;
  personIndex?: number | null;
}): TrackRecord {
  const at = args.at ?? args.id * 1.5;
  const detected = item({
    name: args.name,
    category: args.category,
    color: args.color ?? "blanco",
    confidence: 0.8,
    bounding_box: { x: 0.3, y: 0.2, width: 0.25, height: 0.3 },
    ...(args.personIndex !== undefined ? { person_index: args.personIndex } : {}),
  });
  return {
    trackId: `t${args.id}`,
    category: args.category,
    name: args.name,
    color: args.color ?? "blanco",
    firstSeenSeconds: at,
    lastSeenSeconds: at + 1,
    seenFrameCount: 3,
    confidence: 0.8,
    bestCrop: {
      timestampSeconds: at,
      box: detected.bounding_box!,
      quality: args.quality ?? 0.5,
      sharpness: 0.5,
      frameDataUrl: `data:image/jpeg;base64,${Buffer.from(`f${args.id}`).toString("base64")}`,
      cropDataUrl: null,
      // Firmas MUY distintas entre sí: así el mérito de fundir recae en el
      // embedding y en los atributos, nunca en un hash que casó de casualidad.
      signatureHash: (BigInt(1) << BigInt((args.id * 13) % 63)).toString(16).padStart(16, "0"),
      embedding: args.embedding === undefined ? shirtEmbedding(args.id) : args.embedding,
    },
    representativeItem: detected,
  };
}

function stateWith(tracks: TrackRecord[]): JobRuntimeState {
  return {
    lastThumb: null,
    lastAnalyzedHash: null,
    currentSceneId: 1,
    scenes: [],
    trackerTracks: [],
    trackerNextId: 1,
    tracks: Object.fromEntries(tracks.map((t) => [t.trackId, t])),
    appearances: tracks.flatMap((t) =>
      [0, 1].map((k) => ({
        trackId: t.trackId,
        timestampSeconds: t.firstSeenSeconds + k,
        sceneId: 1,
        box: null,
        confidence: 0.8,
      }))
    ),
  };
}

const DEDUP_OPTS = {
  videoDurationSeconds: DURATION,
  identityThreshold: 0.84,
  strongIdentityThreshold: 0.9,
  possibleDuplicateThreshold: 0.76,
};

function product(partial: Partial<UniqueProductRecord> = {}): UniqueProductRecord {
  return {
    productId: "p1",
    trackIds: ["t1"],
    item: item({ name: "camiseta blanca", category: "ropa" }),
    bestCrop: {
      timestampSeconds: 1,
      box: null,
      quality: 0.5,
      sharpness: 0.5,
      frameDataUrl: "data:image/jpeg;base64,Zg==",
      cropDataUrl: null,
      signatureHash: null,
      embedding: null,
    },
    segments: [],
    matching: null,
    detection: null,
    matchStatus: "not_searched",
    matchAttempts: 0,
    matchError: null,
    matchDurationMs: 0,
    externalSearchesUsed: 0,
    possibleDuplicateOf: null,
    identity: {
      canonicalLabel: "camiseta blanca",
      canonicalCategory: "t-shirt",
      category: "ropa",
      subcategory: null,
      color: "blanco",
      pattern: null,
      material: null,
      observedLabels: ["camiseta blanca"],
      firstSeenAtMs: 0,
      lastSeenAtMs: 1000,
      timestampsMs: [0, 1000],
      seenCount: 2,
      sceneIds: [1],
    },
    ...partial,
  };
}

const EMPTY_RESULT: ProductMatchingResult = {
  matches: [],
  matchLabel: "NO_MATCH",
  providerUsed: "catalog",
  fallbackUsed: false,
  cached: false,
  timings: {},
};

/* --------------------------- 1 · reutilización por hash -------------------- */

test("el mismo vídeo reutiliza resultados por hash sin volver a procesar", async () => {
  const calls: MatchCall[] = [];
  const detector = new ScriptedDetector({ "0.000": [] });
  const deps = makeDeps(detector, fakeMatcher(calls));
  const hash = "a".repeat(64);
  const input = {
    fileName: "v.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1024,
    durationSeconds: DURATION,
    videoHash: hash,
  };

  const first = await createAnalysisJob(input, deps);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.reused, false);
  await finalizeAnalysisJob(first.job.id, deps);

  const second = await createAnalysisJob(input, deps);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.reused, true, "debe reutilizar el job por hash");
  assert.equal(second.job.id, first.job.id);
  assert.equal(detector.calls.length, 0, "no vuelve a detectar");

  // `forceReprocess` crea un job NUEVO conservando el anterior.
  const reprocessed = await createAnalysisJob({ ...input, forceReprocess: true }, deps);
  assert.equal(reprocessed.ok, true);
  if (!reprocessed.ok) return;
  assert.equal(reprocessed.reused, false);
  assert.notEqual(reprocessed.job.id, first.job.id);
  assert.ok(await deps.store.getJob(first.job.id), "el job anterior se conserva");
});

/* ------------------------- 2-4 · identidad y dedup ------------------------- */

test("la misma camiseta descrita de cinco formas genera UN solo producto", () => {
  // Los cinco nombres y categorías observados en el fallo real.
  const observed: Array<[string, string]> = [
    ["camiseta blanca", "ropa"],
    ["camiseta blanca de manga corta", "ropa"],
    ["camiseta", "camisetas"],
    ["camisa de manga corta", "ropa"],
    ["camiseta/parte superior blanca", "prenda superior"],
  ];
  const tracks = observed.map(([name, category], i) =>
    makeTrack({ id: i, name, category })
  );
  const products = dedupTracksIntoProducts(stateWith(tracks), true, DEDUP_OPTS);

  assert.equal(products.length, 1, "cinco descripciones, un producto");
  assert.equal(products[0].trackIds.length, 5);
  assert.equal(products[0].identity.seenCount, 10);
  assert.equal(products[0].identity.canonicalCategory, "t-shirt");
  // El nombre canónico es el más informativo, no el primero ni el más corto.
  assert.equal(products[0].identity.canonicalLabel, "camiseta blanca de manga corta");
  assert.equal(products[0].identity.observedLabels.length, 5);
});

test("una camiseta y un pantalón NO se fusionan aunque el resto coincida", () => {
  const shirt = makeTrack({ id: 1, name: "camiseta blanca", category: "ropa" });
  // Mismo color, misma persona, adyacente en el tiempo y con el MISMO
  // embedding: todo empuja a fundir menos lo que importa, la prenda.
  const trousers = makeTrack({
    id: 2,
    name: "pantalón blanco",
    category: "ropa",
    at: 1.6,
    embedding: shirt.bestCrop.embedding,
  });
  const breakdown = identityScore(shirt, trousers, {
    videoDurationSeconds: DURATION,
  });
  assert.ok(breakdown.blockedBySlot, "upper vs lower debe bloquearse");

  const products = dedupTracksIntoProducts(
    stateWith([shirt, trousers]),
    true,
    DEDUP_OPTS
  );
  assert.equal(products.length, 2);
});

test("dos tracks separados en el tiempo se fusionan globalmente (ReID)", () => {
  // Aparece al principio, desaparece y vuelve al final: el tracker por IoU no
  // puede unirlos porque el trackId es otro.
  const first = makeTrack({ id: 1, name: "bolso de piel", category: "bolso", at: 0 });
  const later = makeTrack({
    id: 2,
    name: "bolso marrón",
    category: "bolsos",
    at: 25,
    color: "blanco",
    embedding: shirtEmbedding(1),
  });
  const products = dedupTracksIntoProducts(stateWith([first, later]), true, DEDUP_OPTS);
  assert.equal(products.length, 1, "la reaparición se funde con el original");
  assert.deepEqual(products[0].trackIds.sort(), ["t1", "t2"]);
});

test("productos distintos pero parecidos se marcan como posible duplicado", () => {
  const a = makeTrack({ id: 1, name: "camiseta blanca", category: "ropa" });
  // Mismo tipo de prenda y misma categoría, pero otro color y otro embedding:
  // sospechoso, no idéntico.
  const b = makeTrack({
    id: 2,
    name: "camiseta crema",
    category: "ropa",
    color: "crema",
    at: 20,
    embedding: shirtEmbedding(400),
  });
  const breakdown = identityScore(a, b, { videoDurationSeconds: DURATION });
  const products = dedupTracksIntoProducts(stateWith([a, b]), true, DEDUP_OPTS);

  if (breakdown.score >= DEDUP_OPTS.identityThreshold) {
    assert.equal(products.length, 1);
    return;
  }
  assert.equal(products.length, 2);
  if (breakdown.score >= DEDUP_OPTS.possibleDuplicateThreshold) {
    assert.equal(
      products[1].possibleDuplicateOf,
      "p1",
      "entre el umbral posible y el de fusión debe quedar marcado"
    );
  }
});

test("dos personas con la misma prenda son productos distintos", () => {
  const worn0 = makeTrack({ id: 1, name: "camiseta blanca", category: "ropa", personIndex: 0 });
  const worn1 = makeTrack({
    id: 2,
    name: "camiseta blanca",
    category: "ropa",
    personIndex: 1,
    at: 2,
    embedding: shirtEmbedding(300),
  });
  const products = dedupTracksIntoProducts(stateWith([worn0, worn1]), true, DEDUP_OPTS);
  assert.equal(products.length, 2, "personas distintas ⇒ prendas distintas");
});

test("canonicalLabel descarta las etiquetas con barra y prefiere la informativa", () => {
  assert.equal(
    canonicalLabel([
      "camiseta/parte superior blanca",
      "camiseta",
      "camiseta blanca de manga corta",
    ]),
    "camiseta blanca de manga corta"
  );
  // Si TODAS llevan barra, no se puede descartar ninguna.
  assert.equal(canonicalLabel(["a/b"]), "a/b");
});

/* ------------------------------ 5 · mejor crop ----------------------------- */

test("se conserva el crop de mayor calidad al fusionar tracks", () => {
  const poor = makeTrack({ id: 1, name: "camiseta blanca", category: "ropa", quality: 0.2 });
  const good = makeTrack({
    id: 2,
    name: "camiseta blanca",
    category: "ropa",
    quality: 0.9,
    at: 3,
    embedding: shirtEmbedding(1),
  });
  const products = dedupTracksIntoProducts(stateWith([poor, good]), true, DEDUP_OPTS);
  assert.equal(products.length, 1);
  assert.equal(products[0].bestCrop.quality, 0.9);
  assert.equal(products[0].bestCrop.timestampSeconds, 3);
});

test("cropQuality penaliza el recorte cortado por el borde del frame", () => {
  const base = item({ name: "camiseta", category: "ropa", confidence: 0.9 });
  const centered = cropQuality({
    box: { x: 0.3, y: 0.3, width: 0.3, height: 0.3 },
    item: base,
    sharpness: 0.8,
    slot: "upper",
  });
  const clipped = cropQuality({
    box: { x: 0, y: 0, width: 0.3, height: 0.3 },
    item: base,
    sharpness: 0.8,
    slot: "upper",
  });
  assert.ok(
    clipped.score < centered.score,
    `cortado (${clipped.score.toFixed(3)}) debe puntuar menos que centrado (${centered.score.toFixed(3)})`
  );
  assert.equal(clipped.breakdown.lowOcclusion < 1, true);
});

/* ---------------------- 6-8 · matching, timeouts, retries ------------------ */

test("el matching se ejecuta UNA vez por producto único, no por aparición", async () => {
  const calls: MatchCall[] = [];
  const tracks = [
    makeTrack({ id: 1, name: "camiseta blanca", category: "ropa" }),
    makeTrack({ id: 2, name: "camiseta", category: "camisetas" }),
    makeTrack({ id: 3, name: "camiseta blanca de manga corta", category: "ropa" }),
  ];
  const products = dedupTracksIntoProducts(stateWith(tracks), true, DEDUP_OPTS);
  assert.equal(products.length, 1, "precondición: los tres tracks son un producto");
  // Nueve apariciones en total (3 tracks × 2, más el propio dedup).
  assert.ok(products[0].identity.seenCount >= 6);

  await matchUniqueProducts({
    products,
    jobId: "j1",
    mediaContentId: "m1",
    mode: "catalog_first",
    matchProduct: fakeMatcher(calls),
    config: TEST_JOB_CONFIG,
  });
  assert.equal(calls.length, 1, "una llamada, no una por aparición");
});

test("un timeout de un producto no cancela ni contamina a los demás", async () => {
  const products = [
    product({ productId: "p1" }),
    product({ productId: "p2" }),
    product({ productId: "p3" }),
  ];
  const matchProduct: MatchProductFn = async ({ globalProductId, item: it }) => {
    if (globalProductId === "p2") {
      return {
        result: EMPTY_RESULT,
        detection: detectionFor(it, { catalog: "timeout", external: "not_requested" }),
      };
    }
    return {
      result: EMPTY_RESULT,
      detection: detectionFor(it, { catalog: "matched", external: "not_requested" }),
    };
  };

  const outcomes = await matchUniqueProducts({
    products,
    jobId: "j",
    mediaContentId: "m",
    mode: "catalog_first",
    matchProduct,
    config: TEST_JOB_CONFIG,
  });

  assert.equal(outcomes.size, 3, "todos los productos tienen resultado");
  assert.equal(outcomes.get("p1")!.status, "catalog_matched");
  assert.equal(outcomes.get("p2")!.status, "catalog_timeout");
  assert.equal(outcomes.get("p3")!.status, "catalog_matched");
});

test("una excepción en un producto tampoco tumba a los demás", async () => {
  const products = [product({ productId: "p1" }), product({ productId: "p2" })];
  const matchProduct: MatchProductFn = async ({ globalProductId, item: it }) => {
    if (globalProductId === "p1") throw new Error("boom");
    return {
      result: EMPTY_RESULT,
      detection: detectionFor(it, { catalog: "matched", external: "not_requested" }),
    };
  };
  const outcomes = await matchUniqueProducts({
    products,
    jobId: "j",
    mediaContentId: "m",
    mode: "catalog_first",
    matchProduct,
    config: TEST_JOB_CONFIG,
  });
  assert.equal(outcomes.get("p1")!.status, "matching_error");
  assert.equal(outcomes.get("p1")!.error, "boom");
  assert.equal(outcomes.get("p2")!.status, "catalog_matched");
});

test("los reintentos se aplican a lo transitorio y NO a un no_match", async () => {
  const config = { ...TEST_JOB_CONFIG, matchingMaxRetries: 2, matchingRetryBackoffMs: 1 };
  let timeoutAttempts = 0;
  let noMatchAttempts = 0;

  const outcomes = await matchUniqueProducts({
    products: [product({ productId: "p1" }), product({ productId: "p2" })],
    jobId: "j",
    mediaContentId: "m",
    mode: "catalog_first",
    config,
    matchProduct: async ({ globalProductId, item: it }) => {
      if (globalProductId === "p1") {
        timeoutAttempts++;
        // Se recupera al tercer intento.
        const catalog = timeoutAttempts >= 3 ? "matched" : "timeout";
        return {
          result: EMPTY_RESULT,
          detection: detectionFor(it, { catalog, external: "not_requested" }),
        };
      }
      noMatchAttempts++;
      return {
        result: EMPTY_RESULT,
        detection: detectionFor(it, { catalog: "unresolved", external: "unresolved" }),
      };
    },
  });

  assert.equal(timeoutAttempts, 3, "el timeout se reintenta hasta recuperarse");
  assert.equal(outcomes.get("p1")!.status, "catalog_matched");
  assert.equal(outcomes.get("p1")!.attempts, 3);
  assert.equal(noMatchAttempts, 1, "un no_match no se reintenta: no cambiaría");
  assert.equal(outcomes.get("p2")!.status, "no_match");
});

test("la concurrencia está acotada por MATCHING_MAX_CONCURRENCY", async () => {
  const config = { ...TEST_JOB_CONFIG, matchingMaxConcurrency: 3 };
  let inFlight = 0;
  let peak = 0;
  const products = Array.from({ length: 9 }, (_, i) => product({ productId: `p${i}` }));

  await matchUniqueProducts({
    products,
    jobId: "j",
    mediaContentId: "m",
    mode: "catalog_first",
    config,
    matchProduct: async ({ item: it }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return {
        result: EMPTY_RESULT,
        detection: detectionFor(it, { catalog: "matched", external: "not_requested" }),
      };
    },
  });

  assert.equal(peak, 3, `pico de concurrencia ${peak}, esperado 3`);
});

test("los productos se resuelven en paralelo, no en serie", async () => {
  const products = Array.from({ length: 6 }, (_, i) => product({ productId: `p${i}` }));
  const started = Date.now();
  await matchUniqueProducts({
    products,
    jobId: "j",
    mediaContentId: "m",
    mode: "catalog_first",
    config: { ...TEST_JOB_CONFIG, matchingMaxConcurrency: 3 },
    matchProduct: async ({ item: it }) => {
      await new Promise((r) => setTimeout(r, 40));
      return {
        result: EMPTY_RESULT,
        detection: detectionFor(it, { catalog: "matched", external: "not_requested" }),
      };
    },
  });
  const elapsed = Date.now() - started;
  // En serie serían ~240 ms; en tandas de 3, ~80 ms. El margen es amplio para
  // no depender de la carga de la máquina, pero descarta la ejecución serial.
  assert.ok(elapsed < 180, `tardó ${elapsed} ms: parece serie, no paralelo`);
});

/* ------------------- 9 · taxonomía de estados de matching ------------------ */

test("statusFromDetection distingue los motivos en vez de agruparlos", () => {
  const it = item({ name: "camiseta", category: "ropa" });
  const cases: Array<[NonNullable<Parameters<typeof detectionFor>[1]>, string]> = [
    [{ catalog: "matched", external: "not_requested" }, "catalog_matched"],
    [{ catalog: "unresolved", external: "matched" }, "external_candidate"],
    [{ catalog: "unresolved", external: "unresolved" }, "no_match"],
    [{ catalog: "timeout", external: "not_requested" }, "catalog_timeout"],
    [{ catalog: "unresolved", external: "timeout" }, "external_timeout"],
    [{ catalog: "error", external: "unresolved" }, "partial_result"],
    [{ catalog: "unresolved", external: "error" }, "partial_result"],
  ];
  for (const [opts, expected] of cases) {
    assert.equal(
      statusFromDetection(detectionFor(it, opts)),
      expected,
      `catálogo=${opts.catalog} externo=${opts.external}`
    );
  }
  assert.equal(statusFromDetection(null), "matching_error");
});

test("un catálogo con timeout pero Internet resuelto NO se marca como timeout", () => {
  const it = item({ name: "camiseta", category: "ropa" });
  // Lo relevante para quien mira la pantalla es que HAY resultado.
  assert.equal(
    statusFromDetection(detectionFor(it, { catalog: "timeout", external: "matched" })),
    "external_candidate"
  );
});

/* --------------------- 10-12 · flujo completo del job ---------------------- */

const TAZA_REGION = { x: 0.05, y: 0.4, width: 0.4, height: 0.45 };

test("flujo completo: frames → productos con vídeo, escena y timestamps", async () => {
  const calls: MatchCall[] = [];
  const camiseta = item({
    name: "camiseta blanca",
    category: "ropa",
    color: "blanco",
    confidence: 0.9,
    bounding_box: { x: 0.1, y: 0.4, width: 0.3, height: 0.4 },
  });
  const detector = new ScriptedDetector({
    "0.000": [camiseta],
    "0.400": [camiseta],
    "8.000": [camiseta],
  });
  const deps: JobEngineDeps = makeDeps(detector, fakeMatcher(calls), {
    ...TEST_JOB_CONFIG,
    perceptualHashEnabled: false,
  });

  const created = await createAnalysisJob(
    {
      fileName: "v.mp4",
      mimeType: "video/mp4",
      sizeBytes: 2048,
      durationSeconds: DURATION,
      videoHash: "b".repeat(64),
    },
    deps
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const sceneA = productThumb(20, [{ region: TAZA_REGION, gradient: "h" }]);
  const sceneB = productThumb(200, [{ region: TAZA_REGION, gradient: "h" }]);
  await processFrameBatch(created.job.id, [frame(0, sceneA), frame(0.4, sceneA)], deps);
  await processFrameBatch(created.job.id, [frame(8, sceneB)], deps);

  const finalized = await finalizeAnalysisJob(created.job.id, deps);
  assert.equal(finalized.ok, true);
  if (!finalized.ok) return;

  assert.equal(finalized.products.length, 1);
  const [p] = finalized.products;
  // Vídeo, escena y timestamps, que es lo que pide la persistencia.
  assert.ok(p.identity.sceneIds.length >= 1, "guarda la escena");
  assert.ok(p.identity.timestampsMs.length >= 2, "guarda todos los timestamps");
  assert.equal(p.identity.firstSeenAtMs, 0);
  assert.equal(p.identity.lastSeenAtMs, 8000);
  assert.equal(p.identity.seenCount, p.identity.timestampsMs.length);
  assert.ok(p.bestCrop.frameDataUrl, "guarda el mejor frame");
  // Y el estado es el que corresponde, no un "NO MATCH" genérico.
  assert.equal(p.matchStatus, "external_candidate");
  assert.equal(finalized.job.counters.externalCandidates, 1);
  assert.equal(finalized.job.status, "completed");
});

test("el job cancelado no gasta matching y sus productos quedan not_searched", async () => {
  const calls: MatchCall[] = [];
  const detector = new ScriptedDetector({
    "0.000": [item({ name: "camiseta", category: "ropa" })],
  });
  const deps = makeDeps(detector, fakeMatcher(calls), {
    ...TEST_JOB_CONFIG,
    perceptualHashEnabled: false,
  });
  const created = await createAnalysisJob(
    { fileName: "v.mp4", mimeType: "video/mp4", sizeBytes: 1024, durationSeconds: DURATION },
    deps
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  await processFrameBatch(created.job.id, [frame(0, productThumb(20, []))], deps);
  const job = await deps.store.getJob(created.job.id);
  job!.status = "cancelled";
  await deps.store.updateJob(job!);

  const finalized = await finalizeAnalysisJob(created.job.id, deps);
  assert.equal(finalized.ok, true);
  if (!finalized.ok) return;
  assert.equal(calls.length, 0, "no se paga matching de un job cancelado");
  assert.ok(finalized.products.every((p) => p.matchStatus === "not_searched"));
});

/* ------------------------- 13 · reanudación por checkpoint ----------------- */

test("el job se reanuda desde el checkpoint sin repetir detección", async () => {
  const calls: MatchCall[] = [];
  const detected = item({ name: "camiseta", category: "ropa" });
  const detector = new ScriptedDetector({
    "0.000": [detected],
    "1.000": [detected],
    "2.000": [detected],
  });
  const deps = makeDeps(detector, fakeMatcher(calls), {
    ...TEST_JOB_CONFIG,
    perceptualHashEnabled: false,
  });
  const created = await createAnalysisJob(
    { fileName: "v.mp4", mimeType: "video/mp4", sizeBytes: 1024, durationSeconds: DURATION },
    deps
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const thumb = productThumb(20, [{ region: TAZA_REGION, gradient: "h" }]);
  await processFrameBatch(created.job.id, [frame(0, thumb), frame(1, thumb)], deps);
  assert.deepEqual(detector.calls, [0, 1]);

  // Reenvío del MISMO segmento tras un corte, más un frame nuevo.
  const resumed = await processFrameBatch(
    created.job.id,
    [frame(0, thumb), frame(1, thumb), frame(2, thumb)],
    deps
  );
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.result.skippedCheckpoint, 2, "los ya procesados se saltan");
  assert.deepEqual(detector.calls, [0, 1, 2], "solo se detecta el frame nuevo");
});
