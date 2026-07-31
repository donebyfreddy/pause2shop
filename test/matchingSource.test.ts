import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowsExternal,
  resolveFrameAgainstCatalog,
  usageSummary,
  usesCatalog,
} from "../lib/matching/resolveFrame";
import { buildCapabilities, externalAvailability } from "../lib/matching/capabilities";
import { deriveAnalysisConfig, parseConfig, serializeConfig } from "../lib/analysis/categories";
import { catalogResultToVisualMatch } from "../lib/matching/presentation";
import { classifyMatchType, noMatchResult } from "../lib/matching/types";
import type {
  MatchingMode,
  NormalizedProductMatch,
  ProductMatchingProvider,
  ProductMatchingResult,
} from "../lib/matching/types";
import type { DetectedItem } from "../lib/types";

/**
 * Fuente de coincidencias: que cada modo cambie DE VERDAD lo que hace el
 * backend, no solo la etiqueta de la respuesta. Sin red ni base de datos.
 */

/** Entorno mínimo para los tests de capacidades (sin heredar el real). */
function env(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

function item(partial: Partial<DetectedItem> = {}): DetectedItem {
  return {
    name: "reloj metálico",
    category: "watches_jewelry",
    color: "plateado",
    description: "reloj de acero",
    search_query_es: "reloj acero",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.8,
    bounding_box: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
    ...partial,
  };
}

function catalogMatch(finalScore: number): NormalizedProductMatch {
  return {
    source: "catalog",
    productId: "p1",
    title: "Rolex Submariner",
    brand: "Rolex",
    imageUrl: "https://cdn.example/p1.jpg",
    productUrl: "https://tienda.example/p1",
    price: 9500,
    currency: "EUR",
    merchant: null,
    availability: "in_stock",
    matchStage: "embedding",
    provider: "catalog",
    category: null,
    model: null,
    matchType: "probable",
    scores: {
      detectionScore: 0.8,
      visualScore: finalScore,
      textScore: null,
      attributeScore: null,
      brandEvidenceScore: null,
      merchantScore: null,
      finalScore,
    },
    evidence: ["✓ Alta similitud visual con el producto del catálogo"],
  };
}

function catalogResult(finalScore: number, reliable: boolean): ProductMatchingResult {
  return {
    matches: [catalogMatch(finalScore)],
    matchLabel: reliable ? "CATALOG_MATCH" : "SIMILAR",
    providerUsed: "catalog",
    fallbackUsed: false,
    cached: false,
    timings: { catalogMs: 3 },
  };
}

/** Provider de catálogo falso que cuenta cuántas veces se le pregunta. */
function fakeCatalog(result: ProductMatchingResult) {
  const state = { calls: 0 };
  const provider: ProductMatchingProvider = {
    async search() {
      state.calls += 1;
      return result;
    },
  };
  return { provider, state };
}

const FRAME = "data:image/jpeg;base64,AAAA";
/** Recorte falso: evita depender de sharp y de un JPEG real en los tests. */
const fakeCrop = async () => "data:image/jpeg;base64,BBBB";

// --- qué modo toca qué fuente --------------------------------------------

test("external_only es el ÚNICO modo que no consulta el catálogo", () => {
  assert.equal(usesCatalog("external_only"), false);
  for (const mode of ["catalog_only", "catalog_first", "hybrid"] as MatchingMode[]) {
    assert.equal(usesCatalog(mode), true, mode);
  }
});

test("catalog_only es el ÚNICO modo que no puede llamar al proveedor externo", () => {
  assert.equal(allowsExternal("catalog_only"), false);
  for (const mode of ["external_only", "catalog_first", "hybrid"] as MatchingMode[]) {
    assert.equal(allowsExternal(mode), true, mode);
  }
});

// --- pasada de catálogo sobre un frame ------------------------------------

test("un match fiable del catálogo resuelve el objeto y NO queda pendiente", async () => {
  const { provider, state } = fakeCatalog(catalogResult(0.94, true));
  const res = await resolveFrameAgainstCatalog(FRAME, [item()], {
    provider,
    crop: fakeCrop,
  });

  assert.equal(state.calls, 1);
  assert.equal(res.unresolved.length, 0, "no debe quedar nada para el externo");
  assert.equal(res.usage.catalogQueries, 1);
  assert.equal(res.usage.resolvedInternally, 1);
  const match = res.items[0].visual_match;
  assert.ok(match, "el item queda enriquecido con el producto del catálogo");
  assert.equal(match.best_match_source, "catalog");
  assert.equal(match.product_name, "Rolex Submariner");
});

test("un match del catálogo bajo el umbral deja el objeto PENDIENTE del externo", async () => {
  const { provider } = fakeCatalog(catalogResult(0.55, false));
  const res = await resolveFrameAgainstCatalog(FRAME, [item()], {
    provider,
    crop: fakeCrop,
  });

  assert.deepEqual(res.unresolved, [0]);
  assert.equal(res.usage.resolvedInternally, 0);
  assert.equal(res.items[0].visual_match, undefined);
});

test("un objeto sin bounding box no gasta una búsqueda de catálogo", async () => {
  const { provider, state } = fakeCatalog(catalogResult(0.9, true));
  const res = await resolveFrameAgainstCatalog(
    FRAME,
    [item({ bounding_box: undefined })],
    { provider, crop: fakeCrop }
  );

  assert.equal(state.calls, 0);
  assert.deepEqual(res.unresolved, [0]);
  assert.equal(res.usage.catalogQueries, 0);
});

test("un recorte imposible (objeto diminuto) tampoco gasta búsqueda", async () => {
  const { provider, state } = fakeCatalog(catalogResult(0.9, true));
  const res = await resolveFrameAgainstCatalog(FRAME, [item()], {
    provider,
    crop: async () => null,
  });

  assert.equal(state.calls, 0);
  assert.deepEqual(res.unresolved, [0]);
});

test("un objeto que ocupa casi todo el encuadre se busca SIN recortar", async () => {
  // Foto de producto: recortar solo reencodaría la misma imagen y rompería la
  // identidad por hash con la que el catálogo la reconoce.
  const { provider } = fakeCatalog(catalogResult(0.94, true));
  let cropCalls = 0;
  const seen: string[] = [];
  await resolveFrameAgainstCatalog(
    FRAME,
    [item({ bounding_box: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 } })],
    {
      provider: {
        async search(input) {
          seen.push(input.cropDataUrl ?? "");
          return provider.search(input);
        },
      },
      crop: async () => {
        cropCalls += 1;
        return "data:image/jpeg;base64,RECORTADO";
      },
    }
  );

  assert.equal(cropCalls, 0, "no se recorta un objeto que llena el encuadre");
  assert.equal(seen[0], FRAME, "se busca el frame original tal cual");
});

