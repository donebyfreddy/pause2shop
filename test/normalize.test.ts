import { test } from "node:test";
import assert from "node:assert/strict";
import type { DetectedItem as VisionItem } from "../lib/types";
import {
  generateItemFingerprint,
  inferItemType,
  normalizeDetectedItem,
  normalizeText,
  timestampBucket,
} from "../lib/catalog/normalize";

test("normalizeText: minúsculas, sin acentos, espacios colapsados", () => {
  assert.equal(normalizeText("  Camiseta  BLANCA  "), "camiseta blanca");
  assert.equal(normalizeText("Pantalón Cargo"), "pantalon cargo");
  assert.equal(normalizeText(null), "");
  assert.equal(normalizeText(undefined), "");
});

test("timestampBucket agrupa segundos cercanos (bucket 5)", () => {
  assert.equal(timestampBucket(0), 0);
  assert.equal(timestampBucket(4), 0);
  assert.equal(timestampBucket(5), 5);
  assert.equal(timestampBucket(12), 10);
  assert.equal(timestampBucket(14.9), 10);
  assert.equal(timestampBucket(-3), 0);
});

test("timestampBucket admite tamaño de bucket configurable", () => {
  assert.equal(timestampBucket(17, 10), 10);
  assert.equal(timestampBucket(23, 10), 20);
});

test("inferItemType mapea categorías ES/EN a tipos gruesos", () => {
  assert.equal(inferItemType("ropa", "camiseta"), "clothing");
  assert.equal(inferItemType("calzado", "zapatillas"), "footwear");
  assert.equal(inferItemType("accesorios", "reloj"), "accessory");
  assert.equal(inferItemType("electrónica", "auriculares"), "electronics");
  assert.equal(inferItemType("muebles", "lámpara"), "home");
  assert.equal(inferItemType("belleza", "perfume"), "beauty");
  assert.equal(inferItemType("algo raro", "cosa"), "other");
  // Respeta un hint válido del modelo.
  assert.equal(inferItemType("loquesea", "x", "footwear"), "footwear");
});

test("generateItemFingerprint es estable e ignora acentos/mayúsculas", () => {
  const a = generateItemFingerprint({
    videoId: "v1",
    category: "Ropa",
    color: "Blanco",
    style: "Oversize",
    visibleBrand: null,
    timestampBucket: 10,
  });
  const b = generateItemFingerprint({
    videoId: "v1",
    category: "ropa",
    color: "blanco",
    style: "oversize",
    visibleBrand: null,
    timestampBucket: 10,
  });
  assert.equal(a, b, "mismas propiedades → misma huella");

  const c = generateItemFingerprint({
    videoId: "v1",
    category: "ropa",
    color: "negro",
    style: "oversize",
    visibleBrand: null,
    timestampBucket: 10,
  });
  assert.notEqual(a, c, "distinto color → distinta huella");
});

test("generateItemFingerprint separa por bucket de timestamp", () => {
  const base = {
    videoId: "v1",
    category: "ropa",
    color: "blanco",
    style: "oversize",
    visibleBrand: null,
  };
  assert.notEqual(
    generateItemFingerprint({ ...base, timestampBucket: 10 }),
    generateItemFingerprint({ ...base, timestampBucket: 15 })
  );
});

function visionItem(over: Partial<VisionItem> = {}): VisionItem {
  return {
    name: "Camiseta blanca oversize",
    category: "ropa",
    subcategory: "camiseta",
    color: "blanco",
    visible_brand: null,
    style: "oversize",
    description: "Camiseta blanca de manga corta.",
    search_query_es: "camiseta blanca oversize",
    alternative_queries: ["white oversized t-shirt", "camiseta algodón blanca"],
    verified_provider_queries: ["camiseta blanca"],
    confidence: 0.9,
    bounding_box: null,
    secondary_colors: ["gris"],
    pattern: "liso",
    material_guess: "algodón",
    gender_fit: "unisex",
    ...over,
  };
}

test("normalizeDetectedItem mapea al esquema de catálogo y deriva campos", () => {
  const input = normalizeDetectedItem(visionItem(), {
    videoId: "v1",
    frameId: "f1",
    sourceType: "uploaded",
    sourceUrl: null,
    timestampSeconds: 12,
  });

  assert.equal(input.type, "clothing");
  assert.equal(input.category, "ropa");
  assert.equal(input.color, "blanco");
  assert.deepEqual(input.secondaryColors, ["gris"]);
  assert.equal(input.pattern, "liso");
  assert.equal(input.materialGuess, "algodón");
  assert.equal(input.genderFit, "unisex");
  assert.equal(input.timestampBucket, 10);
  assert.equal(input.searchQuery, "camiseta blanca oversize");
  // marketplace_keywords combina query + alternativas + verificadas (sin duplicados).
  assert.ok(input.marketplaceKeywords.includes("camiseta blanca oversize"));
  assert.ok(input.marketplaceKeywords.includes("white oversized t-shirt"));
  assert.ok(input.marketplaceKeywords.length <= 8);
  // El fingerprint coincide con el generado a mano.
  assert.equal(
    input.fingerprint,
    generateItemFingerprint({
      videoId: "v1",
      category: "ropa",
      color: "blanco",
      style: "oversize",
      visibleBrand: null,
      timestampBucket: 10,
    })
  );
});

test("normalizeDetectedItem recorta confidence a [0,1] y rellena nombre", () => {
  const a = normalizeDetectedItem(visionItem({ confidence: 1.5 }), {
    videoId: "v1",
    frameId: null,
    sourceType: "youtube",
    sourceUrl: null,
    timestampSeconds: 0,
  });
  assert.equal(a.confidence, 1);

  const b = normalizeDetectedItem(visionItem({ name: "   " }), {
    videoId: "v1",
    frameId: null,
    sourceType: "youtube",
    sourceUrl: null,
    timestampSeconds: 0,
  });
  assert.equal(b.name, "objeto sin nombre");
});
