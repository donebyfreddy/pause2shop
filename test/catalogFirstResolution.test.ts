import { test } from "node:test";
import assert from "node:assert/strict";

import { getMatchingConfig } from "../lib/matching/config";
import {
  buildCatalogBlock,
  buildExternalBlock,
  resolveDetectionMatch,
  shouldCallExternal,
  toProductCandidate,
} from "../lib/matching/resolveDetection";
import type {
  MatchingMode,
  NormalizedProductMatch,
  ProductMatchingProvider,
  ProductMatchingResult,
} from "../lib/matching/types";
import { noMatchResult } from "../lib/matching/types";
import type { DetectedItem } from "../lib/types";
import {
  getMatchingMetrics,
  recordDetectionResolution,
  resetMatchingMetrics,
} from "../lib/server/matchingMetrics";

/**
 * El catálogo propio es la FUENTE PRINCIPAL.
 *
 * Lo que se prueba aquí no es "que haya resultados" sino el orden y la
 * separación: que el catálogo se consulta primero, que un match del catálogo
 * evita la llamada externa de pago, y que catálogo e Internet vuelven en
 * bloques distintos que nadie sobreescribe. El bug que motivó todo esto era
 * precisamente que el resultado externo pisaba al del catálogo.
 */

/* --------------------------------- helpers -------------------------------- */

function env(over: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Entorno LIMPIO: sin esto, un CATALOG_MATCH_THRESHOLD del .env local
  // cambiaría los umbrales y los tests pasarían o fallarían según la máquina.
  return over as NodeJS.ProcessEnv;
}

function item(over: Partial<DetectedItem> = {}): DetectedItem {
  return {
    name: "Bolso tote estampado",
    category: "accessory",
    color: "beige",
    description: "Bolso grande con monograma",
    search_query_es: "bolso tote beige",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.95,
    bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    ...over,
  };
}

function catalogMatch(over: Partial<NormalizedProductMatch> = {}): NormalizedProductMatch {
  return {
    source: "catalog",
    productId: "prod-1",
    title: "Bolso estampado beige",
    brand: "Marca",
    imageUrl: "https://cdn.example/bolso.jpg",
    productUrl: "https://tienda.example/bolso",
    price: 129,
    currency: "EUR",
    merchant: null,
    availability: "in_stock",
    matchStage: "embedding",
    provider: "catalog",
    category: "bag",
    model: null,
    matchType: "probable",
    scores: {
      detectionScore: 0.95,
      visualScore: 0.91,
      textScore: null,
      attributeScore: 0.8,
      brandEvidenceScore: null,
      merchantScore: null,
      finalScore: 0.91,
    },
    evidence: ["✓ Alta similitud visual con el producto del catálogo"],
    ...over,
  };
}

function externalMatch(over: Partial<NormalizedProductMatch> = {}): NormalizedProductMatch {
  return {
    source: "external",
    productId: null,
    title: "Gucci GG Supreme tote",
    brand: "Gucci",
    imageUrl: "https://cdn.ext/gucci.jpg",
    productUrl: "https://shop.ext/gucci-tote",
    price: 1290,
    currency: "EUR",
    merchant: "shop.ext",
    availability: null,
    matchStage: null,
    provider: "searchapi_google_lens",
    category: null,
    model: null,
    matchType: "probable",
    scores: {
      detectionScore: 0.95,
      visualScore: 0.8,
      textScore: null,
      attributeScore: null,
      brandEvidenceScore: null,
      merchantScore: null,
      finalScore: 0.86,
    },
    evidence: [],
    ...over,
  };
}

/** Provider de mentira que cuenta cuántas veces se le llama. */
function provider(
  result: ProductMatchingResult,
  calls: { n: number }
): ProductMatchingProvider {
  return {
    async search() {
      calls.n += 1;
      return result;
    },
  };
}

const CATALOG_HIT: ProductMatchingResult = {
  matches: [catalogMatch()],
  matchLabel: "CATALOG_MATCH",
  providerUsed: "catalog",
  fallbackUsed: false,
  cached: false,
  timings: { catalogMs: 12 },
};

const CATALOG_WEAK: ProductMatchingResult = {
  matches: [catalogMatch({ scores: { ...catalogMatch().scores, finalScore: 0.61 } })],
  matchLabel: "SIMILAR",
  providerUsed: "catalog",
  fallbackUsed: false,
  cached: false,
  timings: { catalogMs: 9 },
};

