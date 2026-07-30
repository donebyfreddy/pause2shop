import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachCrops,
  buildSegments,
  cancelAnalysisJob,
  createAnalysisJob,
  finalizeAnalysisJob,
  getJobStatusView,
  processFrameBatch,
} from "../lib/analysis/jobs/engine";
import type { JobEngineDeps } from "../lib/analysis/jobs/engine";
import {
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
 * E2E del motor de jobs SIN red ni OpenAI: detector con guion + matcher falso
 * + store en memoria. Cubre: frames→escenas→tracks→dedup global→productos
 * únicos→matching (≤1 búsqueda externa por producto)→timeline y contadores.
 */

const JOB_INPUT = {
  fileName: "demo.mp4",
  mimeType: "video/mp4",
  sizeBytes: 5 * 1024 * 1024,
  durationSeconds: 30,
};

// Regiones de los "productos" pintados en los thumbs sintéticos.
const TAZA_REGION = { x: 0.05, y: 0.4, width: 0.4, height: 0.45 };
const LAPTOP_REGION = { x: 0.55, y: 0.1, width: 0.35, height: 0.5 };

const tazaSmall = item({
  name: "taza roja grande",
  category: "taza",
  color: "rojo",
  confidence: 0.6,
  bounding_box: { x: 0.1, y: 0.5, width: 0.2, height: 0.2 },
});
const tazaBig = item({
  name: "taza roja grande",
  category: "taza",
  color: "rojo",
  confidence: 0.9,
  bounding_box: { x: 0.08, y: 0.48, width: 0.3, height: 0.3 },
});
// Reaparición con OTRO nombre corto: la fusión debe venir de la FIRMA
// perceptual del crop, no del tracker ni del nombre.
const tazaBack = item({
  name: "taza roja",
  category: "taza",
  color: "rojo",
  confidence: 0.7,
  bounding_box: { x: 0.1, y: 0.5, width: 0.2, height: 0.2 },
});
const laptop = item({
  name: "portátil negro",
  category: "laptop",
  color: "negro",
  confidence: 0.85,
  bounding_box: { x: 0.6, y: 0.15, width: 0.25, height: 0.35 },
});

/** Escena A: fondo oscuro con taza (gradiente h) y portátil (gradiente v). */
const sceneA = productThumb(20, [
  { region: TAZA_REGION, gradient: "h" },
  { region: LAPTOP_REGION, gradient: "v" },
]);
/** Escena vacía: mismo fondo, sin productos. */
const sceneEmpty = productThumb(20, []);
/** Escena B: fondo claro, SOLO la taza reaparece (misma firma de región). */
const sceneB = productThumb(200, [{ region: TAZA_REGION, gradient: "h" }]);

function e2eDeps(calls: MatchCall[]) {
  const detector = new ScriptedDetector({
    "0.000": [tazaSmall, laptop],
    "0.400": [tazaBig, laptop],
    "4.000": [],
    "8.000": [tazaBack],
    "8.400": [tazaBack],
  });
  // Hash de casi-duplicados desactivado en el E2E: aquí interesan escenas,
  // tracking y dedup global (el descarte por hash tiene su test dedicado).
  return {
    detector,
    deps: makeDeps(detector, fakeMatcher(calls), {
      ...TEST_JOB_CONFIG,
      perceptualHashEnabled: false,
    }),
  };
}

async function runE2E(calls: MatchCall[], deps: JobEngineDeps) {
  const created = await createAnalysisJob(JOB_INPUT, deps);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("unreachable");
  const jobId = created.job.id;

  const batch1 = await processFrameBatch(
    jobId,
    [frame(0, sceneA), frame(0.4, sceneA), frame(4, sceneEmpty)],
    deps
  );
  assert.equal(batch1.ok, true);
  const batch2 = await processFrameBatch(
    jobId,
    [frame(8, sceneB), frame(8.4, sceneB)],
    deps
  );
  assert.equal(batch2.ok, true);
  return { jobId, batch1: batch1.ok ? batch1.result : null!, batch2: batch2.ok ? batch2.result : null! };
}

test("E2E: frames → escenas → tracks → dedup global → productos → timeline", async () => {
  const calls: MatchCall[] = [];
  const { detector, deps } = e2eDeps(calls);
  const { jobId, batch1 } = await runE2E(calls, deps);

  // Detección solo en frames seleccionados (todos aquí: hash off).
  assert.deepEqual(detector.calls, [0, 0.4, 4, 8, 8.4]);
  // Overlay en vivo: el lote devuelve las detecciones con trackId.
  assert.equal(batch1.frames[0].items.length, 2);
  assert.ok(batch1.frames[0].items.every((it) => it.trackId));

  const finalized = await finalizeAnalysisJob(jobId, deps);
  assert.equal(finalized.ok, true);
  if (!finalized.ok) return;
  const { job, products } = finalized;

  // Escenas: A (productos) → vacía → B (fondo nuevo con reaparición).
  assert.equal(job.counters.scenes, 3);
  // 3 tracks (taza, portátil, taza reaparecida) → 2 productos únicos.
  assert.equal(job.counters.tracks, 3);
  assert.equal(products.length, 2);
  assert.equal(job.counters.uniqueProducts, 2);
  assert.equal(job.counters.dedupMergedTracks, 1);

  const taza = products.find((p) => p.item.category === "taza")!;
  const portatil = products.find((p) => p.item.category === "laptop")!;
  assert.ok(taza && portatil);
  // El objeto que desaparece y reaparece con otro trackId queda FUNDIDO.
  assert.equal(taza.trackIds.length, 2);

  // Matching: UNA llamada por producto único, ≤1 búsqueda externa cada uno.
  assert.equal(calls.length, 2);
  assert.equal(taza.externalSearchesUsed, 1);
  assert.equal(portatil.externalSearchesUsed, 1);
  assert.equal(job.counters.externalSearchesUsed, 2);
  assert.equal(taza.matching?.matchLabel, "EXTERNAL_MATCH");

  // Mejor crop de la taza: el encuadre grande y confiado de t=0.4.
  assert.equal(taza.bestCrop.timestampSeconds, 0.4);
  // El matcher recibió el mejor frame como contexto.
  const tazaCall = calls.find((c) => c.itemName === "taza roja grande")!;
  assert.ok(tazaCall.frameDataUrl?.startsWith("data:image/"));

  // Timeline: la taza aparece en dos tramos (0–0.4 y 8–8.4); el portátil en uno.
  assert.deepEqual(taza.segments, [
    { startSeconds: 0, endSeconds: 0.4 },
    { startSeconds: 8, endSeconds: 8.4 },
  ]);
  assert.deepEqual(portatil.segments, [{ startSeconds: 0, endSeconds: 0.4 }]);

  assert.equal(job.status, "completed");
  assert.ok(job.finishedAt);

  // Vista de estado completa para la UI.
  const view = await getJobStatusView(jobId, { store: deps.store });
  assert.equal(view?.products.length, 2);
  assert.equal(view?.scenes.length, 3);
  assert.equal(view?.tracks.length, 3);
});

test("finalize es idempotente: no repite matching ni duplica productos", async () => {
  const calls: MatchCall[] = [];
  const { deps } = e2eDeps(calls);
  const { jobId } = await runE2E(calls, deps);

  const first = await finalizeAnalysisJob(jobId, deps);
  assert.equal(first.ok, true);
  const callsAfterFirst = calls.length;
  const second = await finalizeAnalysisJob(jobId, deps);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(calls.length, callsAfterFirst);
  assert.equal(second.products.length, 2);
});

test("frames casi idénticos se descartan por hash perceptual (y la escena nueva no)", async () => {
  const calls: MatchCall[] = [];
  const detector = new ScriptedDetector({
    "0.000": [tazaSmall],
    "0.600": [],
  });
  const deps = makeDeps(detector, fakeMatcher(calls)); // hash ON (config test)
  const created = await createAnalysisJob(JOB_INPUT, deps);
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const res = await processFrameBatch(
    created.job.id,
    [
      frame(0, sceneA),
      frame(0.2, sceneA), // idéntico ⇒ descartado sin pagar detección
      frame(0.4, sceneA), // idéntico ⇒ descartado
      frame(0.6, sceneB), // cambio de escena ⇒ SIEMPRE se analiza
    ],
    deps
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.result.analyzed, 2);
  assert.equal(res.result.skippedSimilar, 2);
  assert.deepEqual(detector.calls, [0, 0.6]);

  const job = await deps.store.getJob(created.job.id);
  assert.equal(job?.counters.framesSkippedSimilar, 2);
  assert.equal(job?.counters.framesAnalyzed, 2);
});

test("checkpoint: reenviar un segmento ya procesado no repite trabajo (reanudación)", async () => {
  const calls: MatchCall[] = [];
  const detector = new ScriptedDetector({
    "0.000": [tazaSmall],
    "0.200": [tazaBig],
    "0.400": [tazaBig],
  });
  const deps = makeDeps(detector, fakeMatcher(calls), {
    ...TEST_JOB_CONFIG,
    perceptualHashEnabled: false,
  });
  const created = await createAnalysisJob(JOB_INPUT, deps);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const jobId = created.job.id;

  const b1 = await processFrameBatch(jobId, [frame(0, sceneA), frame(0.2, sceneA)], deps);
  assert.equal(b1.ok, true);
  if (!b1.ok) return;
  assert.equal(b1.result.checkpoint.processedUpToSeconds, 0.2);

  // "Corte" del cliente: reenvía el mismo segmento entero + un frame nuevo.
  const b2 = await processFrameBatch(
    jobId,
    [frame(0, sceneA), frame(0.2, sceneA), frame(0.4, sceneA)],
    deps
  );
  assert.equal(b2.ok, true);
  if (!b2.ok) return;
  assert.equal(b2.result.skippedCheckpoint, 2);
  assert.equal(b2.result.analyzed, 1);
  assert.deepEqual(detector.calls, [0, 0.2, 0.4]); // sin repeticiones

  const job = await deps.store.getJob(jobId);
  assert.equal(job?.counters.framesSkippedCheckpoint, 2);
  assert.equal(job?.counters.framesAnalyzed, 3);
});

test("el mejor crop solo cambia si mejora más que el umbral, y acepta el crop real del cliente", async () => {
  const calls: MatchCall[] = [];
  const { deps } = e2eDeps(calls);
  const { jobId, batch1 } = await runE2E(calls, deps);

  // El lote pidió el crop del mejor encuadre de la taza (t=0.4).
  const tazaRequests = batch1.cropRequests.filter((r) =>
    r.box.width === 0.3 || r.box.width === 0.2
  );
  assert.ok(tazaRequests.length >= 1);

  const state = await deps.store.getRuntimeState(jobId);
  const tazaTrack = Object.values(state!.tracks).find(
    (t) => t.category === "taza" && t.firstSeenSeconds === 0
  )!;
  assert.equal(tazaTrack.bestCrop.timestampSeconds, 0.4);

  // El cliente sube el crop real del mejor momento…
  const attach = await attachCrops(
    jobId,
    [
      // crop de un momento que YA no es el mejor ⇒ ignorado
      { trackId: tazaTrack.trackId, timestampSeconds: 0, dataUrl: "data:image/jpeg;base64,QUJD" },
      { trackId: tazaTrack.trackId, timestampSeconds: 0.4, dataUrl: "data:image/jpeg;base64,QkVTVA==" },
    ],
    deps
  );
  assert.equal(attach.ok, true);
  if (!attach.ok) return;
  assert.equal(attach.attached, 1);

  // …y el matching del producto único lo usa.
  const finalized = await finalizeAnalysisJob(jobId, deps);
  assert.equal(finalized.ok, true);
  const tazaCall = calls.find((c) => c.itemName === "taza roja grande");
  assert.equal(tazaCall?.cropDataUrl, "data:image/jpeg;base64,QkVTVA==");
});

test("cancel: el job deja de aceptar frames y el matching se omite", async () => {
  const calls: MatchCall[] = [];
  const { deps } = e2eDeps(calls);
  const created = await createAnalysisJob(JOB_INPUT, deps);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const jobId = created.job.id;

  await processFrameBatch(jobId, [frame(0, sceneA)], deps);
  const cancelled = await cancelAnalysisJob(jobId, deps);
  assert.equal(cancelled.ok, true);
  if (cancelled.ok) assert.equal(cancelled.job.status, "cancelled");

  const rejected = await processFrameBatch(jobId, [frame(0.4, sceneA)], deps);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.status, 409);

  const finalized = await finalizeAnalysisJob(jobId, deps);
  assert.equal(finalized.ok, true);
  if (!finalized.ok) return;
  assert.equal(finalized.job.status, "cancelled");
  assert.equal(calls.length, 0); // ninguna búsqueda cara tras cancelar
  assert.ok(
    finalized.products.every((p) => p.matchingSkippedReason === "job_cancelled")
  );
});

