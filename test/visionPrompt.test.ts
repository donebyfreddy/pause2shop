import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_OBJECTS_PER_FRAME, VISION_PROMPT, normalizeAnalysis } from "../lib/vision";
import type { FrameAnalysis } from "../lib/types";

/**
 * Fixture de regresión del contrato de detección multiproducto (Fase 15):
 * si alguien vuelve a sesgar el prompt a "solo ropa" o relaja las reglas de
 * marca/bounding box, estos tests fallan.
 */

test("el prompt es PERSON-CENTRIC: persona primero, fondo después, no solo ropa", () => {
  assert.match(VISION_PROMPT, /PERSON-CENTRIC/);
  assert.match(VISION_PROMPT, /lleva puesto/i);
  assert.match(VISION_PROMPT, /sostiene/i);
  assert.match(VISION_PROMPT, /no solo prendas/i);
  assert.match(VISION_PROMPT, /mobiliario/i);
  assert.match(VISION_PROMPT, /monitores/i);
  // El fondo genérico queda explícitamente relegado.
  assert.match(VISION_PROMPT, /NO priorices/i);
  assert.match(VISION_PROMPT, /barandillas/i);
  assert.match(VISION_PROMPT, /palmeras/i);
  assert.match(VISION_PROMPT, /relationship/);
  assert.match(VISION_PROMPT, /person_index/);
  assert.match(VISION_PROMPT, /person_association_score/);
});

test("el prompt prohíbe personas y marcas inventadas, y exige boxes del producto", () => {
  assert.match(VISION_PROMPT, /NUNCA devuelvas la persona/i);
  assert.match(VISION_PROMPT, /NO inventes marcas/i);
  assert.match(VISION_PROMPT, /brand_evidence/);
  assert.match(VISION_PROMPT, /bounding_box es OBLIGATORIA/i);
  assert.match(VISION_PROMPT, /NUNCA devuelvas bounding_box null/i);
  assert.match(VISION_PROMPT, /parcialmente visible/i);
  // Boxes ceñidas al producto: ni cuerpo entero ni brazo completo.
  assert.match(VISION_PROMPT, /sin incluir toda la cara/i);
  assert.match(VISION_PROMPT, /no todo el brazo/i);
});

test("el máximo de objetos es configurable y no está capado a 4", () => {
  assert.ok(MAX_OBJECTS_PER_FRAME >= 10, `máximo actual: ${MAX_OBJECTS_PER_FRAME}`);
  assert.ok(VISION_PROMPT.includes(String(MAX_OBJECTS_PER_FRAME)));
});

test("normalizeAnalysis no recorta a 4 items y ordena por relevancia de compra", () => {
  // Cajas DISTINTAS por objeto: objetos diferentes en posiciones diferentes.
  // (Si compartieran caja y categoría, el NMS los colapsaría — correcto.)
  const mk = (
    name: string,
    confidence: number,
    relevance: number,
    slot: number
  ): FrameAnalysis["items"][0] => ({
    name,
    category: "electrónica",
    description: "",
    search_query_es: name,
    alternative_queries: [],
    verified_provider_queries: [],
    confidence,
    purchase_relevance: relevance,
    bounding_box: {
      x: (slot % 5) * 0.19,
      y: Math.floor(slot / 5) * 0.3,
      width: 0.15,
      height: 0.2,
    },
  });
  const analysis: FrameAnalysis = {
    summary: "",
    style_vibe: "",
    items: [
      mk("objeto genérico", 0.9, 0.2, 0),
      mk("reloj distintivo", 0.7, 0.95, 1),
      ...Array.from({ length: 8 }, (_, i) => mk(`objeto ${i}`, 0.6, 0.5, i + 2)),
    ],
  };
  const out = normalizeAnalysis(analysis);
  assert.ok(out.items.length >= 10, `deben sobrevivir ≥10 items (hay ${out.items.length})`);
  // El reloj (alta relevancia de compra) debe rankear por encima del genérico
  // aunque tenga menos confianza.
  const relojIdx = out.items.findIndex((i) => i.name === "reloj distintivo");
  const genericoIdx = out.items.findIndex((i) => i.name === "objeto genérico");
  assert.ok(relojIdx < genericoIdx, "purchase_relevance debe pesar en el orden");
});
