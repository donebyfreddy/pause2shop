import assert from "node:assert/strict";
import { test } from "node:test";
import {
  averageHash,
  decodeThumb,
  encodeThumb,
  hammingDistance,
  sharpnessScore,
  thumbDiff,
} from "../lib/analysis/jobs/perceptualHash";
import { paintThumb, productThumb } from "./fixtures/analysisJobFixtures";

function decoded(thumb: ReturnType<typeof paintThumb>) {
  const d = decodeThumb(thumb);
  assert.ok(d, "el thumb de fixture debe decodificar");
  return d!;
}

test("encode/decode de thumb es simétrico y valida tamaños", () => {
  const t = encodeThumb(2, 2, [0, 0, 0, 255, 255, 255, 10, 20, 30, 1, 2, 3]);
  const d = decodeThumb(t);
  assert.ok(d);
  assert.equal(d!.rgb.length, 12);
  // Payload que no casa con width*height*3 → null (payload corrupto).
  assert.equal(decodeThumb({ width: 3, height: 3, rgbBase64: t.rgbBase64 }), null);
  assert.equal(decodeThumb({ width: 0, height: 2, rgbBase64: t.rgbBase64 }), null);
});

test("thumbDiff: idénticos ⇒ 0, fondo distinto ⇒ diff de escena alto", () => {
  const a = decoded(productThumb(20, []));
  const b = decoded(productThumb(20, []));
  const c = decoded(productThumb(220, []));
  assert.equal(thumbDiff(a, b), 0);
  assert.ok(thumbDiff(a, c) > 0.5);
});

test("averageHash es estable y distingue firmas distintas", () => {
  const region = { x: 0.1, y: 0.1, width: 0.4, height: 0.5 };
  const gradH1 = decoded(productThumb(20, [{ region, gradient: "h" }]));
  const gradH2 = decoded(productThumb(200, [{ region, gradient: "h" }]));
  const gradV = decoded(productThumb(20, [{ region, gradient: "v" }]));

  // La firma de la REGIÓN no cambia aunque cambie el fondo (escena nueva).
  const sigA = averageHash(gradH1, region);
  const sigB = averageHash(gradH2, region);
  assert.ok(
    hammingDistance(sigA, sigB) <= 4,
    `la firma debe sobrevivir al cambio de fondo (hamming=${hammingDistance(sigA, sigB)})`
  );
  // Gradiente perpendicular ⇒ firma claramente distinta.
  const sigC = averageHash(gradV, region);
  assert.ok(
    hammingDistance(sigA, sigC) > 12,
    `firmas de objetos distintos deben divergir (hamming=${hammingDistance(sigA, sigC)})`
  );
});

test("hammingDistance: 0 para iguales, 64 para longitudes distintas", () => {
  assert.equal(hammingDistance("ffff", "ffff"), 0);
  assert.equal(hammingDistance("0", "f"), 4);
  assert.equal(hammingDistance("ab", "abc"), 64);
});

test("sharpnessScore: región con gradiente puntúa más que una plana", () => {
  const region = { x: 0.1, y: 0.1, width: 0.4, height: 0.5 };
  const sharp = decoded(
    paintThumb((x) => {
      const v = x % 2 === 0 ? 0 : 255; // alta frecuencia = muy nítido
      return [v, v, v];
    })
  );
  const flat = decoded(productThumb(128, []));
  assert.ok(sharpnessScore(sharp, region) > sharpnessScore(flat, region));
  assert.equal(sharpnessScore(flat, region), 0);
});