test("MAX_EXTERNAL_SEARCHES_PER_PRODUCT=0 fuerza catalog-only en el matching", async () => {
  const calls: MatchCall[] = [];
  const detector = new ScriptedDetector({ "0.000": [tazaSmall] });
  const deps = makeDeps(detector, fakeMatcher(calls), {
    ...TEST_JOB_CONFIG,
    perceptualHashEnabled: false,
    maxExternalSearchesPerProduct: 0,
  });
  const created = await createAnalysisJob(
    { ...JOB_INPUT, matchingMode: "hybrid" },
    deps
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await processFrameBatch(created.job.id, [frame(0, sceneA)], deps);
  const finalized = await finalizeAnalysisJob(created.job.id, deps);
  assert.equal(finalized.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "catalog-only");
});

test("un fallo de matching deja el job en partially_completed sin perder el resto", async () => {
  const calls: MatchCall[] = [];
  let first = true;
  const detector = new ScriptedDetector({ "0.000": [tazaSmall, laptop] });
  const deps = makeDeps(
    detector,
    async (args) => {
      if (first) {
        first = false;
        throw new Error("proveedor caído");
      }
      return fakeMatcher(calls)(args);
    },
    { ...TEST_JOB_CONFIG, perceptualHashEnabled: false }
  );
  const created = await createAnalysisJob(JOB_INPUT, deps);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  await processFrameBatch(created.job.id, [frame(0, sceneA)], deps);
  const finalized = await finalizeAnalysisJob(created.job.id, deps);
  assert.equal(finalized.ok, true);
  if (!finalized.ok) return;
  assert.equal(finalized.job.status, "partially_completed");
  const failed = finalized.products.filter((p) => p.matchingSkippedReason);
  const okOnes = finalized.products.filter((p) => p.matching);
  assert.equal(failed.length, 1);
  assert.equal(okOnes.length, 1);
});

test("buildSegments funde timestamps cercanos y separa huecos grandes", () => {
  assert.deepEqual(buildSegments([0, 0.4, 0.8, 5, 5.2]), [
    { startSeconds: 0, endSeconds: 0.8 },
    { startSeconds: 5, endSeconds: 5.2 },
  ]);
  assert.deepEqual(buildSegments([]), []);
});
