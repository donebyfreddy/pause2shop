import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byPresentationPriority,
  deservesAutoSearch,
  personAssociationScore,
  presentationPriority,
} from "../lib/priority";
import { normalizeAnalysis, safeParseAnalysis } from "../lib/vision";
import type { DetectedItem, FrameAnalysis } from "../lib/types";

/**
 * Fixture de regresión del frame actual (persona en paseo marítimo):
 * camisa negra estampada (worn), reloj dorado (worn), objeto en mano (held),
 * palmeras y barandilla (background). La prioridad person-centric debe poner
 * SIEMPRE lo que lleva/sostiene la persona por delante del fondo.
 */

function det(partial: Partial<DetectedItem>): DetectedItem {
  return {
    name: "objeto",
    category: "general",
    description: "",
    search_query_es: "",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.8,
    bounding_box: { x: 0.3, y: 0.3, width: 0.2, height: 0.2 },
    ...partial,
  };
}

const SHIRT = det({
  name: "camisa negra manga corta con estampado blanco floral",
  category: "shirt",
  relationship: "worn",
  person_index: 0,
  person_association_score: 1,
  pattern: "estampado",
  confidence: 0.95,
  purchase_relevance: 0.9,
  bounding_box: { x: 0.3, y: 0.35, width: 0.28, height: 0.4 },
});
const WATCH = det({
  name: "reloj pulsera metálica dorada",
  category: "watch",
  relationship: "worn",
  person_index: 0,
  person_association_score: 1,
  confidence: 0.75,
  purchase_relevance: 0.85,
  bounding_box: { x: 0.66, y: 0.62, width: 0.06, height: 0.05 },
});
const HELD = det({
  name: "mando pequeño negro en la mano",
  category: "gadget",
  relationship: "held",
  person_index: 0,
  person_association_score: 0.95,
  confidence: 0.7,
  purchase_relevance: 0.6,
  bounding_box: { x: 0.12, y: 0.55, width: 0.06, height: 0.07 },
});
const PALM = det({
  name: "palmera tropical",
  category: "planta",
  relationship: "background",
  person_index: null,
  person_association_score: 0.15,
  confidence: 0.9,
  purchase_relevance: 0.2,
  bounding_box: { x: 0.55, y: 0.1, width: 0.2, height: 0.5 },
});
const RAILING = det({
  name: "barandilla metálica del paseo",
  category: "estructura",
  relationship: "background",
  person_index: null,
  confidence: 0.85,
  purchase_relevance: 0.1,
  bounding_box: { x: 0, y: 0.55, width: 1 - 0.02, height: 0.1 },
});

// --- prioridades ---------------------------------------------------------------

test("worn/held son prioridad alta; palmera y barandilla son low", () => {
  assert.equal(presentationPriority(SHIRT), "high");
  assert.equal(presentationPriority(WATCH), "high");
  assert.equal(presentationPriority(HELD), "high");
  assert.equal(presentationPriority(PALM), "low");
  assert.equal(presentationPriority(RAILING), "low");
});

test("el fondo NO consume reverse image search automática; worn/held sí", () => {
  assert.equal(deservesAutoSearch(SHIRT), true);
  assert.equal(deservesAutoSearch(WATCH), true);
  assert.equal(deservesAutoSearch(HELD), true);
  assert.equal(deservesAutoSearch(PALM), false);
  assert.equal(deservesAutoSearch(RAILING), false);
});

test("personAssociationScore: relación explícita > heurística; wearables antiguos ≈ worn", () => {
  assert.equal(personAssociationScore(SHIRT), 1);
  assert.equal(personAssociationScore(det({ relationship: "held" })), 0.95);
  // Datos antiguos sin relationship: un reloj puntúa como wearable.
  assert.equal(personAssociationScore(det({ category: "watch", name: "reloj" })), 0.9);
});

test("normalizeAnalysis: la camisa es prioridad 1 y el fondo nunca desplaza a lo worn/held", () => {
  const analysis: FrameAnalysis = {
    summary: "",
    style_vibe: "",
    items: [PALM, RAILING, SHIRT, HELD, WATCH],
  };
  const out = normalizeAnalysis(analysis);
  const names = out.items.map((i) => i.name);
  assert.equal(names[0], SHIRT.name, "la camisa debe ser prioridad 1");
  const wornHeldIdx = [SHIRT, WATCH, HELD].map((i) => names.indexOf(i.name));
  const bgIdx = [PALM, RAILING].map((i) => names.indexOf(i.name)).filter((i) => i >= 0);
  for (const w of wornHeldIdx) {
    for (const b of bgIdx) {
      assert.ok(w < b, "worn/held siempre por delante del fondo");
    }
  }
});

test("byPresentationPriority ordena worn antes que background", () => {
  const sorted = [PALM, SHIRT].sort(byPresentationPriority);
  assert.equal(sorted[0].name, SHIRT.name);
});

// --- parsing de los campos person-centric ----------------------------------------

test("safeParseAnalysis conserva relationship/person_index/person_association_score", () => {
  const parsed = safeParseAnalysis(
    JSON.stringify({
      summary: "persona en el paseo",
      style_vibe: "verano",
      items: [
        {
          name: "camisa negra floral",
          category: "shirt",
          relationship: "worn",
          person_index: 0,
          person_association_score: 1,
          confidence: 0.95,
          bounding_box: { x: 0.3, y: 0.3, width: 0.3, height: 0.4 },
        },
        {
          name: "palmera",
          category: "planta",
          relationship: "invented_value",
          person_index: "no",
          confidence: 0.9,
          bounding_box: { x: 0.6, y: 0.1, width: 0.2, height: 0.5 },
        },
      ],
    })
  );
  assert.ok(parsed);
  assert.equal(parsed.items[0].relationship, "worn");
  assert.equal(parsed.items[0].person_index, 0);
  assert.equal(parsed.items[0].person_association_score, 1);
  // Valores inválidos se descartan sin romper el item.
  assert.equal(parsed.items[1].relationship, undefined);
  assert.equal(parsed.items[1].person_index, null);
});

test("la persona nunca se devuelve como producto (regla del prompt, no del parser): items sin nombre se descartan", () => {
  const parsed = safeParseAnalysis(
    JSON.stringify({ summary: "", style_vibe: "", items: [{ name: "" }] })
  );
  assert.ok(parsed);
  assert.equal(parsed.items.length, 0);
});