const CATALOG_EMPTY: ProductMatchingResult = {
  matches: [],
  matchLabel: "NO_MATCH",
  providerUsed: "catalog",
  fallbackUsed: false,
  cached: false,
  timings: { catalogMs: 4 },
};

const EXTERNAL_HIT: ProductMatchingResult = {
  matches: [externalMatch()],
  matchLabel: "EXTERNAL_MATCH",
  providerUsed: "searchapi_google_lens",
  fallbackUsed: false,
  cached: false,
  timings: { lensMs: 800 },
};

async function resolve(
  mode: MatchingMode,
  opts: {
    catalog: ProductMatchingResult;
    external?: ProductMatchingResult;
    envOver?: Record<string, string>;
    forceExternal?: boolean;
    withExternalProvider?: boolean;
  }
) {
  const catalogCalls = { n: 0 };
  const externalCalls = { n: 0 };
  const config = getMatchingConfig(env(opts.envOver));
  const out = await resolveDetectionMatch({
    item: item(),
    detectionId: "det-1",
    timestampSeconds: 42.5,
    cropDataUrl: "data:image/png;base64,AAA",
    mode,
    config,
    catalog: provider(opts.catalog, catalogCalls),
    external:
      opts.withExternalProvider === false
        ? undefined
        : provider(opts.external ?? noMatchResult(), externalCalls),
    forceExternal: opts.forceExternal,
  });
  return { out, catalogCalls, externalCalls, config };
}

/* ------------------- 1. el catálogo se consulta primero ------------------- */

test("el catálogo se consulta SIEMPRE (salvo external_only) y antes que Internet", async () => {
  for (const mode of ["catalog_only", "catalog_first", "catalog_and_external"] as const) {
    const { catalogCalls, out } = await resolve(mode, { catalog: CATALOG_HIT });
    assert.equal(catalogCalls.n, 1, `${mode} debe consultar el catálogo`);
    assert.notEqual(out.detection.catalog.status, "not_requested");
  }

  const { catalogCalls, out } = await resolve("external_only", {
    catalog: CATALOG_HIT,
    external: EXTERNAL_HIT,
  });
  assert.equal(catalogCalls.n, 0, "external_only no consulta el catálogo");
  assert.equal(out.detection.catalog.status, "not_requested");
});

/* --------- 2. sobre el umbral NO se llama a Internet (coste cero) --------- */

test("catalog_first: si el catálogo supera el umbral NO se llama a Internet", async () => {
  const { out, externalCalls } = await resolve("catalog_first", {
    catalog: CATALOG_HIT,
    external: EXTERNAL_HIT,
  });

  assert.equal(externalCalls.n, 0, "no debe gastarse ni una llamada externa");
  assert.equal(out.detection.catalog.status, "matched");
  assert.equal(out.detection.catalog.selected?.source, "catalog");
  assert.equal(out.detection.external.status, "not_requested");
  assert.equal(out.detection.external.candidates.length, 0);
  assert.equal(out.usage.externalCalls, 0);
  assert.equal(out.usage.estimatedExternalCostUsd, 0);
});

/* --------------- 3. score bajo → unresolved, no un match malo -------------- */

test("score por debajo del umbral → unresolved, y el candidato NO se asciende", async () => {
  const { out } = await resolve("catalog_first", {
    catalog: CATALOG_WEAK,
    envOver: { EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "false" },
  });

  assert.equal(out.detection.catalog.status, "unresolved");
  assert.equal(out.detection.catalog.selected, undefined);
  // El candidato débil sigue disponible como alternativa, pero degradado a
  // "similar": por debajo del umbral no se afirma coincidencia.
  assert.equal(out.detection.catalog.candidates.length, 1);
  assert.equal(out.detection.catalog.candidates[0].matchType, "similar");
  assert.equal(out.usage.unresolved, 1);
});

test("catálogo sin candidatos → status empty (distinto de unresolved)", async () => {
  const { out } = await resolve("catalog_only", { catalog: CATALOG_EMPTY });
  assert.equal(out.detection.catalog.status, "empty");
  assert.match(out.detection.catalog.unresolvedReason ?? "", /indexados/i);
});

/* ------------------------ 4. el fallback externo funciona ----------------- */