test("un objeto pequeño SÍ se recorta para aislarlo de la escena", async () => {
  const { provider } = fakeCatalog(catalogResult(0.94, true));
  const seen: string[] = [];
  await resolveFrameAgainstCatalog(
    FRAME,
    [item({ bounding_box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } })],
    {
      provider: {
        async search(input) {
          seen.push(input.cropDataUrl ?? "");
          return provider.search(input);
        },
      },
      crop: fakeCrop,
    }
  );

  assert.equal(seen[0], "data:image/jpeg;base64,BBBB");
  assert.notEqual(seen[0], FRAME);
});

test("los aciertos de caché se contabilizan para el control de coste", async () => {
  const { provider } = fakeCatalog({ ...catalogResult(0.94, true), cached: true });
  const res = await resolveFrameAgainstCatalog(FRAME, [item(), item({ name: "otro" })], {
    provider,
    crop: fakeCrop,
  });

  assert.equal(res.usage.catalogQueries, 2);
  assert.equal(res.usage.cacheHits, 2);
});

test("el catálogo vacío no rompe el frame: todo queda pendiente", async () => {
  const { provider } = fakeCatalog(noMatchResult({ providerUsed: "catalog" }));
  const res = await resolveFrameAgainstCatalog(FRAME, [item()], {
    provider,
    crop: fakeCrop,
  });

  assert.deepEqual(res.unresolved, [0]);
  assert.equal(res.items.length, 1, "el objeto detectado no se pierde");
});

// --- presentación ---------------------------------------------------------

test("un match por embedding NO se presenta como exacto; uno por hash sí", () => {
  const embedding = catalogResultToVisualMatch(catalogResult(0.94, true), item());
  assert.equal(embedding?.match_type, "near_exact");
  assert.equal(embedding?.exact_match_found, false);

  const byHash = catalogResultToVisualMatch(
    {
      ...catalogResult(0.94, true),
      matches: [{ ...catalogMatch(0.94), matchStage: "exact_hash" }],
    },
    item()
  );
  assert.equal(byHash?.match_type, "exact");
  assert.equal(byHash?.exact_match_found, true);
});

