import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeTrackCount,
  associateDetections,
  createTrackerState,
  cropQualityScore,
} from "../lib/video/tracker";
import type { DetectedItem } from "../lib/types";

function det(partial: Partial<DetectedItem>): DetectedItem {
  return {
    name: "camisa hawaiana negra",
    category: "camisa",
    description: "",
    search_query_es: "",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.9,
    bounding_box: { x: 0.3, y: 0.2, width: 0.3, height: 0.45 },
    ...partial,
  };
}

test("la misma camisa conserva el mismo trackId entre pasadas", () => {
  const state = createTrackerState();
  const [a] = associateDetections(state, [det({})], 1000);
  // Segunda pasada: la caja se ha movido un poco (IoU alto).
  const [b] = associateDetections(
    state,
    [det({ bounding_box: { x: 0.32, y: 0.21, width: 0.3, height: 0.45 } })],
    2000
  );
  assert.equal(a.trackId, b.trackId);
  const track = state.tracks.get(a.trackId)!;
  assert.equal(track.seenFrameCount, 2);
  assert.equal(activeTrackCount(state), 1);
});

test("dos objetos distintos de la misma categoría → dos tracks", () => {
  const state = createTrackerState();
  const out = associateDetections(
    state,
    [
      det({ name: "taza blanca", category: "taza", bounding_box: { x: 0.1, y: 0.7, width: 0.08, height: 0.1 } }),
      det({ name: "taza negra", category: "taza", bounding_box: { x: 0.6, y: 0.7, width: 0.08, height: 0.1 } }),
    ],
    1000
  );
  assert.notEqual(out[0].trackId, out[1].trackId);
  assert.equal(activeTrackCount(state), 2);
});

test("mismo nombre corto asocia aunque la caja haya saltado (corte de plano)", () => {
  const state = createTrackerState();
  const [a] = associateDetections(state, [det({})], 1000);
  const [b] = associateDetections(
    state,
    [det({ bounding_box: { x: 0.05, y: 0.05, width: 0.25, height: 0.4 } })],
    2000
  );
  assert.equal(a.trackId, b.trackId);
});

test("un track sin reaparecer se marca lost y deja de contar como activo", () => {
  const state = createTrackerState();
  associateDetections(state, [det({})], 1000);
  // 10s después aparece otro objeto: el primero se da por perdido.
  associateDetections(
    state,
    [det({ name: "reloj plateado", category: "reloj", bounding_box: { x: 0.6, y: 0.5, width: 0.08, height: 0.06 } })],
    11_000
  );
  assert.equal(activeTrackCount(state), 1);
});

test("bestBoundingBox conserva el mejor encuadre visto (área×confianza)", () => {
  const state = createTrackerState();
  const small = { x: 0.4, y: 0.3, width: 0.1, height: 0.15 };
  const big = { x: 0.3, y: 0.2, width: 0.35, height: 0.5 };
  const [a] = associateDetections(state, [det({ bounding_box: small })], 1000);
  associateDetections(state, [det({ bounding_box: big })], 2000);
  // Tercera pasada peor: no debe degradar el mejor crop.
  associateDetections(state, [det({ bounding_box: small, confidence: 0.6 })], 3000);
  const track = state.tracks.get(a.trackId)!;
  assert.deepEqual(track.bestBoundingBox, big);
});

test("cropQualityScore crece con área y confianza y va acotado a 0-1", () => {
  const smallQ = cropQualityScore({ x: 0, y: 0, width: 0.1, height: 0.1 }, 0.9);
  const bigQ = cropQualityScore({ x: 0, y: 0, width: 0.5, height: 0.5 }, 0.9);
  assert.ok(bigQ > smallQ);
  assert.ok(bigQ <= 1);
  assert.equal(cropQualityScore(null, 0.9), 0);
});
