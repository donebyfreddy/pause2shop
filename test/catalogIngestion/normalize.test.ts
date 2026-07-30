import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  normalizeColor,
  normalizeCategory,
  normalizeBrand,
  identityKey,
  parsePrice,
  normalizeCurrency,
  normalizeAvailability,
  computeContentHash,
} from "../../lib/catalogIngestion/normalization/normalize";

test("normalizeText quita acentos, símbolos y colapsa espacios", () => {
  assert.equal(normalizeText("  Vestido MIDI — Édition Limitée!  "), "vestido midi edition limitee");
  assert.equal(normalizeText(null), "");
});

test("normalizeColor mapea ES/EN a color canónico", () => {
  assert.equal(normalizeColor("Rojo"), "red");
  assert.equal(normalizeColor("azul marino"), "navy");
  assert.equal(normalizeColor("NAVY"), "navy");
  assert.equal(normalizeColor("Azul marino intenso"), "navy");
  assert.equal(normalizeColor("verde"), "green");
  assert.equal(normalizeColor(null), null);
});

test("normalizeCategory mapea a categorías canónicas", () => {
  assert.equal(normalizeCategory("Vestidos"), "dress");
  assert.equal(normalizeCategory("vaqueros"), "jeans");
  assert.equal(normalizeCategory("Zapatillas deportivas"), "sneakers");
  assert.equal(normalizeCategory("T-Shirt"), "t-shirt");
});

test("normalizeBrand resuelve alias", () => {
  assert.equal(normalizeBrand("H&M"), "hm");
  assert.equal(normalizeBrand("ZARA"), "zara");
});

test("identityKey converge para el mismo producto", () => {
  const a = identityKey("Zara", "Vestido Midi Rojo", "Rojo");
  const b = identityKey("ZARA", "vestido midi  rojo!", "red");
  assert.equal(a, b);
  assert.notEqual(a, identityKey("Zara", "Vestido Midi Rojo", "azul"));
});

test("parsePrice entiende formatos EU y US", () => {
  assert.equal(parsePrice("39,95 €"), 39.95);
  assert.equal(parsePrice("$1,299.00"), 1299);
  assert.equal(parsePrice("1.299,50"), 1299.5);
  assert.equal(parsePrice(12.5), 12.5);
  assert.equal(parsePrice("sin precio"), null);
  assert.equal(parsePrice(null), null);
});

test("normalizeCurrency y availability schema.org", () => {
  assert.equal(normalizeCurrency("eur"), "EUR");
  assert.equal(normalizeCurrency("€"), "EUR");
  assert.equal(normalizeAvailability("https://schema.org/InStock"), "in_stock");
  assert.equal(normalizeAvailability("https://schema.org/OutOfStock"), "out_of_stock");
  assert.equal(normalizeAvailability(null), "unknown");
});

test("computeContentHash es estable y sensible a cambios", () => {
  const base = {
    title: "Camisa", brand: "Zara", description: "d", price: 10, currency: "EUR",
    availability: "in_stock", color: "white", images: [{ url: "http://x/1.jpg" }], sizes: ["M"],
  };
  assert.equal(computeContentHash(base), computeContentHash({ ...base }));
  assert.notEqual(computeContentHash(base), computeContentHash({ ...base, price: 12 }));
});

test("categoriesMatch cubre la asimetría de granularidad con pause2shop", async () => {
  const { categoriesMatch, categoryFamily } = await import("../../lib/catalogIngestion/normalization/normalize");
  // Familia gruesa (pause2shop) vs categoría fina (catálogo), en ambos sentidos
  assert.equal(categoriesMatch("clothing", "vestidos"), true);
  assert.equal(categoriesMatch("vaqueros", "clothing"), true);
  assert.equal(categoriesMatch("footwear", "zapatillas"), true);
  assert.equal(categoriesMatch("bags_accessories", "bolso"), true);
  // Iguales tras normalizar
  assert.equal(categoriesMatch("vestido", "dress"), true);
  // Incompatibles de verdad
  assert.equal(categoriesMatch("footwear", "vestidos"), false);
  assert.equal(categoriesMatch("watches_jewelry", "clothing"), false);
  // "all" o ausencia no filtran
  assert.equal(categoriesMatch("all", "vestidos"), true);
  assert.equal(categoriesMatch(null, "vestidos"), true);
  assert.equal(categoryFamily("dress"), "clothing");
});
