import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyMatch,
  evidenceLines,
  getMatchThresholds,
  matchConfidence,
} from "../lib/visualSearch/matchConfidence";
import { buildVisualMatch } from "../lib/visualSearch/engine";
import { rankCandidates } from "../lib/visualSearch/rank";
import type { DetectedItem } from "../lib/types";
import type { VisualCandidate } from "../lib/visualSearch/types";

const T = { exact: 0.9, nearExact: 0.7, similar: 0.3 };

// --- matchConfidence ---------------------------------------------------------

test("matchConfidence normaliza el score aditivo a 0-1 con cap", () => {
  assert.equal(matchConfidence(75), 0.5);
  assert.equal(matchConfidence(150), 1);
  assert.equal(matchConfidence(300), 1);
  assert.equal(matchConfidence(-10), 0);
});

test("getMatchThresholds usa defaults si no hay env", () => {
  const t = getMatchThresholds();
  assert.ok(t.exact > t.nearExact);
  assert.ok(t.nearExact > t.similar);
});

// --- clasificación por umbrales + evidencia ----------------------------------

test("exact exige exact_image_match Y superar el umbral exact", () => {
  // 138 pts = 0.92: imagen idéntica + tienda fiable + precio.
  assert.equal(
    classifyMatch(138, { exact_image_match: 100, trusted_store: 30, has_price: 8 }, T),
    "exact"
  );
});

test("exact_image_match con score bajo se degrada a near_exact, no exact", () => {
  // 88 pts = 0.59: imagen idéntica pero tienda desconocida.
  assert.equal(
    classifyMatch(88, { exact_image_match: 100, unknown_store: -20, has_price: 8 }, T),
    "near_exact"
  );
});

test("un score alto SOLO por texto nunca es exact (falta evidencia visual)", () => {
  // marca + texto + color + categoría + tienda = 145 pts = 0.97, sin imagen idéntica.
  const breakdown = {
    same_brand: 50,
    visible_text_match: 40,
    same_color: 15,
    same_category: 10,
    trusted_store: 30,
  };
  assert.equal(classifyMatch(145, breakdown, T), "near_exact");
});

test("bajo el umbral similar → null (no fiable, no se presenta)", () => {
  // 25 pts = 0.17: solo posición media de Lens y tienda desconocida.
  assert.equal(classifyMatch(25, { lens_high_position: 25, unknown_store: -20 }, T), null);
});

test("candidato visual sin marca queda como similar", () => {
  // 70 pts = 0.47: top de Lens + color + categoría, sin marca ni OCR.
  const breakdown = { lens_top_position: 45, same_color: 15, same_category: 10 };
  assert.equal(classifyMatch(70, breakdown, T), "similar");
});

// --- evidencia legible --------------------------------------------------------

test("evidenceLines traduce el breakdown, positivas primero", () => {
  const lines = evidenceLines({
    unknown_store: -20,
    same_color: 15,
    same_brand: 50,
  });
  assert.equal(lines[0], "✓ La marca coincide");
  assert.ok(lines.includes("✓ El color coincide"));
  assert.equal(lines[lines.length - 1], "✗ Tienda no verificada");
});

test("evidenceLines omite señales a cero y no inventa evidencia", () => {
  assert.deepEqual(evidenceLines({ same_color: 0 }), []);
});

// --- fixture de regresión: camisa hawaiana negra con estampado floral --------

const HAWAIIAN_SHIRT: DetectedItem = {
  name: "camisa hawaiana negra con estampado blanco floral",
  category: "camisa",
  subcategory: "camisa hawaiana",
  color: "negro",
  pattern: "floral",
  visible_brand: null,
  brand_guess: null,
  logo_visible: false,
  visible_text: null,
  description: "Camisa de manga corta negra con grandes flores blancas",
  search_query_es: "camisa hawaiana negra estampado floral blanco",
  alternative_queries: [],
  verified_provider_queries: [],
  confidence: 0.95,
  bounding_box: { x: 0.3, y: 0.2, width: 0.3, height: 0.45 },
};

function candidate(partial: Partial<VisualCandidate>): VisualCandidate {
  return {
    source: "searchapi_google_lens",
    title: "",
    link: "https://example.test/p",
    store: null,
    domain: null,
    imageUrl: "https://example.test/p.jpg",
    price: null,
    currency: null,
    brand: null,
    position: null,
    exactImageMatch: false,
    queryUsed: null,
    ...partial,
  };
}

test("camisa hawaiana: candidato comercial fuerte produce match con imagen, tienda y evidencia", () => {
  const ranked = rankCandidates(
    [
      candidate({
        title: "Camisa hawaiana negra flores blancas manga corta",
        link: "https://www.zalando.es/camisa-hawaiana-negra.html",
        store: "Zalando",
        domain: "zalando.es",
        price: 49.95,
        currency: "EUR",
        position: 1,
      }),
      candidate({
        title: "Black floral hawaiian shirt",
        link: "https://tienda-rara.example/p/1",
        domain: "tienda-rara.example",
        position: 12,
      }),
    ],
    HAWAIIAN_SHIRT
  );

  const match = buildVisualMatch(HAWAIIAN_SHIRT, ranked);
  assert.ok(match, "debe haber match presentable");
  // Sin marca ni imagen idéntica: NUNCA exact — se clasifica honesto.
  assert.notEqual(match.match_type, "exact");
  assert.ok(match.match_confidence > 0 && match.match_confidence <= 1);
  assert.ok(match.evidence.length > 0, "debe explicar en qué coincide");
  assert.equal(match.purchase_links[0].url.includes("zalando"), true);
  assert.equal(match.product_images.length > 0, true);
  // Detección y matching separados: 0.95 de detección ≠ confianza de match.
  assert.notEqual(Math.round(match.match_confidence * 100), 95);
});

test("camisa hawaiana: candidatos débiles → sin match fiable (null), la UI ofrece búsqueda manual", () => {
  const ranked = rankCandidates(
    [
      candidate({
        title: "Blog: 10 camisas para el verano",
        link: "https://blog.example/camisas",
        domain: "blog.example",
        position: 30,
      }),
    ],
    HAWAIIAN_SHIRT
  );
  assert.equal(buildVisualMatch(HAWAIIAN_SHIRT, ranked), null);
});

test("camisa hawaiana: exact_matches del proveedor con tienda fiable → exact", () => {
  const ranked = rankCandidates(
    [
      candidate({
        title: "Camisa hawaiana negra floral",
        link: "https://www.amazon.es/dp/B0EXAMPLE",
        store: "Amazon.es",
        domain: "amazon.es",
        price: 39.9,
        currency: "EUR",
        exactImageMatch: true,
      }),
    ],
    HAWAIIAN_SHIRT
  );
  const match = buildVisualMatch(HAWAIIAN_SHIRT, ranked);
  assert.ok(match);
  assert.equal(match.match_type, "exact");
  assert.ok(match.match_confidence >= 0.9);
  assert.ok(match.evidence[0].includes("Imagen idéntica"));
});