test("catalog_first: sin match fiable en el catálogo SÍ cae al externo", async () => {
  const { out, externalCalls } = await resolve("catalog_first", {
    catalog: CATALOG_WEAK,
    external: EXTERNAL_HIT,
    envOver: { EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "true" },
  });

  assert.equal(externalCalls.n, 1);
  assert.equal(out.detection.external.status, "matched");
  assert.equal(out.detection.external.selected?.source, "external");
  assert.equal(out.usage.fallbacks, 1);
  assert.ok(out.usage.estimatedExternalCostUsd > 0);
});

test("fallback automático desactivado: el bloque externo espera al usuario", async () => {
  const { out, externalCalls } = await resolve("catalog_first", {
    catalog: CATALOG_WEAK,
    external: EXTERNAL_HIT,
    envOver: { EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "false" },
  });

  assert.equal(externalCalls.n, 0);
  assert.equal(out.detection.external.status, "not_requested");
});

test("EXTERNAL_SEARCH_ENABLED=false desactiva Internet incluso a petición", async () => {
  const { out, externalCalls } = await resolve("catalog_first", {
    catalog: CATALOG_WEAK,
    external: EXTERNAL_HIT,
    envOver: { EXTERNAL_SEARCH_ENABLED: "false" },
    forceExternal: true,
  });

  assert.equal(externalCalls.n, 0);
  assert.equal(out.detection.external.status, "disabled");
});

test("el usuario puede forzar Internet aunque el catálogo haya resuelto", async () => {
  const { out, externalCalls } = await resolve("catalog_first", {
    catalog: CATALOG_HIT,
    external: EXTERNAL_HIT,
    forceExternal: true,
  });

  assert.equal(externalCalls.n, 1);
  // El match del catálogo NO desaparece por haber mirado fuera.
  assert.equal(out.detection.catalog.status, "matched");
  assert.equal(out.detection.external.status, "matched");
});

test("catalog_only NO sale fuera ni a petición del usuario", async () => {
  const { out, externalCalls } = await resolve("catalog_only", {
    catalog: CATALOG_WEAK,
    external: EXTERNAL_HIT,
    forceExternal: true,
  });
  assert.equal(externalCalls.n, 0);
  assert.equal(out.detection.external.status, "disabled");
});

test("sin motor externo configurado el bloque queda disabled, no error", async () => {
  const { out } = await resolve("catalog_first", {
    catalog: CATALOG_WEAK,
    withExternalProvider: false,
  });
  assert.equal(out.detection.external.status, "disabled");
});

/* ------- 5-7. bloques separados: la procedencia nunca se mezcla ---------- */

test("catálogo e Internet vuelven en bloques SEPARADOS, sin candidatos cruzados", async () => {
  const { out } = await resolve("catalog_and_external", {
    catalog: CATALOG_WEAK,
    external: EXTERNAL_HIT,
  });

  const { catalog, external } = out.detection;
  assert.ok(catalog.candidates.length > 0);
  assert.ok(external.candidates.length > 0);

  // Cada candidato lleva SU fuente y ninguno aparece en el bloque del otro.
  assert.ok(catalog.candidates.every((c) => c.source === "catalog"));
  assert.ok(external.candidates.every((c) => c.source === "external"));

  const catalogIds = new Set(catalog.candidates.map((c) => c.id));
  assert.ok(
    external.candidates.every((c) => !catalogIds.has(c.id)),
    "ningún candidato externo puede colarse en el bloque del catálogo"
  );
});

test("cada bloque aplica SU propio umbral", async () => {
  const { out, config } = await resolve("catalog_and_external", {
    catalog: CATALOG_HIT,
    external: EXTERNAL_HIT,
    envOver: { CATALOG_MATCH_THRESHOLD: "0.9", EXTERNAL_MATCH_THRESHOLD: "0.7" },
  });
  assert.equal(out.detection.catalog.threshold, 0.9);
  assert.equal(out.detection.external.threshold, 0.7);
  assert.equal(config.catalogMatchMinScore, 0.9);
});

test("un candidato externo con score alto NO asciende si el motor no lo verificó", () => {
  const config = getMatchingConfig(env({ EXTERNAL_MATCH_THRESHOLD: "0.7" }));
  // Score 0.86 ≥ 0.7, pero la etiqueta es SIMILAR: la verificación visual dijo
  // que no es el mismo producto y eso manda sobre el número.
  const block = buildExternalBlock(
    { ...EXTERNAL_HIT, matchLabel: "SIMILAR" },
    item(),
    config,
    { status: "loading" }
  );
  assert.equal(block.status, "unresolved");
  assert.equal(block.selected, undefined);
  assert.equal(block.candidates[0].matchType, "similar");
});

