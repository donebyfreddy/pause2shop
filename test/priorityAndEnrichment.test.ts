import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byPresentationPriority,
  deservesAutoSearch,
  presentationPriority,
} from "../lib/priority";
import {
  coerceCropDetails,
  mergeCropDetails,
  normalizeNullableVisualValue,
  type CropDetails,
} from "../lib/visualSearch/cropEnrichment";
import type { DetectedItem } from "../lib/types";

// --- prioridad comercial ------------------------------------------------------

test("prioridad: reloj/camisa/coche = high; taza = medium; planta/barandilla = low", () => {
  assert.equal(presentationPriority({ category: "reloj", name: "reloj plateado" }), "high");
  assert.equal(presentationPriority({ category: "camisa", name: "camisa hawaiana" }), "high");
  assert.equal(presentationPriority({ category: "coche", name: "Ferrari rojo" }), "high");
  assert.equal(presentationPriority({ category: "taza", name: "taza blanca" }), "medium");
  assert.equal(presentationPriority({ category: "planta", name: "planta de interior" }), "low");
  assert.equal(presentationPriority({ category: "estructura", name: "barandilla metálica" }), "low");
});

test("una planta con relevancia de compra alta sube a medium", () => {
  assert.equal(
    presentationPriority({ category: "planta", name: "maceta de diseño", purchase_relevance: 0.8 }),
    "medium"
  );
});

test("los objetos low no consumen búsqueda inversa automática", () => {
  assert.equal(deservesAutoSearch({ category: "barandilla", name: "barandilla" }), false);
  assert.equal(deservesAutoSearch({ category: "reloj", name: "reloj" }), true);
  assert.equal(deservesAutoSearch({ category: "taza", name: "taza" }), true);
});

test("byPresentationPriority ordena high antes que low", () => {
  const items = [
    { category: "planta", name: "planta" },
    { category: "reloj", name: "reloj" },
  ];
  const sorted = [...items].sort(byPresentationPriority);
  assert.equal(sorted[0].category, "reloj");
});

// --- coerceCropDetails (Structured Outputs) ------------------------------------

test("coerceCropDetails valida y normaliza el JSON del modelo", () => {
  const details = coerceCropDetails(
    JSON.stringify({
      product_type: "camisa",
      product_subtype: "camisa hawaiana",
      primary_color: "negro",
      secondary_colors: ["blanco"],
      pattern: "floral",
      material: null,
      silhouette: "corte relajado",
      visible_brand: null,
      brand_guess: null,
      brand_status: "unknown",
      brand_evidence: null,
      model_guess: null,
      model_status: "unknown",
      model_evidence: null,
      visible_text: null,
      logo_visible: false,
      logo_description: null,
      logo_position: null,
      distinctive_features: ["grandes flores blancas"],
      discriminating_terms: ["camp collar"],
      negative_search_terms: ["long sleeve"],
      refined_query:
        "men black short sleeve camp collar hawaiian shirt white floral print",
      alternative_queries: ["black hawaiian shirt floral"],
      crop_quality: 0.8,
      enough_detail_for_exact_search: true,
    })
  );
  assert.ok(details);
  assert.equal(details.brand_status, "unknown");
  assert.equal(details.negative_search_terms[0], "long sleeve");
  assert.ok(details.refined_query?.includes("hawaiian"));
});

test("coerceCropDetails rechaza basura y estados inválidos degradan a unknown", () => {
  assert.equal(coerceCropDetails("no es json"), null);
  assert.equal(coerceCropDetails(JSON.stringify({ product_type: "" })), null);
  const d = coerceCropDetails(
    JSON.stringify({ product_type: "reloj", brand_status: "invented", crop_quality: 7 })
  );
  assert.ok(d);
  assert.equal(d.brand_status, "unknown");
  assert.equal(d.crop_quality, 1); // clamp a 0-1
});

// --- merge de la segunda pasada -------------------------------------------------

function item(partial: Partial<DetectedItem>): DetectedItem {
  return {
    name: "camisa negra",
    category: "camisa",
    description: "",
    search_query_es: "camisa negra",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.95,
    ...partial,
  };
}

function details(partial: Partial<CropDetails>): CropDetails {
  return {
    product_type: "camisa",
    product_subtype: null,
    primary_color: null,
    secondary_colors: [],
    pattern: null,
    material: null,
    silhouette: null,
    visible_brand: null,
    brand_guess: null,
    brand_status: "unknown",
    brand_evidence: null,
    model_guess: null,
    model_status: "unknown",
    model_evidence: null,
    visible_text: null,
    logo_visible: false,
    logo_description: null,
    logo_position: null,
    distinctive_features: [],
    discriminating_terms: [],
    negative_search_terms: [],
    refined_query: null,
    alternative_queries: [],
    crop_quality: 0.7,
    enough_detail_for_exact_search: true,
    ...partial,
  };
}

test("normalizeNullableVisualValue trata genéricos como null", () => {
  assert.equal(normalizeNullableVisualValue("desconocido"), null);
  assert.equal(normalizeNullableVisualValue("unknown"), null);
  assert.equal(normalizeNullableVisualValue("N/A"), null);
  assert.equal(normalizeNullableVisualValue("  "), null);
  assert.equal(normalizeNullableVisualValue("Nike"), "Nike");
});

test("merge: un 'desconocido' genérico de la 1ª pasada NO bloquea la marca del crop", () => {
  const merged = mergeCropDetails(
    item({ visible_brand: "desconocido" }),
    details({ visible_brand: "Nike", brand_status: "verified", brand_evidence: "texto 'NIKE' legible" })
  );
  assert.equal(merged.visible_brand, "Nike");
  assert.equal(merged.brand_status, "verified");
});

test("merge: una marca VERIFICADA previa no se pisa con una conjetura nueva", () => {
  const merged = mergeCropDetails(
    item({ visible_brand: "Logitech" }),
    details({ visible_brand: "Razer", brand_status: "probable" })
  );
  assert.equal(merged.visible_brand, "Logitech");
});

test("merge: refined_query y modelo NUNCA se pierden", () => {
  const merged = mergeCropDetails(
    item({}),
    details({
      refined_query: "men black camp collar hawaiian shirt white floral",
      model_guess: "Modelo Aloha 2024",
      model_status: "probable",
      model_evidence: "referencia parcial en etiqueta",
    })
  );
  assert.equal(merged.refined_query, "men black camp collar hawaiian shirt white floral");
  assert.equal(merged.model_guess, "Modelo Aloha 2024");
  assert.equal(merged.model_status, "probable");
});

test("merge: sin details devuelve el item intacto", () => {
  const original = item({ visible_brand: "Nike" });
  assert.equal(mergeCropDetails(original, null), original);
});

test("merge: atributos refinados (subtipo/patrón/color) sustituyen a los genéricos", () => {
  const merged = mergeCropDetails(
    item({ subcategory: undefined, pattern: undefined, color: undefined }),
    details({ product_subtype: "camisa hawaiana", pattern: "floral", primary_color: "negro" })
  );
  assert.equal(merged.subcategory, "camisa hawaiana");
  assert.equal(merged.pattern, "floral");
  assert.equal(merged.color, "negro");
});