test("una búsqueda externa nunca se presenta como exacta solo por su score", () => {
  // Mismo score alto, distinta fuente: el catálogo puede afirmar identidad,
  // el externo se queda en "probable" salvo evidencia de imagen idéntica.
  assert.equal(classifyMatchType("CATALOG_MATCH", 0.92, "catalog"), "exact");
  assert.equal(classifyMatchType("EXTERNAL_MATCH", 0.92, "external"), "probable");
  assert.equal(classifyMatchType("SIMILAR", 0.99, "catalog"), "similar");
});

// --- capacidades ----------------------------------------------------------

test("sin credenciales externas, los modos que dependen de la API se deshabilitan", () => {
  const caps = buildCapabilities({
    indexedProducts: 12,
    env: env(),
  });

  assert.equal(caps.external.available, false);
  assert.equal(caps.modes.external_only.available, false);
  assert.equal(caps.modes.hybrid.available, false, "comparar exige dos fuentes");
  // Estos siguen funcionando con solo el catálogo.
  assert.equal(caps.modes.catalog_only.available, true);
  assert.equal(caps.modes.catalog_first.available, true);
  assert.match(caps.modes.external_only.reason ?? "", /credenciales/i);
});

test("con el catálogo vacío se deshabilita catalog_only pero no la búsqueda externa", () => {
  const caps = buildCapabilities({
    indexedProducts: 0,
    env: env({ SEARCHAPI_API_KEY: "k" }),
  });

  assert.equal(caps.modes.catalog_only.available, false);
  assert.match(caps.modes.catalog_only.reason ?? "", /no contiene productos/i);
  assert.equal(caps.modes.external_only.available, true);
  assert.equal(caps.modes.catalog_first.available, true, "cae al externo");
});

test("si no se puede leer el catálogo NO se bloquea ningún modo", () => {
  const caps = buildCapabilities({
    indexedProducts: null,
    env: env({ SEARCHAPI_API_KEY: "k" }),
  });
  for (const mode of Object.keys(caps.modes) as MatchingMode[]) {
    assert.equal(caps.modes[mode].available, true, mode);
  }
});

test("una URL pública inalcanzable invalida la búsqueda externa (el motor no puede descargar el recorte)", () => {
  const external = externalAvailability(
    env({ SEARCHAPI_API_KEY: "k", PUBLIC_MEDIA_BASE_URL: "http://localhost:3000" })
  );
  assert.equal(external.available, false);
  assert.match(external.reason ?? "", /alcanzable/i);
});

// --- configuración compartida --------------------------------------------

test("la fuente de coincidencias viaja en la config serializada del análisis", () => {
  const config = deriveAnalysisConfig(["clothing"], "standard", {
    matchingMode: "hybrid",
  });
  assert.equal(serializeConfig(config).matchingMode, "hybrid");
});

test("el backend acepta el formato legado y rechaza un modo inventado", () => {
  assert.equal(parseConfig({ matchingMode: "catalog-first" }).matchingMode, "catalog_first");
  assert.equal(parseConfig({ matchingMode: "external_only" }).matchingMode, "external_only");
  // Un valor desconocido cae al default en lugar de romper el análisis.
  assert.equal(parseConfig({ matchingMode: "loquesea" }).matchingMode, "catalog_first");
  assert.equal(parseConfig({}).matchingMode, "catalog_first");
});

test("catalog_only apaga la búsqueda inversa: ningún camino puede gastar una llamada", () => {
  const config = deriveAnalysisConfig(["clothing"], "standard", {
    matchingMode: "catalog_only",
  });
  assert.equal(config.reverseImageSearch, false);

  const other = deriveAnalysisConfig(["clothing"], "standard", {
    matchingMode: "catalog_first",
  });
  assert.equal(other.reverseImageSearch, true);
});

// --- control de coste -----------------------------------------------------

test("el resumen de uso reporta las cifras que se piden en admin/logs", () => {
  const line = usageSummary("catalog_first", {
    detections: 3,
    catalogQueries: 3,
    externalCalls: 1,
    cacheHits: 0,
    fallbacks: 1,
    resolvedInternally: 2,
    resolvedExternally: 1,
    unresolved: 0,
    estimatedExternalCostUsd: 0.012,
    timings: {},
  });

  assert.match(line, /modo=catalog_first/);
  assert.match(line, /3 objetos detectados/);
  assert.match(line, /3 búsquedas en catálogo/);
  assert.match(line, /1 llamadas externas/);
  assert.match(line, /2 resueltos internamente/);
  assert.match(line, /0\.0120 USD/);
});
