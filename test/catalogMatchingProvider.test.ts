import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { TtlLruCache } from "../lib/matching/cache";
import { CatalogClient, type CatalogSearchMatch } from "../lib/matching/catalogClient";
import { CatalogMatchingProvider, dataUrlToBase64, verifiedBrand } from "../lib/matching/catalogProvider";
import { getMatchingConfig } from "../lib/matching/config";
import type { DetectedItem } from "../lib/types";

/**
 * CatalogMatchingProvider contra un servidor HTTP FAKE local que implementa
 * el contrato de CATALOG_API_CONTRACT.md. Sin red externa: el server escucha
 * en 127.0.0.1 con puerto efímero.
 */

const CROP = "data:image/png;base64,aG9sYS1jcm9wLWZha2U=";

type RecordedRequest = { path: string; apiKey: string | undefined; body: Record<string, unknown> };

let server: Server;
let baseUrl: string;
const requests: RecordedRequest[] = [];
/** Matches que el fake devolverá en la próxima búsqueda. */
let nextMatches: CatalogSearchMatch[] = [];
let failWith: number | null = null;

function catalogMatch(partial: Partial<CatalogSearchMatch>): CatalogSearchMatch {
  return {
    productId: "p1",
    title: "Camiseta rayas",
    brand: null,
    image: "https://catalogo.example/p1.jpg",
    productUrl: "https://zara.com/p1",
    price: 19.99,
    currency: "EUR",
    availability: "in_stock",
    visualScore: 0.9,
    textScore: 0.7,
    attributeScore: 0.8,
    finalScore: 0.9,
    source: "catalog",
    matchStage: "embedding",
    origin: "scraped",
    ...partial,
  };
}

function item(partial: Partial<DetectedItem> = {}): DetectedItem {
  return {
    name: "camiseta",
    category: "ropa",
    color: "azul",
    description: "camiseta de rayas azul",
    search_query_es: "camiseta rayas azul",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.8,
    ...partial,
  };
}

before(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push({
        path: req.url ?? "",
        apiKey: req.headers["x-api-key"] as string | undefined,
        body,
      });
      if (failWith != null) {
        res.writeHead(failWith, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "boom", message: "fallo simulado" } }));
        return;
      }
      if (req.url === "/products/search/image") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ queryId: "q1", matches: nextMatches }));
        return;
      }
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            db: "postgres",
            embeddings: { provider: "local", model: "clip", dimension: 512 },
            products: 3,
            uptimeSeconds: 1,
          })
        );
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: "no" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  requests.length = 0;
  nextMatches = [];
  failWith = null;
});

