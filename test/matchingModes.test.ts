import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogClient, ExternalProductInput } from "../lib/matching/catalogClient";
import { getMatchingConfig } from "../lib/matching/config";
import {
  ExternalVisualSearchProvider,
  externalOutcomeToResult,
} from "../lib/matching/externalProvider";
import {
  CatalogFirstMatchingProvider,
  HybridMatchingProvider,
} from "../lib/matching/hybridProvider";
import { getMatchingProvider } from "../lib/matching";
import type {
  NormalizedProductMatch,
  ProductMatchingInput,
  ProductMatchingProvider,
  ProductMatchingResult,
} from "../lib/matching/types";
import { noMatchResult } from "../lib/matching/types";
import {
  InMemoryExternalCandidateStore,
  type ExternalCandidateStore,
} from "../lib/videoProcessing/candidateStore";
import type { RankedCandidate, VisualMatch } from "../lib/visualSearch/types";
import type { DetectedItem } from "../lib/types";

/**
 * Lógica de los modos compuestos (catalog-first / hybrid) con providers y
 * cliente FAKE inyectados — sin red ni pipeline real.
 */

function item(partial: Partial<DetectedItem> = {}): DetectedItem {
  return {
    name: "zapatilla",
    category: "calzado",
    color: "blanco",
    description: "zapatilla blanca",
    search_query_es: "zapatilla blanca",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.7,
    ...partial,
  };
}

const INPUT: ProductMatchingInput = { item: item(), cropDataUrl: "data:image/png;base64,YWJj" };

function match(partial: Partial<NormalizedProductMatch>): NormalizedProductMatch {
  return {
    source: "catalog",
    productId: "p1",
    title: "Producto",
    brand: null,
    imageUrl: null,
    productUrl: "https://tienda.example/p1",
    price: null,
    currency: null,
    merchant: null,
    availability: "unknown",
    matchStage: "embedding",
    provider: "catalog",
    category: null,
    model: null,
    matchType: "probable",
    scores: {
      detectionScore: 0.7,
      visualScore: null,
      textScore: null,
      attributeScore: null,
      brandEvidenceScore: null,
      merchantScore: null,
      finalScore: 0.9,
    },
    evidence: [],
    ...partial,
  };
}

/** Provider fake que cuenta llamadas y devuelve un resultado fijo. */
function fakeProvider(result: ProductMatchingResult): ProductMatchingProvider & { calls: number } {
  const p = {
    calls: 0,
    async search(): Promise<ProductMatchingResult> {
      p.calls++;
      return result;
    },
  };
  return p;
}

/**
 * Almacén de candidatos externos aislado por test.
 *
 * `saveExternalResult` NO escribe en el catálogo: deja el resultado externo en
 * el almacén de candidatos con estado `review_required`, y solo el PATCH de
 * aprobación (`/api/catalog/candidates/[id]`) lo ingiere. Es la pieza que
 * implementa "un resultado externo nunca se publica solo", así que es aquí
 * donde hay que comprobar el guardado, no en el cliente del catálogo.
 *
 * Se pisa el singleton global porque `getExternalCandidateStore()` elegiría el
 * de Postgres si el entorno trae `DATABASE_URL` — y este test no debe tocar la
 * red ni depender de qué haya en `.env.local`.
 */
function isolatedCandidateStore(): InMemoryExternalCandidateStore {
  const store = new InMemoryExternalCandidateStore();
  (globalThis as unknown as {
    __pauseExternalCandidateStore?: ExternalCandidateStore;
  }).__pauseExternalCandidateStore = store;
  return store;
}

/** Cliente fake del catálogo: solo entra en juego al APROBAR un candidato. */
function fakeClient(): CatalogClient & { saved: ExternalProductInput[] } {
  const saved: ExternalProductInput[] = [];
  return {
    saved,
    async saveExternalProduct(body: ExternalProductInput) {
      saved.push(body);
      return { ok: true as const, data: { productId: "nuevo", deduplicated: false } };
    },
  } as unknown as CatalogClient & { saved: ExternalProductInput[] };
}

const config = getMatchingConfig({} as unknown as NodeJS.ProcessEnv);
const autoFallbackConfig = getMatchingConfig({
  EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "true",
} as unknown as NodeJS.ProcessEnv);

function catalogHit(finalScore = 0.9, stage: NormalizedProductMatch["matchStage"] = "embedding"): ProductMatchingResult {
  return {
    matches: [match({ scores: { ...match({}).scores, finalScore }, matchStage: stage })],
    matchLabel: finalScore >= config.catalogMatchMinScore ? "CATALOG_MATCH" : "SIMILAR",
    providerUsed: "catalog",
    fallbackUsed: false,
    cached: false,
    timings: { catalogMs: 5 },
  };
}