/* --------------- 8-9. identidad y timestamp de la detección --------------- */

test("la detección conserva su id, su bounding box y su timestamp", async () => {
  const { out } = await resolve("catalog_first", { catalog: CATALOG_HIT });
  const d = out.detection;
  assert.equal(d.detectionId, "det-1");
  assert.equal(d.label, "Bolso tote estampado");
  assert.equal(d.confidence, 0.95);
  assert.deepEqual(d.boundingBox, { x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  // El timestamp es lo que permite no mezclar resultados de frames distintos.
  assert.equal(d.timestampSeconds, 42.5);
});

test("en análisis de imagen el timestamp es null, no 0", async () => {
  const config = getMatchingConfig(env());
  const out = await resolveDetectionMatch({
    item: item(),
    detectionId: "img-1",
    mode: "catalog_only",
    config,
    catalog: provider(CATALOG_HIT, { n: 0 }),
  });
  assert.equal(out.detection.timestampSeconds, null);
});

/* -------------- 10. un resultado externo no se publica solo -------------- */

test("un candidato externo nunca se marca como producto del catálogo", async () => {
  const { out } = await resolve("catalog_first", {
    catalog: CATALOG_EMPTY,
    external: EXTERNAL_HIT,
    envOver: { EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "true" },
  });
  const selected = out.detection.external.selected;
  assert.ok(selected);
  assert.equal(selected.source, "external");
  // No hay productId: no es una ficha de nuestro catálogo.
  assert.ok(!selected.id.startsWith("catalog:"));
  // Y el bloque del catálogo sigue vacío: no se ha "creado" un producto.
  assert.equal(out.detection.catalog.status, "empty");
  assert.equal(out.detection.catalog.selected, undefined);
});

test("la ficha de dataset se marca como no comprable", () => {
  const config = getMatchingConfig(env());
  const block = buildCatalogBlock(
    { ...CATALOG_HIT, matches: [catalogMatch({ isDemoProduct: true })] },
    item(),
    config,
    { requested: true }
  );
  assert.equal(block.selected?.isDemoProduct, true);
});

/* ---------------- 11. caché: no se repite la llamada externa -------------- */

test("un resultado cacheado cuenta como cache hit y no suma coste externo", async () => {
  const { out } = await resolve("catalog_first", {
    catalog: CATALOG_EMPTY,
    external: { ...EXTERNAL_HIT, cached: true },
    envOver: { EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "true" },
  });
  assert.equal(out.usage.externalCalls, 1);
  assert.equal(out.usage.cacheHits, 1);
  assert.equal(
    out.usage.estimatedExternalCostUsd,
    0,
    "un cache hit no puede facturar como llamada nueva"
  );
});

/* ------------- 12. errores parciales conservan lo que sí valía ------------ */

test("catálogo caído: se marca error y el externo sigue dando resultados", async () => {
  const catalogDown: ProductMatchingResult = noMatchResult({
    providerUsed: null,
    warnings: ["Catálogo no disponible (timeout): se agotó el tiempo"],
  });
  const { out } = await resolve("catalog_first", {
    catalog: catalogDown,
    external: EXTERNAL_HIT,
    envOver: { EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "true" },
  });

  assert.equal(out.detection.catalog.status, "error");
  assert.match(out.detection.catalog.unresolvedReason ?? "", /no disponible/i);
  // El fallo del catálogo NO impide el resultado externo.
  assert.equal(out.detection.external.status, "matched");
});

test("Internet caído: el match del catálogo se conserva intacto", async () => {
  const { out } = await resolve("catalog_and_external", {
    catalog: CATALOG_HIT,
    external: noMatchResult({
      providerUsed: null,
      warnings: ["Pipeline externo falló: timeout"],
    }),
  });

  assert.equal(out.detection.catalog.status, "matched");
  assert.equal(out.detection.catalog.selected?.title, "Bolso estampado beige");
  assert.notEqual(out.detection.external.status, "matched");
});

/* ----------------------- decisión de gasto, aislada ---------------------- */

test("shouldCallExternal: tabla de decisión completa", () => {
  const config = getMatchingConfig(env({ EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "true" }));
  const base = { config, hasExternalProvider: true, forceExternal: false };

  // catalog_only: nunca.
  assert.equal(
    shouldCallExternal({ ...base, mode: "catalog_only", catalogMatched: false }).call,
    false
  );
  // Modos de dos fuentes: siempre, por diseño (no es un fallback).
  const both = shouldCallExternal({
    ...base,
    mode: "catalog_and_external",
    catalogMatched: true,
  });
  assert.equal(both.call, true);
  assert.equal(both.isFallback, false);
  // catalog_first con match: no se llama.
  assert.equal(
    shouldCallExternal({ ...base, mode: "catalog_first", catalogMatched: true }).call,
    false
  );
  // catalog_first sin match: se llama Y cuenta como fallback.
  const fb = shouldCallExternal({
    ...base,
    mode: "catalog_first",
    catalogMatched: false,
  });
  assert.equal(fb.call, true);
  assert.equal(fb.isFallback, true);
});

/* --------------------- normalización a ProductCandidate ------------------ */

test("toProductCandidate: identidad por hash es exact; bajo umbral es similar", () => {
  const hashHit = toProductCandidate(
    catalogMatch({ matchStage: "exact_hash" }),
    0,
    0.8,
    item()
  );
  assert.equal(hashHit.matchType, "exact");

  // Un coseno altísimo entre embeddings NO es identidad: el techo es "probable".
  // Sin este tope, una prenda muy parecida se anunciaba como "exacta".
  const highEmbedding = toProductCandidate(
    catalogMatch({
      matchStage: "embedding",
      scores: { ...catalogMatch().scores, finalScore: 0.97 },
    }),
    0,
    0.8,
    item()
  );
  assert.equal(highEmbedding.matchType, "probable");

  const weak = toProductCandidate(
    catalogMatch({ scores: { ...catalogMatch().scores, finalScore: 0.5 } }),
    0,
    0.8,
    item()
  );
  assert.equal(weak.matchType, "similar");
});

test("toProductCandidate: el color del CATÁLOGO gana al detectado", () => {
  const withCatalogColor = toProductCandidate(
    catalogMatch({ catalogColor: "camel" }),
    0,
    0.8,
    item({ color: "beige" })
  );
  assert.equal(withCatalogColor.color, "camel");

  // Sin color en la ficha se usa el detectado: es lo único que consta.
  const withoutCatalogColor = toProductCandidate(
    catalogMatch({ catalogColor: null }),
    0,
    0.8,
    item({ color: "beige" })
  );
  assert.equal(withoutCatalogColor.color, "beige");
});

/* -------------------------------- métricas ------------------------------- */

test("métricas: tasa de resolución del catálogo y coste externo evitado", async () => {
  resetMatchingMetrics();

  const hit = await resolve("catalog_first", { catalog: CATALOG_HIT });
  recordDetectionResolution({
    detection: hit.out.detection,
    category: "accessory",
    durationMs: 100,
    externalCalled: false,
    externalFallback: false,
  });

  const miss = await resolve("catalog_first", {
    catalog: CATALOG_EMPTY,
    external: EXTERNAL_HIT,
    envOver: { EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "true" },
  });
  recordDetectionResolution({
    detection: miss.out.detection,
    category: "accessory",
    durationMs: 900,
    externalCalled: true,
    externalFallback: true,
  });

  const m = getMatchingMetrics();
  assert.equal(m.detections, 2);
  assert.equal(m.resolvedByCatalog, 1);
  assert.equal(m.resolvedByExternal, 1);
  assert.equal(m.catalogResolutionRate, 0.5);
  assert.equal(m.externalFallbacks, 1);
  assert.equal(m.averageDurationMs, 500);
  // Un objeto resuelto en casa = una llamada externa que no se pagó.
  assert.ok(m.externalCostAvoidedUsd > 0);
  assert.ok(m.externalCostUsd > 0);

  resetMatchingMetrics();
});

test("métricas: lo no resuelto alimenta el ranking de categorías a indexar", async () => {
  resetMatchingMetrics();
  const { out } = await resolve("catalog_only", { catalog: CATALOG_EMPTY });
  recordDetectionResolution({
    detection: out.detection,
    category: "footwear",
    externalCalled: false,
    externalFallback: false,
  });
  const m = getMatchingMetrics();
  assert.equal(m.unresolved, 1);
  assert.deepEqual(m.topUnresolvedCategories, [{ category: "footwear", count: 1 }]);
  resetMatchingMetrics();
});