function makeProvider(overrides: Record<string, string> = {}) {
  const config = getMatchingConfig({
    CATALOG_SERVICE_URL: baseUrl,
    CATALOG_SERVICE_API_KEY: "clave-test",
    CATALOG_REQUEST_TIMEOUT_MS: "2000",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv);
  const client = new CatalogClient(config);
  return new CatalogMatchingProvider({ client, config, cache: new TtlLruCache(10) });
}

test("helpers: dataUrlToBase64 quita el prefijo; verifiedBrand exige brand_status verified", () => {
  assert.equal(dataUrlToBase64(CROP), "aG9sYS1jcm9wLWZha2U=");
  assert.equal(dataUrlToBase64("no-es-data-url"), null);
  assert.equal(verifiedBrand(item({ visible_brand: "Nike", brand_status: "verified" })), "Nike");
  assert.equal(verifiedBrand(item({ visible_brand: "Nike", brand_status: "probable" })), null);
  assert.equal(verifiedBrand(item({ brand_guess: "Nike" })), null);
});

test("envía imageBase64 sin prefijo, category/color, x-api-key; marca SOLO si está verificada", async () => {
  nextMatches = [catalogMatch({})];
  const provider = makeProvider();

  await provider.search({ item: item({ visible_brand: "Zara", brand_status: "verified" }), cropDataUrl: CROP });
  assert.equal(requests.length, 1);
  const req1 = requests[0];
  assert.equal(req1.path, "/products/search/image");
  assert.equal(req1.apiKey, "clave-test");
  assert.equal(req1.body.imageBase64, "aG9sYS1jcm9wLWZha2U=");
  assert.equal(req1.body.category, "ropa");
  assert.equal(req1.body.color, "azul");
  assert.equal(req1.body.brand, "Zara");
  assert.equal(req1.body.topK, 10);

  // Marca solo "probable": no se afirma sin evidencia → no viaja al catálogo.
  await provider.search({ item: item({ brand_guess: "Zara", brand_status: "probable" }), cropDataUrl: CROP });
  assert.equal(requests[1].body.brand, undefined);
});

test("CATALOG_MATCH_MIN_SCORE gobierna la etiqueta: match fiable vs SIMILAR vs NO_MATCH", async () => {
  const provider = makeProvider();

  nextMatches = [catalogMatch({ finalScore: 0.9 })];
  const strong = await provider.search({ item: item(), cropDataUrl: CROP });
  assert.equal(strong.matchLabel, "CATALOG_MATCH");
  assert.equal(strong.providerUsed, "catalog");
  assert.equal(strong.matches[0].source, "catalog");
  assert.equal(strong.matches[0].scores.finalScore, 0.9);

  nextMatches = [catalogMatch({ productId: "p2", finalScore: 0.6 })];
  const weak = await provider.search({ item: item({ name: "otra" , color: "rojo" }), cropDataUrl: CROP });
  assert.equal(weak.matchLabel, "SIMILAR");

  nextMatches = [];
  const none = await provider.search({ item: item({ color: "verde" }), cropDataUrl: CROP });
  assert.equal(none.matchLabel, "NO_MATCH");
  assert.equal(none.matches.length, 0);
});

test("caché por hash del crop: la segunda llamada idéntica no toca el servidor", async () => {
  nextMatches = [catalogMatch({})];
  const provider = makeProvider();

  const first = await provider.search({ item: item(), cropDataUrl: CROP });
  assert.equal(first.cached, false);
  assert.equal(requests.length, 1);

  const second = await provider.search({ item: item(), cropDataUrl: CROP });
  assert.equal(second.cached, true);
  assert.equal(requests.length, 1); // sin nueva petición HTTP
  assert.equal(second.matchLabel, "CATALOG_MATCH");
});

test("catálogo caído (error HTTP) → NO_MATCH con warning, nunca lanza", async () => {
  failWith = 500;
  const provider = makeProvider();
  const result = await provider.search({ item: item(), cropDataUrl: CROP });
  assert.equal(result.matchLabel, "NO_MATCH");
  assert.equal(result.providerUsed, null);
  assert.match(result.warnings?.[0] ?? "", /Catálogo no disponible/);
});

test("catálogo inalcanzable (conexión rechazada) → NO_MATCH con warning tipado", async () => {
  const config = getMatchingConfig({
    // Puerto cerrado: conexión rechazada al instante.
    CATALOG_SERVICE_URL: "http://127.0.0.1:1",
    CATALOG_REQUEST_TIMEOUT_MS: "1000",
  } as unknown as NodeJS.ProcessEnv);
  const provider = new CatalogMatchingProvider({
    client: new CatalogClient(config),
    config,
    cache: new TtlLruCache(10),
  });
  const result = await provider.search({ item: item(), cropDataUrl: CROP });
  assert.equal(result.matchLabel, "NO_MATCH");
  assert.equal(result.matches.length, 0);
  assert.equal(result.warnings?.length, 1);
});

test("sin crop utilizable → NO_MATCH sin llamar al servicio", async () => {
  const provider = makeProvider();
  const result = await provider.search({ item: item() });
  assert.equal(result.matchLabel, "NO_MATCH");
  assert.equal(requests.length, 0);
});

test("health() del cliente devuelve el estado del servicio", async () => {
  const config = getMatchingConfig({ CATALOG_SERVICE_URL: baseUrl } as unknown as NodeJS.ProcessEnv);
  const health = await new CatalogClient(config).health();
  assert.equal(health.ok, true);
  if (health.ok) {
    assert.equal(health.data.status, "ok");
    assert.equal(health.data.products, 3);
  }
});