function externalHit(finalScore = 0.8): ProductMatchingResult {
  return {
    matches: [
      match({
        source: "external",
        productId: null,
        matchStage: null,
        provider: "searchapi_google_lens",
        title: "Producto externo",
        // URL distinta a la del catálogo: son productos DISTINTOS. Si
        // compartieran URL, el dedup de hybrid los fusionaría (y con razón).
        productUrl: "https://otra-tienda.example/x9",
        // Imagen obligatoria: `saveExternalResult` descarta lo que no tenga
        // imagen Y URL comercial verificables.
        imageUrl: "https://otra-tienda.example/x9.jpg",
        scores: { ...match({}).scores, finalScore },
      }),
    ],
    matchLabel: "EXTERNAL_MATCH",
    providerUsed: "searchapi_google_lens",
    fallbackUsed: false,
    cached: false,
    timings: { lensMs: 100 },
  };
}

// --- catalog-first ----------------------------------------------------------

test("catalog-first: match del catálogo suficiente NO llama al pipeline externo", async () => {
  const catalog = fakeProvider(catalogHit(0.9));
  const external = fakeProvider(externalHit());
  const client = fakeClient();
  const provider = new CatalogFirstMatchingProvider({
    catalog,
    external,
    client,
    config: autoFallbackConfig,
  });

  const result = await provider.search(INPUT);
  assert.equal(result.matchLabel, "CATALOG_MATCH");
  assert.equal(external.calls, 0);
  assert.equal(result.fallbackUsed, false);
  assert.equal(client.saved.length, 0);
});

test("catalog-first: sin match del catálogo SÍ llama al externo y GUARDA el resultado fiable", async () => {
  const catalog = fakeProvider(noMatchResult({ providerUsed: "catalog" }));
  const external = fakeProvider(externalHit(0.8));
  const client = fakeClient();
  const candidateStore = isolatedCandidateStore();
  const provider = new CatalogFirstMatchingProvider({
    catalog,
    external,
    client,
    config: autoFallbackConfig,
  });

  const result = await provider.search(INPUT);
  assert.equal(external.calls, 1);
  assert.equal(result.matchLabel, "EXTERNAL_MATCH");
  assert.equal(result.fallbackUsed, true);

  // Queda como CANDIDATO pendiente de revisión, no publicado en el catálogo.
  const candidates = await candidateStore.list();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].provider, "searchapi_google_lens");
  assert.equal(candidates[0].title, "Producto externo");
  assert.equal(candidates[0].status, "review_required");
  // Sin evidencia de marca → la marca NO viaja al catálogo.
  assert.equal(candidates[0].brand ?? null, null);
  // Y el catálogo no ha recibido nada por su cuenta.
  assert.equal(client.saved.length, 0);
});

test("catalog-first: resultado externo NO fiable (SIMILAR) no se guarda", async () => {
  const catalog = fakeProvider(noMatchResult({}));
  const weakExternal: ProductMatchingResult = { ...externalHit(0.4), matchLabel: "SIMILAR" };
  const external = fakeProvider(weakExternal);
  const client = fakeClient();
  const candidateStore = isolatedCandidateStore();
  const provider = new CatalogFirstMatchingProvider({
    catalog,
    external,
    client,
    config: autoFallbackConfig,
  });

  const result = await provider.search(INPUT);
  assert.equal(result.matchLabel, "SIMILAR");
  assert.equal((await candidateStore.list()).length, 0);
  assert.equal(client.saved.length, 0);
});

test("catalog-first: CATALOG_EXTERNAL_FALLBACK=false no consulta al externo", async () => {
  const noFallbackConfig = getMatchingConfig({ CATALOG_EXTERNAL_FALLBACK: "false" } as unknown as NodeJS.ProcessEnv);
  const catalog = fakeProvider(catalogHit(0.6)); // SIMILAR, bajo el umbral
  const external = fakeProvider(externalHit());
  const provider = new CatalogFirstMatchingProvider({
    catalog, external, client: fakeClient(), config: noFallbackConfig,
  });

  const result = await provider.search(INPUT);
  assert.equal(result.matchLabel, "SIMILAR");
  assert.equal(external.calls, 0);
});

test("catalog-first: CATALOG_SAVE_EXTERNAL_RESULTS=false no ingiere aunque el externo sea fiable", async () => {
  const noSaveConfig = getMatchingConfig({
    CATALOG_SAVE_EXTERNAL_RESULTS: "false",
    EXTERNAL_SEARCH_AUTOMATIC_FALLBACK: "true",
  } as unknown as NodeJS.ProcessEnv);
  const client = fakeClient();
  const candidateStore = isolatedCandidateStore();
  const provider = new CatalogFirstMatchingProvider({
    catalog: fakeProvider(noMatchResult({})),
    external: fakeProvider(externalHit(0.9)),
    client,
    config: noSaveConfig,
  });
  await provider.search(INPUT);
  assert.equal((await candidateStore.list()).length, 0);
  assert.equal(client.saved.length, 0);
});

