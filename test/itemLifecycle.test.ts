import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ITEM_LIFECYCLE,
  isValidatedCatalogProduct,
  type ItemStatus,
} from "../lib/catalog/types";

/**
 * Ciclo de vida de un elemento detectado.
 *
 * Lo que se prueba es la distinción que antes no existía: guardar una DETECCIÓN
 * no es tener un producto del catálogo, y un resultado de Internet guardado
 * como candidato no es un producto validado. Con el único estado `matched` para
 * los tres casos, la UI contaba detecciones visuales como productos del
 * catálogo y un candidato sin revisar era indistinguible de uno aprobado.
 */

test("el ciclo de vida está en orden de avance y sin estados legados", () => {
  assert.deepEqual(ITEM_LIFECYCLE, [
    "detected",
    "catalog_matched",
    "external_candidate",
    "review_required",
    "approved",
    "published",
  ]);
  assert.ok(!ITEM_LIFECYCLE.includes("matched" as ItemStatus));
  assert.ok(!ITEM_LIFECYCLE.includes("reviewed" as ItemStatus));
});

test("una detección guardada NO es un producto del catálogo validado", () => {
  assert.equal(isValidatedCatalogProduct("detected"), false);
});

test("un candidato externo NO es un producto validado hasta que se revisa", () => {
  assert.equal(isValidatedCatalogProduct("external_candidate"), false);
  assert.equal(isValidatedCatalogProduct("review_required"), false);
  // Solo tras la aprobación humana cuenta como producto.
  assert.equal(isValidatedCatalogProduct("approved"), true);
  assert.equal(isValidatedCatalogProduct("published"), true);
});

test("una coincidencia del catálogo propio SÍ es un producto validado", () => {
  assert.equal(isValidatedCatalogProduct("catalog_matched"), true);
});

test("lo ignorado no cuenta como producto", () => {
  assert.equal(isValidatedCatalogProduct("ignored"), false);
});

test("los estados legados se siguen aceptando (hay filas con ellos)", () => {
  // 'matched' era el antiguo 'catalog_matched' y 'reviewed' el antiguo
  // 'approved': no se reescriben, así que siguen contando como validados.
  assert.equal(isValidatedCatalogProduct("matched"), true);
  assert.equal(isValidatedCatalogProduct("reviewed"), true);
});
