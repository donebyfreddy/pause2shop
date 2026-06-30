import { test } from "node:test";
import assert from "node:assert/strict";
import { safeParseAnalysis, normalizeAnalysis, mockAnalysis } from "../lib/vision";

test("safeParseAnalysis interpreta JSON limpio con campos nuevos", () => {
  const raw = JSON.stringify({
    summary: "Una persona con camiseta blanca.",
    style_vibe: "casual",
    items: [
      {
        name: "Camiseta blanca",
        type: "clothing",
        category: "ropa",
        color: "blanco",
        secondary_colors: ["gris"],
        pattern: "liso",
        material_guess: "algodón",
        gender_fit: "unisex",
        confidence: 0.8,
      },
    ],
  });
  const parsed = safeParseAnalysis(raw);
  assert.ok(parsed);
  assert.equal(parsed!.items.length, 1);
  const it = parsed!.items[0];
  assert.equal(it.type, "clothing");
  assert.deepEqual(it.secondary_colors, ["gris"]);
  assert.equal(it.material_guess, "algodón");
});

test("safeParseAnalysis tolera vallas ```json y comas finales", () => {
  const raw = "```json\n{ \"summary\": \"x\", \"style_vibe\": \"y\", \"items\": [ { \"name\": \"Gorra\", \"confidence\": 0.7, }, ], }\n```";
  const parsed = safeParseAnalysis(raw);
  assert.ok(parsed);
  assert.equal(parsed!.items[0].name, "Gorra");
});

test("safeParseAnalysis normaliza confidence en escala 0-100", () => {
  const raw = JSON.stringify({
    summary: "",
    style_vibe: "",
    items: [{ name: "Reloj", confidence: 85 }],
  });
  const parsed = safeParseAnalysis(raw);
  assert.equal(parsed!.items[0].confidence, 0.85);
});

test("safeParseAnalysis devuelve null ante basura", () => {
  assert.equal(safeParseAnalysis("no soy json"), null);
});

test("normalizeAnalysis filtra baja confianza, ordena y añade productLinks", () => {
  const analysis = {
    summary: "s",
    style_vibe: "streetwear",
    items: [
      { ...stub("Item bajo"), confidence: 0.2 }, // se descarta (<0.45)
      { ...stub("Item alto"), confidence: 0.95 },
      { ...stub("Item medio"), confidence: 0.6 },
    ],
  };
  const out = normalizeAnalysis(analysis);
  assert.equal(out.items.length, 2, "descarta el de confianza 0.2");
  assert.equal(out.items[0].name, "Item alto", "ordenado por score desc");
  assert.ok((out.items[0].productLinks?.length ?? 0) > 0, "tiene enlaces de producto");
});

test("mockAnalysis es válido y normalizable", () => {
  const out = normalizeAnalysis(mockAnalysis());
  assert.ok(out.items.length > 0);
  assert.ok(out.summary.length > 0);
  for (const it of out.items) {
    assert.ok(it.confidence >= 0 && it.confidence <= 1);
  }
});

function stub(name: string) {
  return {
    name,
    category: "ropa",
    color: "blanco",
    visible_brand: null,
    style: "streetwear",
    description: "desc",
    search_query_es: name.toLowerCase(),
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.5,
    bounding_box: null,
  };
}
