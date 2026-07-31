import { test } from "node:test";
import assert from "node:assert/strict";
import { readByDotPath, resolveFallback } from "../lib/messagesFallback";

const sample = {
  common: { close: "Cerrar" },
  studio: { product: { brand: "Marca: {brand}" } },
};

test("readByDotPath: resuelve rutas anidadas", () => {
  assert.equal(readByDotPath(sample, "common.close"), "Cerrar");
  assert.equal(readByDotPath(sample, "studio.product.brand"), "Marca: {brand}");
});

test("readByDotPath: undefined si el camino no existe", () => {
  assert.equal(readByDotPath(sample, "common.doesNotExist"), undefined);
  assert.equal(readByDotPath(sample, "nope.nope"), undefined);
});

test("resolveFallback: devuelve el string en español para una clave existente", () => {
  assert.equal(resolveFallback(sample, "common.close"), "Cerrar");
});

test("resolveFallback: si falta incluso en español, devuelve la propia key (no rompe el render)", () => {
  assert.equal(resolveFallback(sample, "totally.missing.key"), "totally.missing.key");
});
