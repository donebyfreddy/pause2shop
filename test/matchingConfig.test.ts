import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogThresholdFor,
  getMatchingConfig,
  isMatchingMode,
} from "../lib/matching/config";
import { normalizeMatchingMode } from "../lib/matching/types";

// Config de matching: modos, defaults y saneado de valores raros. Sin red.

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

test("sin PRODUCT_MATCHING_MODE el default es catalog_first (el modo recomendado)", () => {
  const cfg = getMatchingConfig(env({}));
  assert.equal(cfg.mode, "catalog_first");
});

test("un modo desconocido cae a catalog_first en vez de romper", () => {
  assert.equal(getMatchingConfig(env({ PRODUCT_MATCHING_MODE: "catalogo" })).mode, "catalog_first");
  assert.equal(getMatchingConfig(env({ PRODUCT_MATCHING_MODE: "" })).mode, "catalog_first");
});

test("los cuatro modos válidos se respetan", () => {
  for (const mode of ["catalog_only", "catalog_first", "external_only", "hybrid"] as const) {
    assert.equal(getMatchingConfig(env({ PRODUCT_MATCHING_MODE: mode })).mode, mode);
    assert.equal(isMatchingMode(mode), true);
  }
  assert.equal(isMatchingMode("catalog"), false);
  assert.equal(isMatchingMode(null), false);
});

// Compatibilidad: hay despliegues con PRODUCT_MATCHING_MODE=catalog-first y
// filas en Postgres con "catalog-only". Deben seguir resolviéndose.
test("el formato legado con guion medio se normaliza al canónico", () => {
  const legacy = {
    "catalog-only": "catalog_only",
    "catalog-first": "catalog_first",
    "external-only": "external_only",
  } as const;
  for (const [old, canonical] of Object.entries(legacy)) {
    assert.equal(getMatchingConfig(env({ PRODUCT_MATCHING_MODE: old })).mode, canonical);
    assert.equal(normalizeMatchingMode(old), canonical);
  }
  assert.equal(normalizeMatchingMode("  CATALOG_FIRST  "), "catalog_first");
  assert.equal(normalizeMatchingMode("nope"), null);
});

test("umbrales por fuente: cada una tiene el suyo y son configurables", () => {
  const d = getMatchingConfig(env({}));
  assert.equal(d.catalogMatchMinScore, 0.82);
  assert.equal(d.externalMatchMinScore, 0.75);
  assert.equal(d.hybridMatchMinScore, 0.8);

  const custom = getMatchingConfig(
    env({
      CATALOG_MATCH_THRESHOLD: "0.9",
      EXTERNAL_MATCH_THRESHOLD: "0.6",
      HYBRID_MATCH_THRESHOLD: "0.7",
    })
  );
  assert.equal(custom.catalogMatchMinScore, 0.9);
  assert.equal(custom.externalMatchMinScore, 0.6);
  assert.equal(custom.hybridMatchMinScore, 0.7);

  // El nombre antiguo se sigue leyendo si no está el nuevo.
  assert.equal(
    getMatchingConfig(env({ CATALOG_MATCH_MIN_SCORE: "0.55" })).catalogMatchMinScore,
    0.55
  );
});

test("umbral por categoría: afina una categoría sin tocar el umbral global", () => {
  const cfg = getMatchingConfig(
    env({ CATALOG_MATCH_THRESHOLD: "0.8", CATALOG_MATCH_THRESHOLD_FOOTWEAR: "0.95" })
  );
  assert.equal(catalogThresholdFor(cfg, "footwear"), 0.95);
  assert.equal(catalogThresholdFor(cfg, "FootWear"), 0.95);
  assert.equal(catalogThresholdFor(cfg, "clothing"), 0.8);
  assert.equal(catalogThresholdFor(cfg, null), 0.8);
});

test("defaults numéricos y booleanos del catálogo", () => {
  const cfg = getMatchingConfig(env({}));
  assert.equal(cfg.catalogServiceUrl, "http://localhost:4100");
  assert.equal(cfg.catalogServiceApiKey, null);
  assert.equal(cfg.catalogMatchMinScore, 0.82);
  assert.equal(cfg.catalogMatchTopK, 10);
  assert.equal(cfg.catalogRequestTimeoutMs, 5000);
  assert.equal(cfg.catalogExternalFallback, true);
  assert.equal(cfg.catalogSaveExternalResults, true);
  assert.equal(cfg.catalogCacheEnabled, true);
  assert.equal(cfg.catalogCacheTtlSeconds, 86_400);
  assert.equal(cfg.visionEnrichmentEnabled, true);
  assert.equal(cfg.visionEnrichmentMinCropQuality, 0.6);
});

test("overrides de entorno: URL sin slash final, flags en false, umbrales", () => {
  const cfg = getMatchingConfig(
    env({
      CATALOG_SERVICE_URL: "http://catalogo.local:5000/",
      CATALOG_SERVICE_API_KEY: "  clave  ",
      CATALOG_MATCH_MIN_SCORE: "0.9",
      CATALOG_MATCH_TOP_K: "5",
      CATALOG_REQUEST_TIMEOUT_MS: "1500",
      CATALOG_EXTERNAL_FALLBACK: "false",
      CATALOG_SAVE_EXTERNAL_RESULTS: "false",
      CATALOG_CACHE_ENABLED: "false",
      CATALOG_CACHE_TTL_SECONDS: "60",
      VISION_ENRICHMENT_ENABLED: "false",
      VISION_ENRICHMENT_MIN_CROP_QUALITY: "0.75",
    })
  );
  assert.equal(cfg.catalogServiceUrl, "http://catalogo.local:5000");
  assert.equal(cfg.catalogServiceApiKey, "clave");
  assert.equal(cfg.catalogMatchMinScore, 0.9);
  assert.equal(cfg.catalogMatchTopK, 5);
  assert.equal(cfg.catalogRequestTimeoutMs, 1500);
  assert.equal(cfg.catalogExternalFallback, false);
  assert.equal(cfg.catalogSaveExternalResults, false);
  assert.equal(cfg.catalogCacheEnabled, false);
  assert.equal(cfg.catalogCacheTtlSeconds, 60);
  assert.equal(cfg.visionEnrichmentEnabled, false);
  assert.equal(cfg.visionEnrichmentMinCropQuality, 0.75);
});

test("valores fuera de rango se ignoran (vuelven al default)", () => {
  const cfg = getMatchingConfig(
    env({ CATALOG_MATCH_MIN_SCORE: "1.5", CATALOG_MATCH_TOP_K: "-3" })
  );
  assert.equal(cfg.catalogMatchMinScore, 0.82);
  assert.equal(cfg.catalogMatchTopK, 10);
});

test("el modelo del enrichment reutiliza VISION_MODEL si no hay override (nunca hardcodeado)", () => {
  assert.equal(getMatchingConfig(env({})).visionEnrichmentModel, null);
  assert.equal(
    getMatchingConfig(env({ VISION_MODEL: "modelo-vision" })).visionEnrichmentModel,
    "modelo-vision"
  );
  assert.equal(
    getMatchingConfig(
      env({ VISION_MODEL: "modelo-vision", VISION_ENRICHMENT_MODEL: "modelo-enrich" })
    ).visionEnrichmentModel,
    "modelo-enrich"
  );
});
