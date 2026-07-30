import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveAnalysisConfig,
  filterItemsByConfig,
  intensityMinIntervalMs,
  isCategoryAllowed,
  isRelationshipAllowed,
  parseConfig,
  serializeConfig,
} from "../lib/analysis/categories";
import { buildVisionPrompt } from "../lib/vision";
import type { DetectedItem } from "../lib/types";

function item(partial: Partial<DetectedItem>): DetectedItem {
  return {
    name: "",
    category: "",
    description: "",
    search_query_es: "",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.9,
    ...partial,
  };
}

// ── isCategoryAllowed (ES/EN) ──────────────────────────────────────────────

test("clothing acepta prendas en ES y EN, rechaza fondo", () => {
  const cats = ["clothing" as const];
  assert.equal(isCategoryAllowed(item({ name: "camisa negra", category: "shirt" }), cats), true);
  assert.equal(isCategoryAllowed(item({ name: "t-shirt blanca", category: "t-shirt" }), cats), true);
  assert.equal(isCategoryAllowed(item({ name: "sudadera", category: "hoodie" }), cats), true);
  assert.equal(isCategoryAllowed(item({ name: "vaqueros", category: "jeans" }), cats), true);
  // Rechazos: fondo / otras categorías
  for (const bad of [
    { name: "puerta", category: "door" },
    { name: "sofá", category: "sofa" },
    { name: "planta", category: "plant" },
    { name: "lámpara", category: "lamp" },
    { name: "reloj dorado", category: "watch" },
    { name: "zapatillas", category: "sneakers" },
    { name: "coche", category: "car" },
  ]) {
    assert.equal(isCategoryAllowed(item(bad), cats), false, `debería rechazar ${bad.category}`);
  }
});

test("'all' acepta cualquier cosa; lista vacía también", () => {
  assert.equal(isCategoryAllowed(item({ category: "door" }), ["all"]), true);
  assert.equal(isCategoryAllowed(item({ category: "door" }), []), true);
});

test("selección múltiple acepta la unión de categorías", () => {
  const cats = ["clothing" as const, "footwear" as const, "watches_jewelry" as const];
  assert.equal(isCategoryAllowed(item({ category: "sneakers" }), cats), true);
  assert.equal(isCategoryAllowed(item({ category: "watch" }), cats), true);
  assert.equal(isCategoryAllowed(item({ category: "shirt" }), cats), true);
  assert.equal(isCategoryAllowed(item({ category: "sofa" }), cats), false);
});

// ── deriveAnalysisConfig / person-centric ──────────────────────────────────

test("solo clothing ⇒ personCentric automático", () => {
  const cfg = deriveAnalysisConfig(["clothing"], "standard");
  assert.equal(cfg.personCentric, true);
});

test("categorías de entorno NO fuerzan personCentric", () => {
  assert.equal(deriveAnalysisConfig(["furniture_home"], "standard").personCentric, false);
  assert.equal(deriveAnalysisConfig(["all"], "standard").personCentric, false);
});

// ── isRelationshipAllowed ──────────────────────────────────────────────────

test("modo ropa: worn sí, background no, held solo si accesorios seleccionados", () => {
  const clothingOnly = deriveAnalysisConfig(["clothing"], "standard");
  assert.equal(isRelationshipAllowed("worn", clothingOnly), true);
  assert.equal(isRelationshipAllowed("background", clothingOnly), false);
  assert.equal(isRelationshipAllowed("held", clothingOnly), false);

  const withBags = deriveAnalysisConfig(["clothing", "bags_accessories"], "standard");
  assert.equal(isRelationshipAllowed("held", withBags), true);
});

test("sin personCentric todo relationship pasa", () => {
  const cfg = deriveAnalysisConfig(["all"], "standard");
  assert.equal(isRelationshipAllowed("background", cfg), true);
});

// ── filterItemsByConfig ────────────────────────────────────────────────────

test("filterItemsByConfig deja solo prendas worn en modo ropa", () => {
  const cfg = deriveAnalysisConfig(["clothing"], "standard");
  const items = [
    item({ name: "camisa negra estampada", category: "shirt", relationship: "worn" }),
    item({ name: "puerta", category: "door", relationship: "background" }),
    item({ name: "reloj", category: "watch", relationship: "worn" }),
    item({ name: "planta", category: "plant", relationship: "background" }),
  ];
  const out = filterItemsByConfig(items, cfg);
  assert.equal(out.length, 1);
  assert.equal(out[0].category, "shirt");
});

// ── intensidad ─────────────────────────────────────────────────────────────

test("intensidad mapea a intervalos distintos", () => {
  assert.ok(intensityMinIntervalMs("fast") > intensityMinIntervalMs("standard"));
  assert.ok(intensityMinIntervalMs("standard") > intensityMinIntervalMs("exhaustive"));
});

// ── parse/serialize round-trip ─────────────────────────────────────────────

test("parseConfig valida y descarta categorías inválidas", () => {
  const cfg = parseConfig({
    categories: ["clothing", "not-a-category", 5],
    analysisIntensity: "exhaustive",
  });
  assert.deepEqual(cfg.categories, ["clothing"]);
  assert.equal(cfg.analysisIntensity, "exhaustive");
  assert.equal(cfg.personCentric, true);
});

test("parseConfig sin datos usa defaults", () => {
  const cfg = parseConfig(undefined);
  assert.ok(cfg.categories.length >= 1);
  assert.ok(["fast", "standard", "exhaustive"].includes(cfg.analysisIntensity));
});

test("serialize→parse es estable", () => {
  const cfg = deriveAnalysisConfig(["clothing", "watches_jewelry"], "fast");
  const round = parseConfig(serializeConfig(cfg));
  assert.deepEqual(round.categories, cfg.categories);
  assert.equal(round.analysisIntensity, cfg.analysisIntensity);
});

// ── buildVisionPrompt dinámico ─────────────────────────────────────────────

test("prompt de ropa no menciona categorías no seleccionadas", () => {
  const prompt = buildVisionPrompt(deriveAnalysisConfig(["clothing"], "standard"));
  assert.match(prompt.toLowerCase(), /prendas de ropa/);
  // No debe pedir muebles/decoración/vehículos como resultados
  assert.doesNotMatch(prompt.toLowerCase(), /detecta únicamente productos de estas categorías: muebles/);
});

test("prompt 'all' usa el person-centric completo", () => {
  const prompt = buildVisionPrompt(deriveAnalysisConfig(["all"], "standard"));
  assert.match(prompt.toLowerCase(), /person-centric/);
});

test("prompt multi-categoría lista solo lo seleccionado", () => {
  const prompt = buildVisionPrompt(
    deriveAnalysisConfig(["footwear", "watches_jewelry"], "standard"),
  );
  assert.match(prompt, /Calzado/);
  assert.match(prompt, /Relojes y joyería/);
  assert.doesNotMatch(prompt, /Muebles y hogar/);
});