// --- resiliencia -------------------------------------------------------------

test("resiliencia: catálogo caído (NO_MATCH con warning) → fallback externo y el warning se conserva", async () => {
  const catalogDown = fakeProvider(
    noMatchResult({ warnings: ["Catálogo no disponible (network): fallo"] })
  );
  const external = fakeProvider(externalHit());
  const provider = new CatalogFirstMatchingProvider({
    catalog: catalogDown,
    external,
    client: fakeClient(),
    config: autoFallbackConfig,
  });

  const result = await provider.search(INPUT);
  assert.equal(result.matchLabel, "EXTERNAL_MATCH");
  assert.equal(result.fallbackUsed, true);
  assert.match(result.warnings?.[0] ?? "", /Catálogo no disponible/);
});

test("resiliencia: catálogo con SIMILAR y externo sin nada → se devuelven los similares del catálogo", async () => {
  const catalog = fakeProvider(catalogHit(0.6)); // SIMILAR
  const external = fakeProvider(noMatchResult({}));
  const provider = new CatalogFirstMatchingProvider({
    catalog,
    external,
    client: fakeClient(),
    config: autoFallbackConfig,
  });
  const result = await provider.search(INPUT);
  assert.equal(result.matchLabel, "SIMILAR");
  assert.equal(result.matches[0].source, "catalog");
  assert.equal(result.fallbackUsed, true);
});

test("resiliencia: ambos caminos fallan → NO_MATCH sin excepción", async () => {
  const provider = new CatalogFirstMatchingProvider({
    catalog: fakeProvider(noMatchResult({ warnings: ["catálogo caído"] })),
    external: fakeProvider(noMatchResult({ warnings: ["externo caído"] })),
    client: fakeClient(),
    config: autoFallbackConfig,
  });
  const result = await provider.search(INPUT);
  assert.equal(result.matchLabel, "NO_MATCH");
  assert.equal(result.matches.length, 0);
});

test("resiliencia: el delegado externo que LANZA se degrada a NO_MATCH", async () => {
  const provider = new ExternalVisualSearchProvider(async () => {
    throw new Error("boom del pipeline");
  });
  const result = await provider.search(INPUT);
  assert.equal(result.matchLabel, "NO_MATCH");
  assert.match(result.warnings?.[0] ?? "", /boom del pipeline/);
});

// --- hybrid -------------------------------------------------------------------

test("hybrid: ranking común ordenado por finalScore SIN mezclar procedencia", async () => {
  const catalog = fakeProvider(catalogHit(0.6)); // SIMILAR del catálogo
  const external = fakeProvider(externalHit(0.8));
  const provider = new HybridMatchingProvider({
    catalog, external, client: fakeClient(), config,
  });

  const result = await provider.search(INPUT);
  assert.equal(external.calls, 1);
  assert.equal(result.matches.length, 2);
  // Orden por score: externo (0.8) antes que catálogo (0.6).
  assert.equal(result.matches[0].source, "external");
  assert.equal(result.matches[1].source, "catalog");
  // Cada match conserva su source; ninguno pierde la procedencia.
  assert.ok(result.matches.every((m) => m.source === "catalog" || m.source === "external"));
  assert.equal(result.matchLabel, "EXTERNAL_MATCH");
  assert.equal(result.providerUsed, "catalog+searchapi_google_lens");
});

test("hybrid: identidad por hash en el catálogo NO justifica la búsqueda externa de pago", async () => {
  const catalog = fakeProvider(catalogHit(0.95, "exact_hash"));
  const external = fakeProvider(externalHit());
  const provider = new HybridMatchingProvider({
    catalog, external, client: fakeClient(), config,
  });

  const result = await provider.search(INPUT);
  assert.equal(external.calls, 0);
  assert.equal(result.matchLabel, "CATALOG_MATCH");
  assert.equal(result.matches.every((m) => m.source === "catalog"), true);
});

test("hybrid: el mismo producto en ambas fuentes se deduplica y gana el de mayor score", async () => {
  const sameUrl = "https://tienda.example/p1";
  const provider = new HybridMatchingProvider({
    catalog: fakeProvider(catalogHit(0.6)),
    external: fakeProvider({
      ...externalHit(0.8),
      matches: [
        match({
          source: "external",
          productId: null,
          matchStage: null,
          provider: "searchapi_google_lens",
          productUrl: sameUrl,
          scores: { ...match({}).scores, finalScore: 0.8 },
        }),
      ],
    }),
    client: fakeClient(),
    config,
  });

  const result = await provider.search(INPUT);
  assert.equal(result.matches.length, 1, "el mismo producto no se lista dos veces");
  assert.equal(result.matches[0].source, "external");
  assert.equal(result.matches[0].scores.finalScore, 0.8);
});

