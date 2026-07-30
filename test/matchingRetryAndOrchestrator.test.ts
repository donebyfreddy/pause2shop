import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { canRetryMatching, type MatchingAttemptState } from "../hooks/useObjectMatching";
import { SearchApiGoogleLensProvider } from "../lib/visualSearch/reverseImage/providers";
import { runReverseImageSearch } from "../lib/visualSearch/reverseImage/orchestrator";
import type { ReverseSearchMode } from "../lib/visualSearch/reverseImage/types";

// --- canRetryMatching (estado reintentable, sustituye al Set "attempted") -------

function state(partial: Partial<MatchingAttemptState>): MatchingAttemptState {
  return {
    attempts: 1,
    lastCropQuality: 0.4,
    lastStatus: "no_match",
    lastAttemptAt: 0,
    inFlight: false,
    ...partial,
  };
}

test("primer intento siempre permitido; en vuelo nunca", () => {
  assert.equal(canRetryMatching(undefined, 0.4, 10_000), true);
  assert.equal(canRetryMatching(state({ inFlight: true }), 0.9, 10_000), false);
});

test("no_match permite retry con crop mejor tras el cooldown", () => {
  const s = state({ lastStatus: "no_match", lastCropQuality: 0.4, lastAttemptAt: 0 });
  assert.equal(canRetryMatching(s, 0.6, 10_000), true); // +0.2 > umbral 0.12
  assert.equal(canRetryMatching(s, 0.45, 10_000), false); // mejora insuficiente
  assert.equal(canRetryMatching(s, 0.9, 1_000), false); // cooldown no cumplido
});

test("matched NUNCA se repite; provider_error reintenta tras cooldown sin exigir mejor crop", () => {
  assert.equal(canRetryMatching(state({ lastStatus: "matched" }), 0.99, 60_000), false);
  assert.equal(
    canRetryMatching(state({ lastStatus: "provider_error", lastCropQuality: 0.5 }), 0.5, 10_000),
    true
  );
});

test("tope de intentos: al tercer intento no hay más retries", () => {
  assert.equal(
    canRetryMatching(state({ attempts: 3, lastStatus: "no_match" }), 0.99, 60_000),
    false
  );
});

// --- matriz de capacidades q por search mode (fetch mockeado) --------------------

function fixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf8");
}

async function withMockedFetch<T>(
  responder: (url: string) => { status: number; body: string },
  fn: () => Promise<T>
): Promise<{ result: T; urls: string[] }> {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const { status, body } = responder(url);
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await fn();
    return { result, urls };
  } finally {
    globalThis.fetch = original;
  }
}

test("SearchAPI: q se envía en all/products/visual_matches y NO en exact_matches; queryUsed refleja lo enviado", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  const provider = new SearchApiGoogleLensProvider();
  const modes: Array<[ReverseSearchMode, boolean]> = [
    ["all", true],
    ["products", true],
    ["visual_matches", true],
    ["exact_matches", false],
  ];
  for (const [mode, expectQ] of modes) {
    const { result, urls } = await withMockedFetch(
      () => ({ status: 200, body: "{}" }),
      () =>
        provider.search({
          cropUrl: "https://storage.test/crops/abc.jpg",
          query: "black floral shirt",
          country: "ES",
          language: "es",
          searchMode: mode,
        })
    );
    const sentUrl = new URL(urls[0]);
    assert.equal(sentUrl.searchParams.has("q"), expectQ, `modo ${mode}`);
    assert.equal(sentUrl.searchParams.get("search_type"), mode);
    assert.equal(result.queryUsed, expectQ ? "black floral shirt" : null, `queryUsed ${mode}`);
    // Nunca parámetros no soportados de más: la api_key nunca va al navegador
    // (esto corre en servidor) y la URL de imagen viaja como `url`.
    assert.equal(sentUrl.searchParams.get("url"), "https://storage.test/crops/abc.jpg");
  }
  delete process.env.SEARCHAPI_API_KEY;
});

// --- fallback del orchestrator: available + 0 resultados NO detiene la cadena ---

test("available con cero resultados → fallback a SerpAPI y candidatos del fallback", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  process.env.SERPAPI_API_KEY = "test-key-2";

  const { result } = await withMockedFetch(
    (url) => {
      if (url.includes("searchapi.io")) return { status: 200, body: "{}" }; // available, 0 resultados
      return { status: 200, body: fixture("serpapi-lens.json") }; // fallback útil
    },
    () =>
      runReverseImageSearch({
        cropUrl: "https://storage.test/crops/def456.jpg",
        query: "black hawaiian shirt",
        premium: false,
      })
  );

  assert.equal(result.providerUsed, "serpapi_google_lens");
  assert.equal(result.fallbackUsed, true);
  assert.ok(result.candidates.length > 0);
  // Las llamadas de SearchAPI quedaron registradas con 0 resultados.
  const searchapiCalls = result.calls.filter((c) => c.provider === "searchapi_google_lens");
  assert.ok(searchapiCalls.length >= 1);
  assert.ok(searchapiCalls.every((c) => c.resultCount === 0 && c.status === "available"));
  // queryUsed registrado en el log de llamadas.
  assert.ok(result.calls.some((c) => c.queryUsed === "black hawaiian shirt"));

  delete process.env.SEARCHAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
});

test("visual-first: exact+visual sin q primero; products con query SOLO como fallback débil", async () => {
  process.env.SEARCHAPI_API_KEY = "test-key";
  process.env.ENABLE_PROVIDER_FALLBACK = "false"; // aislar un proveedor

  // Caso 1: señal visual fuerte → no se usa la query en ninguna llamada.
  let called: Array<{ mode: string; hasQ: boolean }> = [];
  await withMockedFetch(
    (url) => {
      const u = new URL(url);
      const mode = u.searchParams.get("search_type") ?? "?";
      called.push({ mode, hasQ: u.searchParams.has("q") });
      if (mode === "exact_matches") {
        return { status: 200, body: fixture("searchapi-lens-all.json") };
      }
      return { status: 200, body: "{}" };
    },
    () =>
      runReverseImageSearch({
        cropUrl: "https://storage.test/crops/aaa111.jpg",
        query: "silver watch black dial",
        premium: true,
      })
  );
  assert.deepEqual(called.map((c) => c.mode).sort(), ["exact_matches", "visual_matches"]);
  assert.ok(called.every((c) => !c.hasQ), "la fase visual pura nunca lleva q");

  // Caso 2: visual puro vacío → fallback products CON la query refinada.
  called = [];
  await withMockedFetch(
    (url) => {
      const u = new URL(url);
      const mode = u.searchParams.get("search_type") ?? "?";
      called.push({ mode, hasQ: u.searchParams.has("q") });
      if (mode === "products") {
        return { status: 200, body: fixture("searchapi-lens-products.json") };
      }
      return { status: 200, body: "{}" };
    },
    () =>
      runReverseImageSearch({
        cropUrl: "https://storage.test/crops/bbb222.jpg",
        query: "silver watch black dial",
        premium: true,
      })
  );
  const products = called.find((c) => c.mode === "products");
  assert.ok(products, "debe escalar a products cuando lo visual puro es débil");
  assert.equal(products.hasQ, true, "el fallback products SÍ lleva la query");
  // exact_matches nunca lleva q.
  assert.ok(called.filter((c) => c.mode === "exact_matches").every((c) => !c.hasQ));

  delete process.env.SEARCHAPI_API_KEY;
  delete process.env.ENABLE_PROVIDER_FALLBACK;
});
