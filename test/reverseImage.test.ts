import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

/**
 * Tests del orquestador de reverse image search: fallback de proveedor,
 * normalización al mismo modelo y estados de proveedor. `fetch` se mockea —
 * no se llama a ninguna API real.
 */

type FetchCall = { url: URL };
const calls: FetchCall[] = [];
let responder: (url: URL) => Response;

const realFetch = globalThis.fetch;

function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push({ url });
    return responder(url);
  }) as typeof fetch;
}

function lensPayload() {
  return {
    exact_matches: [
      {
        title: "Reloj metálico esfera negra",
        link: "https://www.tienda-oficial.es/reloj-x",
        source: "Tienda Oficial",
        price: { extracted_value: 199, currency: "EUR" },
        thumbnail: "https://img.example/reloj.jpg",
      },
    ],
    visual_matches: [
      {
        title: "Reloj parecido",
        link: "https://www.otra-tienda.es/reloj-y",
        source: "Otra Tienda",
      },
    ],
  };
}

beforeEach(() => {
  calls.length = 0;
  process.env.SEARCHAPI_API_KEY = "test-searchapi";
  process.env.SERPAPI_API_KEY = "test-serpapi";
  process.env.ENABLE_PROVIDER_FALLBACK = "true";
  delete process.env.REVERSE_IMAGE_PRIMARY_PROVIDER;
  // Resetea el circuit breaker global entre tests.
  (globalThis as Record<string, unknown>).__reverseBreaker = new Map();
  mockFetch();
});

test("normaliza exact/visual matches de SearchAPI al modelo común", async (t) => {
  t.after(() => (globalThis.fetch = realFetch));
  responder = () => Response.json(lensPayload());
  const { runReverseImageSearch } = await import(
    "../lib/visualSearch/reverseImage/orchestrator"
  );
  const result = await runReverseImageSearch({
    cropUrl: "https://public.example/crop.jpg",
    query: "silver watch black dial",
  });
  assert.equal(result.providerUsed, "searchapi_google_lens");
  assert.equal(result.fallbackUsed, false);
  const exact = result.candidates.find((c) => c.exactImageMatch);
  assert.ok(exact, "debe conservar el exact match");
  assert.equal(exact?.price, 199);
  assert.equal(exact?.sourceType, "exact_matches");
  assert.ok(result.calls.length >= 1);
  // VISUAL-FIRST: las primeras llamadas son exact_matches + visual_matches
  // SIN query — el único input discriminante es la URL del crop.
  const firstModes = calls.slice(0, 2).map((c) => c.url.searchParams.get("search_type")).sort();
  assert.deepEqual(firstModes, ["exact_matches", "visual_matches"]);
  assert.ok(
    calls.slice(0, 2).every((c) => !c.url.searchParams.has("q")),
    "la búsqueda visual pura no debe llevar q"
  );
});

test("401 en SearchAPI activa fallback real a SerpAPI y lo registra", async (t) => {
  t.after(() => (globalThis.fetch = realFetch));
  responder = (url) =>
    url.hostname.includes("searchapi")
      ? new Response("unauthorized", { status: 401 })
      : Response.json(lensPayload());
  const { runReverseImageSearch } = await import(
    "../lib/visualSearch/reverseImage/orchestrator"
  );
  const result = await runReverseImageSearch({
    cropUrl: "https://public.example/crop.jpg",
  });
  assert.equal(result.providerUsed, "serpapi_google_lens");
  assert.equal(result.fallbackUsed, true, "el fallback debe quedar registrado");
  assert.ok(result.candidates.length > 0);
  const searchapiCall = result.calls.find((c) => c.provider === "searchapi_google_lens");
  assert.equal(searchapiCall?.status, "unauthorized");
});

test("sin ningún proveedor configurado no rompe: skippedReason claro", async (t) => {
  t.after(() => (globalThis.fetch = realFetch));
  delete process.env.SEARCHAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_KEY;
  responder = () => Response.json({});
  const { runReverseImageSearch } = await import(
    "../lib/visualSearch/reverseImage/orchestrator"
  );
  const result = await runReverseImageSearch({ cropUrl: "https://x.example/c.jpg" });
  assert.equal(result.providerUsed, null);
  assert.equal(result.candidates.length, 0);
  assert.match(result.skippedReason ?? "", /proveedor/i);
  assert.equal(calls.length, 0, "no debe llamar a ninguna API");
});

test("visual-first: exact+visual sin q; NO se llama a products si la señal visual es fuerte", async (t) => {
  t.after(() => (globalThis.fetch = realFetch));
  // El payload trae un exact comercial (precio + tienda) → sin fallback textual.
  responder = () => Response.json(lensPayload());
  const { runReverseImageSearch } = await import(
    "../lib/visualSearch/reverseImage/orchestrator"
  );
  const result = await runReverseImageSearch({
    cropUrl: "https://public.example/crop.jpg",
    query: "camisa negra", // disponible, pero NO debe usarse
    premium: true,
  });
  const types = calls.map((c) => c.url.searchParams.get("search_type")).sort();
  assert.deepEqual(types, ["exact_matches", "visual_matches"]);
  assert.ok(calls.every((c) => !c.url.searchParams.has("q")));
  assert.equal(result.providerUsed, "searchapi_google_lens");
});

test("los duplicados entre secciones/motores se eliminan", async (t) => {
  t.after(() => (globalThis.fetch = realFetch));
  responder = () =>
    Response.json({
      exact_matches: [
        { title: "Reloj X", link: "https://tienda.es/reloj-x" },
      ],
      visual_matches: [
        { title: "Reloj X", link: "https://tienda.es/reloj-x" },
      ],
    });
  const { runReverseImageSearch } = await import(
    "../lib/visualSearch/reverseImage/orchestrator"
  );
  const result = await runReverseImageSearch({ cropUrl: "https://x.example/c.jpg" });
  assert.equal(result.candidates.length, 1, "mismo producto no se cuenta dos veces");
});
