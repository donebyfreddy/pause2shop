import assert from "node:assert/strict";
import { test } from "node:test";
import { getMatchingConfig, isMatchingMode } from "../lib/matching/config";

// Config de matching: modos, defaults y saneado de valores raros. Sin red.

function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

test("sin PRODUCT_MATCHING_MODE el default es external-only (no cambia el comportamiento actual)", () => {
  const cfg = getMatchingConfig(env({}));
  assert.equal(cfg.mode, "external-only");
});

test("un modo desconocido cae a external-only en vez de romper", () => {
  assert.equal(getMatchingConfig(env({ PRODUCT_MATCHING_MODE: "catalogo" })).mode, "external-only");
  assert.equal(getMatchingConfig(env({ PRODUCT_MATCHING_MODE: "" })).mode, "external-only");
});

test("los cuatro modos válidos se respetan", () => {
  for (const mode of ["catalog-only", "catalog-first", "external-only", "hybrid"] as const) {
    assert.equal(getMatchingConfig(env({ PRODUCT_MATCHING_MODE: mode })).mode, mode);
    assert.equal(isMatchingMode(mode), true);
  }
  assert.equal(isMatchingMode("catalog"), false);
  assert.equal(isMatchingMode(null), false);
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
