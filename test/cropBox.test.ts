import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampNormalizedBox,
  cropIsSearchable,
  cropScale,
  paddedCropRect,
} from "../lib/cropBox";

test("clampNormalizedBox deja intacta una box válida", () => {
  const b = clampNormalizedBox({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 });
  assert.deepEqual(b, { x: 0.2, y: 0.3, width: 0.4, height: 0.2 });
});

test("clampNormalizedBox clampa una box que se sale por la derecha/abajo", () => {
  const b = clampNormalizedBox({ x: 0.8, y: 0.9, width: 0.5, height: 0.5 });
  assert.equal(b.x, 0.8);
  assert.ok(Math.abs(b.width - 0.2) < 1e-9);
  assert.ok(Math.abs(b.height - 0.1) < 1e-9);
});

test("clampNormalizedBox clampa coordenadas negativas a 0", () => {
  const b = clampNormalizedBox({ x: -0.1, y: -0.2, width: 0.3, height: 0.3 });
  assert.equal(b.x, 0);
  assert.equal(b.y, 0);
});

const W = 1280;
const H = 720;

test("paddedCropRect aplica el padding porcentual alrededor de la box", () => {
  const r = paddedCropRect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, W, H, 10);
  // x = 0.4 - 0.02 = 0.38; w = 0.2 + 0.04 = 0.24 (padding sobre el tamaño de la box)
  assert.ok(Math.abs(r.sx - 0.38 * W) < 1e-6);
  assert.ok(Math.abs(r.sw - 0.24 * W) < 1e-6);
  assert.ok(Math.abs(r.sy - 0.38 * H) < 1e-6);
  assert.ok(Math.abs(r.sh - 0.24 * H) < 1e-6);
});

test("paddedCropRect no se sale de la imagen con boxes en el borde", () => {
  const r = paddedCropRect({ x: 0, y: 0, width: 0.1, height: 0.1 }, W, H, 12);
  assert.ok(r.sx >= 0);
  assert.ok(r.sy >= 0);
  assert.ok(r.sx + r.sw <= W + 1e-6);
  assert.ok(r.sy + r.sh <= H + 1e-6);
});

test("paddedCropRect no se sale con box fuera de límites + padding", () => {
  const r = paddedCropRect({ x: 0.9, y: 0.9, width: 0.4, height: 0.4 }, W, H, 10);
  assert.ok(r.sx + r.sw <= W + 1e-6);
  assert.ok(r.sy + r.sh <= H + 1e-6);
  assert.ok(r.sw > 0);
  assert.ok(r.sh > 0);
});

test("paddedCropRect con padding 0 devuelve exactamente la box", () => {
  const r = paddedCropRect({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 800, 600, 0);
  assert.ok(Math.abs(r.sx - 200) < 1e-6);
  assert.ok(Math.abs(r.sy - 150) < 1e-6);
  assert.ok(Math.abs(r.sw - 400) < 1e-6);
  assert.ok(Math.abs(r.sh - 300) < 1e-6);
});

test("cropScale reduce crops grandes al lado máximo", () => {
  assert.equal(cropScale({ sx: 0, sy: 0, sw: 1280, sh: 720 }, 640), 0.5);
});

test("cropScale nunca amplía crops pequeños", () => {
  assert.equal(cropScale({ sx: 0, sy: 0, sw: 100, sh: 80 }, 640), 1);
});

test("cropIsSearchable rechaza crops con lado pequeño", () => {
  assert.equal(cropIsSearchable({ sx: 0, sy: 0, sw: 40, sh: 600 }, 48, 18000), false);
});

test("cropIsSearchable rechaza crops con área insuficiente", () => {
  // 100×100 = 10.000 px² < 18.000 aunque los lados superen el mínimo.
  assert.equal(cropIsSearchable({ sx: 0, sy: 0, sw: 100, sh: 100 }, 48, 18000), false);
});

test("cropIsSearchable acepta crops con señal suficiente", () => {
  assert.equal(cropIsSearchable({ sx: 0, sy: 0, sw: 200, sh: 150 }, 48, 18000), true);
});
