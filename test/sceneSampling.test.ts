import assert from "node:assert/strict";
import { test } from "node:test";
import { decideFrameSampling, hasLocalChange } from "../lib/analysis/jobs/sceneSampling";
import { decodeThumb } from "../lib/analysis/jobs/perceptualHash";
import { paintThumb } from "./fixtures/analysisJobFixtures";

const CONFIG = {
  perceptualHashEnabled: true,
  minFramesPerScene: 2,
  maxFramesPerScene: 4,
  sampleIntervalMs: 1000,
  phashDedupThreshold: 5,
};

test("hash desactivado: siempre se conserva", () => {
  const d = decideFrameSampling({
    sceneChanged: false,
    hash: "aaaa",
    lastAnalyzedHash: "aaaa",
    sceneAnalyzedCount: 5,
    secondsSinceLastAnalyzed: 0,
    localChange: false,
    config: { ...CONFIG, perceptualHashEnabled: false },
  });
  assert.equal(d.keep, true);
  assert.equal(d.reason, "kept:hash_disabled");
});

test("cambio de escena: SIEMPRE se conserva, incluso con la escena llena", () => {
  const d = decideFrameSampling({
    sceneChanged: true,
    hash: "aaaa",
    lastAnalyzedHash: "aaaa",
    sceneAnalyzedCount: 99,
    secondsSinceLastAnalyzed: 0,
    localChange: false,
    config: CONFIG,
  });
  assert.equal(d.keep, true);
  assert.equal(d.reason, "kept:scene_first");
});

test("techo por escena: se descarta aunque haya cambio local, ANTES de mirar nada más", () => {
  const d = decideFrameSampling({
    sceneChanged: false,
    hash: "aaaa",
    lastAnalyzedHash: "ffff",
    sceneAnalyzedCount: CONFIG.maxFramesPerScene,
    secondsSinceLastAnalyzed: 10,
    localChange: true,
    config: CONFIG,
  });
  assert.equal(d.keep, false);
  assert.equal(d.reason, "discarded:max_frames_cap");
});

test("cambio visual GLOBAL (hamming alto): se conserva", () => {
  const d = decideFrameSampling({
    sceneChanged: false,
    // Hamming(0000,ffff) = 64 sobre el umbral de 5.
    hash: "0000000000000000",
    lastAnalyzedHash: "ffffffffffffffff",
    sceneAnalyzedCount: 1,
    secondsSinceLastAnalyzed: 0.1,
    localChange: false,
    config: CONFIG,
  });
  assert.equal(d.keep, true);
  assert.equal(d.reason, "kept:visual_change");
});

test("casi-duplicado GLOBAL pero cambio LOCAL (región de un track activo): se conserva", () => {
  const d = decideFrameSampling({
    sceneChanged: false,
    hash: "0000000000000000",
    lastAnalyzedHash: "0000000000000001", // hamming = 1, por debajo del umbral
    sceneAnalyzedCount: CONFIG.minFramesPerScene, // cupo ya cubierto
    secondsSinceLastAnalyzed: 0.1, // gap pequeño
    localChange: true,
    config: CONFIG,
  });
  assert.equal(d.keep, true);
  assert.equal(d.reason, "kept:local_change");
});

test("casi-duplicado, sin cambio local, por DEBAJO del mínimo de la escena: se conserva", () => {
  const d = decideFrameSampling({
    sceneChanged: false,
    hash: "0000000000000000",
    lastAnalyzedHash: "0000000000000001",
    sceneAnalyzedCount: 0,
    secondsSinceLastAnalyzed: 0.1,
    localChange: false,
    config: CONFIG,
  });
  assert.equal(d.keep, true);
  assert.equal(d.reason, "kept:min_frames_quota");
});

test("casi-duplicado, cupo cubierto, pero ha pasado el intervalo máximo: se conserva", () => {
  const d = decideFrameSampling({
    sceneChanged: false,
    hash: "0000000000000000",
    lastAnalyzedHash: "0000000000000001",
    sceneAnalyzedCount: CONFIG.minFramesPerScene,
    secondsSinceLastAnalyzed: CONFIG.sampleIntervalMs / 1000,
    localChange: false,
    config: CONFIG,
  });
  assert.equal(d.keep, true);
  assert.equal(d.reason, "kept:max_gap");
});

test("casi-duplicado, cupo cubierto, gap pequeño: se descarta", () => {
  const d = decideFrameSampling({
    sceneChanged: false,
    hash: "0000000000000000",
    lastAnalyzedHash: "0000000000000001",
    sceneAnalyzedCount: CONFIG.minFramesPerScene,
    secondsSinceLastAnalyzed: 0.1,
    localChange: false,
    config: CONFIG,
  });
  assert.equal(d.keep, false);
  assert.equal(d.reason, "discarded:near_duplicate");
});

// --------------------------- hasLocalChange ---------------------------------

const REGION = { x: 0.1, y: 0.1, width: 0.3, height: 0.3 };

test("hasLocalChange: mismo thumb, mismas cajas → sin cambio", () => {
  const thumb = decodeThumb(paintThumb(() => [50, 50, 50]))!;
  assert.equal(hasLocalChange(thumb, thumb, [REGION], 5), false);
});

test("hasLocalChange: cambio SOLO dentro de la caja del track → true", () => {
  const before = decodeThumb(paintThumb(() => [50, 50, 50]))!;
  const after = decodeThumb(
    paintThumb((x, y) => {
      const inBox = x >= 6 && x < 25 && y >= 3 && y < 14; // ~REGION en 64x36
      return inBox ? [220, 220, 220] : [50, 50, 50];
    })
  )!;
  assert.equal(hasLocalChange(after, before, [REGION], 5), true);
});

test("hasLocalChange: sin cajas activas → nunca hay señal local", () => {
  const before = decodeThumb(paintThumb(() => [50, 50, 50]))!;
  const after = decodeThumb(paintThumb(() => [220, 220, 220]))!;
  assert.equal(hasLocalChange(after, before, [null, undefined], 5), false);
});