test("hybrid: a igualdad de score gana el catálogo (fuente verificada)", async () => {
  const sameUrl = "https://tienda.example/p1";
  const provider = new HybridMatchingProvider({
    catalog: fakeProvider(catalogHit(0.7)),
    external: fakeProvider({
      ...externalHit(0.7),
      matches: [
        match({
          source: "external",
          productId: null,
          matchStage: null,
          provider: "searchapi_google_lens",
          productUrl: sameUrl,
          scores: { ...match({}).scores, finalScore: 0.7 },
        }),
      ],
    }),
    client: fakeClient(),
    config,
  });

  const result = await provider.search(INPUT);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].source, "catalog");
});

test("hybrid: catálogo caído → siguen llegando los matches externos", async () => {
  const provider = new HybridMatchingProvider({
    catalog: fakeProvider(noMatchResult({ warnings: ["catálogo caído"] })),
    external: fakeProvider(externalHit(0.8)),
    client: fakeClient(),
    config,
  });
  const result = await provider.search(INPUT);
  assert.equal(result.matchLabel, "EXTERNAL_MATCH");
  assert.equal(result.matches[0].source, "external");
});

// --- orquestador y normalización externa ---------------------------------------

test("getMatchingProvider devuelve la estrategia pedida", async () => {
  const catalog = fakeProvider(catalogHit(0.9));
  const external = fakeProvider(externalHit());

  const catalogOnly = getMatchingProvider("catalog_only", { config, catalog, external });
  assert.equal((await catalogOnly.search(INPUT)).matchLabel, "CATALOG_MATCH");
  assert.equal(external.calls, 0);

  const externalOnly = getMatchingProvider("external_only", { config, catalog, external });
  assert.equal((await externalOnly.search(INPUT)).matchLabel, "EXTERNAL_MATCH");
  assert.equal(external.calls, 1);
});

test("externalOutcomeToResult normaliza el VisualMatch del pipeline actual", () => {
  const ranked: RankedCandidate = {
    source: "searchapi_google_lens",
    title: "Sneaker X",
    link: "https://tienda.example/x",
    store: "Tienda",
    domain: "tienda.example",
    imageUrl: "https://tienda.example/x.jpg",
    price: 79,
    currency: "EUR",
    brand: "MarcaX",
    position: 1,
    exactImageMatch: true,
    queryUsed: null,
    score: 120,
    matchType: "near_exact",
    scoreBreakdown: { exact_image_match: 40, trusted_store: 10 },
  };
  const visualMatch: VisualMatch = {
    exact_match_found: true,
    match_type: "near_exact",
    product_name: "Sneaker X",
    brand: "MarcaX",
    color: "blanco",
    product_images: [],
    purchase_links: [],
    best_match_score: 120,
    match_confidence: 0.8,
    evidence: ["✓ Imagen idéntica según el motor visual"],
    best_match_source: "searchapi_google_lens",
    ranked_candidates: [ranked],
  };

  const result = externalOutcomeToResult(
    {
      match: visualMatch,
      providerUsed: "searchapi_google_lens",
      fallbackUsed: false,
      cached: true,
      timings: { lensMs: 50 },
    },
    item()
  );

  assert.equal(result.matchLabel, "EXTERNAL_MATCH");
  assert.equal(result.cached, true);
  assert.equal(result.matches[0].source, "external");
  assert.equal(result.matches[0].provider, "searchapi_google_lens");
  assert.equal(result.matches[0].scores.finalScore, 0.8); // 120/150
  assert.equal(result.matches[0].scores.visualScore, 1); // exact_image_match
  assert.equal(result.matches[0].scores.merchantScore, 1); // trusted_store
  // La marca del título NO se convierte en evidencia (item sin marca verificada).
  assert.equal(result.matches[0].scores.brandEvidenceScore, null);
  assert.deepEqual(result.matches[0].evidence, visualMatch.evidence);

  const similarOnly = externalOutcomeToResult(
    {
      match: { ...visualMatch, match_type: "similar" },
      providerUsed: "serpapi_google_lens",
      fallbackUsed: true,
      cached: false,
      timings: {},
    },
    item()
  );
  assert.equal(similarOnly.matchLabel, "SIMILAR");

  const nothing = externalOutcomeToResult(
    { match: null, providerUsed: null, fallbackUsed: false, cached: false, timings: {} },
    item()
  );
  assert.equal(nothing.matchLabel, "NO_MATCH");
  assert.equal(nothing.matches.length, 0);
});
