import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

/**
 * Tests del control de presupuesto: al agotarse se deniegan nuevas búsquedas
 * externas (la detección continúa fuera de este módulo).
 */

function resetState() {
  (globalThis as Record<string, unknown>).__reverseBudget = undefined;
}

beforeEach(resetState);

test("permite buscar dentro de los límites y registra consumo", async () => {
  const { canSearch, recordSearch, budgetSnapshot } = await import(
    "../lib/server/searchBudget"
  );
  resetState();
  assert.equal(canSearch("video-1").allowed, true);
  recordSearch("video-1", 0.01);
  const snap = budgetSnapshot();
  assert.equal(snap.totalRequests, 1);
  assert.ok(snap.spentEur > 0);
  assert.equal(snap.exhausted, false);
});

test("deniega al superar el límite por vídeo pero no afecta a otros vídeos", async () => {
  const { canSearch, recordSearch } = await import("../lib/server/searchBudget");
  resetState();
  const perVideo = Number(process.env.MAX_REVERSE_SEARCHES_PER_VIDEO) || 40;
  for (let i = 0; i < perVideo; i++) recordSearch("video-a", 0.0001);
  const denied = canSearch("video-a");
  assert.equal(denied.allowed, false);
  assert.match(denied.reason ?? "", /por vídeo/i);
  assert.equal(canSearch("video-b").allowed, true);
});

test("deniega al agotar el presupuesto total en euros", async () => {
  const { canSearch, recordSearch, budgetSnapshot } = await import(
    "../lib/server/searchBudget"
  );
  resetState();
  const budget = budgetSnapshot().budgetEur;
  recordSearch("video-x", budget + 1);
  const denied = canSearch("video-y");
  assert.equal(denied.allowed, false);
  assert.match(denied.reason ?? "", /presupuesto/i);
  assert.equal(budgetSnapshot().exhausted, true);
});
