import assert from "node:assert/strict";
import { test } from "node:test";
import {
  iou,
  isOversizedBox,
  isValidBox,
  mapNormalizedBoxToRenderedVideo,
  suppressDuplicateBoxes,
} from "../lib/video/boxMapping";
import type { DetectedItem } from "../lib/types";

// --- mapping con object-fit ----------------------------------------------------

test("contain: vídeo 16:9 en elemento 16:9 → sin letterbox, mapeo directo", () => {
  const r = mapNormalizedBoxToRenderedVideo(
    { x: 0.25, y: 0.5, width: 0.5, height: 0.25 },
    1920, 1080, 640, 360, "contain"
  );
  assert.equal(r.x, 160);
  assert.equal(r.y, 180);
  assert.equal(r.width, 320);
  assert.equal(r.height, 90);
});

test("contain: vídeo vertical 9:16 en elemento 16:9 → barras laterales", () => {
  // Elemento 640×360; vídeo 1080×1920 escala a 202.5×360, offsetX = (640-202.5)/2.
  const r = mapNormalizedBoxToRenderedVideo(
    { x: 0, y: 0, width: 1, height: 1 },
    1080, 1920, 640, 360, "contain"
  );
  assert.ok(Math.abs(r.x - (640 - 202.5) / 2) < 0.01);
  assert.equal(r.y, 0);
  assert.ok(Math.abs(r.width - 202.5) < 0.01);
  assert.equal(r.height, 360);
});

test("contain: vídeo 4:3 en elemento 16:9 → barras laterales y caja centrada", () => {
  // Vídeo 1440×1080 en 640×360: escala 1/3 → 480×360, offsetX 80.
  const r = mapNormalizedBoxToRenderedVideo(
    { x: 0.5, y: 0, width: 0.5, height: 1 },
    1440, 1080, 640, 360, "contain"
  );
  assert.ok(Math.abs(r.x - (80 + 240)) < 0.01);
  assert.ok(Math.abs(r.width - 240) < 0.01);
});

test("cover: vídeo 4:3 en elemento 16:9 → recorte vertical (offset negativo)", () => {
  // cover escala por ancho: 1440→640 (×4/9), alto 1080×4/9=480 > 360 → offsetY negativo.
  const r = mapNormalizedBoxToRenderedVideo(
    { x: 0, y: 0, width: 1, height: 1 },
    1440, 1080, 640, 360, "cover"
  );
  assert.equal(r.x, 0);
  assert.ok(r.y < 0);
  assert.equal(r.width, 640);
  assert.ok(Math.abs(r.height - 480) < 0.01);
});

test("dimensiones inválidas → rect vacío (no NaN)", () => {
  const r = mapNormalizedBoxToRenderedVideo(
    { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    0, 0, 640, 360, "contain"
  );
  assert.deepEqual(r, { x: 0, y: 0, width: 0, height: 0 });
});

// --- validación ------------------------------------------------------------------

test("isValidBox acepta boxes en rango y rechaza degeneradas", () => {
  assert.equal(isValidBox({ x: 0.1, y: 0.1, width: 0.3, height: 0.3 }), true);
  assert.equal(isValidBox({ x: 0.9, y: 0.1, width: 0.3, height: 0.3 }), false); // se sale
  assert.equal(isValidBox({ x: 0.1, y: 0.1, width: 0, height: 0.3 }), false); // sin área
  assert.equal(isValidBox(null), false);
});

test("isOversizedBox marca cajas que cubren casi toda la escena", () => {
  assert.equal(isOversizedBox({ x: 0.02, y: 0.02, width: 0.95, height: 0.95 }), true);
  assert.equal(isOversizedBox({ x: 0.3, y: 0.2, width: 0.3, height: 0.45 }), false);
});

// --- IoU + NMS --------------------------------------------------------------------

test("iou: solape parcial y disjuntas", () => {
  const a = { x: 0, y: 0, width: 0.5, height: 0.5 };
  assert.ok(Math.abs(iou(a, { x: 0.25, y: 0, width: 0.5, height: 0.5 }) - 1 / 3) < 1e-9);
  assert.equal(iou(a, { x: 0.6, y: 0.6, width: 0.2, height: 0.2 }), 0);
});

function det(partial: Partial<DetectedItem>): DetectedItem {
  return {
    name: "objeto",
    category: "camisa",
    description: "",
    search_query_es: "",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.8,
    ...partial,
  };
}

test("NMS: dos detecciones de la misma camisa muy solapadas → sobrevive la de mayor confianza", () => {
  const strong = det({ name: "camisa negra", confidence: 0.95, bounding_box: { x: 0.3, y: 0.2, width: 0.3, height: 0.4 } });
  const dup = det({ name: "camisa oscura", confidence: 0.6, bounding_box: { x: 0.31, y: 0.21, width: 0.3, height: 0.4 } });
  const out = suppressDuplicateBoxes([dup, strong]);
  assert.equal(out.length, 1);
  assert.equal(out[0].confidence, 0.95);
});

test("NMS: categorías distintas no se suprimen aunque solapen", () => {
  const shirt = det({ category: "camisa", bounding_box: { x: 0.3, y: 0.2, width: 0.3, height: 0.4 } });
  const watch = det({ category: "reloj", bounding_box: { x: 0.32, y: 0.22, width: 0.28, height: 0.38 } });
  assert.equal(suppressDuplicateBoxes([shirt, watch]).length, 2);
});

test("NMS: items sin box se conservan siempre", () => {
  const noBox = det({ bounding_box: null });
  assert.equal(suppressDuplicateBoxes([noBox]).length, 1);
});
