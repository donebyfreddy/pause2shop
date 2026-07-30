import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ZaraConnector } from "../../lib/catalogIngestion/connectors/zara/index";
import { MangoConnector } from "../../lib/catalogIngestion/connectors/mango/index";
import { HmConnector } from "../../lib/catalogIngestion/connectors/hm/index";
import { SOURCE_SPECS, assertSourcesValid } from "../../lib/catalogIngestion/connectors/sources/index";
import {
  allProductUrlPatterns,
  canSpecSync,
  effectiveStatus,
  specToMetadata,
} from "../../lib/catalogIngestion/connectors/base/types";
import type { FetchResult } from "../../lib/catalogIngestion/connectors/base/httpClient";

/**
 * Tests de los conectores concretos y de la integridad del registro.
 *
 * ⚠️ Los fixtures HTML de Zara/Mango/H&M son SINTÉTICOS: reproducen la forma
 * documentada de su JSON embebido, no una captura de la tienda (desde este
 * entorno esas tiendas devuelven 403 por IP y no se ha intentado eludirlo; ver
 * fixtures/README.md). Lo que se verifica aquí es el CONTRATO de extracción:
 * que el conector sabe leer esa estructura y convertirla bien.
 */

const HTML_DIR = join(import.meta.dirname, "fixtures", "html");

function fixture(store: string, name: string): string {
  return readFileSync(join(HTML_DIR, store, name), "utf8");
}

/** Fetch falso que devuelve siempre el mismo cuerpo. */
function stubFetch(body: string, status = 200) {
  return async (): Promise<FetchResult> => ({ status, body, contentType: "text/html" });
}

/* --------------------------------- Zara -------------------------------- */

test("Zara: lee viewPayload y convierte los céntimos a unidades", async () => {
  const html = fixture("zara", "viewpayload.html");
  const connector = new ZaraConnector(stubFetch(html));
  const scraped = await connector.scrapeProduct({
    url: "https://www.zara.com/es/es/chaqueta-cortavientos-p04551234.html",
  });
  const e = scraped.extraction;

  assert.equal(e.title, "CHAQUETA CORTAVIENTOS");
  // 4595 céntimos → 45,95 €. Es la unidad de la tienda, no un cálculo nuestro.
  assert.equal(e.price, 45.95);
  assert.equal(e.originalPrice, 69.95);
  assert.equal(e.currency, "EUR");
  assert.equal(e.color, "Verde caqui");
  assert.deepEqual(e.secondaryColors, ["Negro"]);
  assert.equal(e.material, "100% poliamida");
  // Tallas de TODOS los colores, deduplicadas: una talla no es un producto.
  assert.deepEqual([...e.sizes].sort(), ["L", "M", "S", "XL"]);
  // El placeholder {width} se resuelve para que la URL sea descargable.
  assert.ok(e.imageUrls[0].includes("1024"), "debe resolver {width}");
  assert.ok(!e.aiUsed, "con JSON embebido no debe hacer falta la IA");
  assert.ok(e.extractorsUsed.includes("embedded"));
});

test("Zara: sin viewPayload no inventa y cae a los meta tags", async () => {
  const connector = new ZaraConnector(
    stubFetch(`<html><head><title>Camisa | ZARA</title>
      <meta property="og:title" content="CAMISA POPELÍN">
      <meta property="og:image" content="https://static.zara.net/x.jpg">
      </head><body><h1>CAMISA POPELÍN</h1></body></html>`)
  );
  const scraped = await connector.scrapeProduct({
    url: "https://www.zara.com/es/es/camisa-p01234567.html",
  });
  assert.equal(scraped.extraction.title, "CAMISA POPELÍN");
  // No hay precio en la página: se queda null en vez de inventarse uno.
  assert.equal(scraped.extraction.price, null);
  assert.ok(scraped.extraction.warnings.length > 0, "debe avisar de lo que falta");
});

test("Zara: normalizar sin título lanza en vez de guardar basura", async () => {
  const connector = new ZaraConnector(stubFetch("<html><body></body></html>"));
  const scraped = await connector.scrapeProduct({
    url: "https://www.zara.com/es/es/x-p00000001.html",
  });
  await assert.rejects(() => connector.normalizeProduct(scraped), /sin título/);
});

/* -------------------------------- Mango -------------------------------- */

test("Mango: lee __NEXT_DATA__ con precio rebajado, tallas e imágenes", async () => {
  const connector = new MangoConnector(stubFetch(fixture("mango", "nextdata.html")));
  const scraped = await connector.scrapeProduct({
    url: "https://shop.mango.com/es/mujer/vestidos/vestido-midi_77050512.html",
  });
  const e = scraped.extraction;

  assert.equal(e.title, "Vestido midi plisado");
  assert.equal(e.price, 39.99, "el precio vigente es el rebajado");
  assert.equal(e.originalPrice, 59.99, "el original es el tachado");
  assert.equal(e.currency, "EUR");
  assert.equal(e.color, "Negro");
  assert.equal(e.material, "100% poliéster");
  assert.deepEqual(e.sizes, ["XS", "S", "M", "L"]);
  assert.equal(e.imageUrls.length, 2);

  const normalized = await connector.normalizeProduct(scraped);
  assert.equal(normalized.source, "mango");
  assert.equal(normalized.brand, "Mango");
  assert.equal(normalized.price, 39.99);
  // El descuento es real: original > vigente.
  assert.ok((normalized.originalPrice ?? 0) > (normalized.price ?? 0));
  assert.equal(normalized.gender, "women", "el género sale del path de la URL");
  assert.ok(normalized.extraction, "debe guardar la trazabilidad de extracción");
  assert.equal(normalized.extraction?.aiUsed, false);
});

/* --------------------------------- H&M --------------------------------- */

test("H&M: JSON-LD y productArticleDetails se combinan sin contradecirse", async () => {
  const connector = new HmConnector(stubFetch(fixture("hm", "articledetails.html")));
  const scraped = await connector.scrapeProduct({
    url: "https://www2.hm.com/es_es/productpage.1216798001.html",
  });
  const e = scraped.extraction;

  assert.equal(e.title, "Camisa oversize");
  // JSON-LD tiene prioridad sobre el JSON embebido: los dos dicen 24,99.
  assert.equal(e.price, 24.99);
  assert.equal(e.currency, "EUR");
  assert.equal(e.availability, "http://schema.org/InStock");
  // El precio tachado solo lo tiene el JSON embebido: lo aporta esa capa.
  assert.equal(e.originalPrice, 34.99);
  assert.equal(e.color, "Azul claro/rayas");
  assert.equal(e.material, "Algodón 100%");
  assert.equal(e.primaryExtractor, "jsonld");

  const normalized = await connector.normalizeProduct(scraped);
  assert.equal(normalized.availability, "in_stock");
  assert.equal(normalized.sourceProductId, "1216798001");
  // Las imágenes protocol-relative se completan a https.
  assert.ok(
    normalized.images.every((i) => i.url.startsWith("https://")),
    "las URLs //host se completan a https"
  );
});

/* ---------------------- Integridad del registro ------------------------ */

test("El registro de fuentes es válido y sin ids duplicados", () => {
  assert.doesNotThrow(() => assertSourcesValid());
  const ids = SOURCE_SPECS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("Todos los patrones de URL de ficha compilan", () => {
  for (const spec of SOURCE_SPECS) {
    for (const pattern of allProductUrlPatterns(spec)) {
      assert.doesNotThrow(() => new RegExp(pattern, "i"), `${spec.id}: ${pattern}`);
    }
    if (spec.productIdPattern) {
      const re = new RegExp(spec.productIdPattern, "i");
      assert.ok(
        /\(/.test(spec.productIdPattern),
        `${spec.id}: productIdPattern necesita un grupo de captura`
      );
      assert.doesNotThrow(() => re.test("https://example.com/x"));
    }
  }
});

test("Toda fuente respeta robots.txt: no hay forma de declarar lo contrario", () => {
  for (const spec of SOURCE_SPECS) {
    assert.equal(spec.robotsPolicy, "respect", `${spec.id} debe respetar robots.txt`);
  }
});

test("Un scaffold nunca sincroniza y siempre explica qué falta", () => {
  for (const spec of SOURCE_SPECS.filter((s) => s.implementation === "scaffold")) {
    assert.equal(canSpecSync(spec), false, `${spec.id} no debería poder sincronizar`);
    assert.ok(spec.notes.length > 10, `${spec.id} necesita explicar qué falta`);
    // Un scaffold no gasta tokens ni arranca navegador: no hay nada que extraer.
    assert.equal(spec.extraction.allowAi, false);
    assert.equal(spec.extraction.allowBrowser, false);
  }
});

test("Una fuente que requiere acuerdo no sincroniza aunque haya credenciales", () => {
  const spec = SOURCE_SPECS.find((s) => s.requiresAgreement);
  if (!spec) return; // el registro puede no tener ninguna en un momento dado
  assert.equal(canSpecSync(spec), false);
  assert.equal(effectiveStatus(spec, "available"), "partner_required");
});

test("Una fuente deshabilitada no sincroniza y sale como pausada", () => {
  const spec = { ...SOURCE_SPECS[0], enabled: false };
  assert.equal(canSpecSync(spec), false);
  assert.equal(effectiveStatus(spec, "available"), "paused");
});

/* ----------------------- Los 8 estados honestos ------------------------ */

test("effectiveStatus: SOLO se verifica con productos reales, nunca por declaración", () => {
  const declarativa = SOURCE_SPECS.find(
    (s) => s.implementation === "declarative" && !s.requiresAgreement && s.enabled
  )!;

  // Sin productos en catálogo: sin verificar, aunque la tienda responda bien.
  assert.equal(
    effectiveStatus(declarativa, "available", { verifiedLive: false }),
    "implemented_unverified"
  );
  // Con productos reales: verificado. Es la única vía a verde.
  assert.equal(
    effectiveStatus(declarativa, "available", { verifiedLive: true }),
    "implemented_verified"
  );
});

test("effectiveStatus: el orden de precedencia es la política", () => {
  const spec = SOURCE_SPECS.find((s) => s.implementation === "declarative" && s.enabled)!;

  // Pausado gana a todo: si el operador lo paró, no se dice nada más.
  assert.equal(effectiveStatus(spec, "available", { paused: true, verifiedLive: true }), "paused");
  // robots.txt gana a "verificado": el respeto va antes que el logro.
  assert.equal(effectiveStatus(spec, "disallowed", { verifiedLive: true }), "blocked_by_robots");
  assert.equal(effectiveStatus(spec, "blocked", { verifiedLive: true }), "blocked_or_challenged");
  assert.equal(effectiveStatus(spec, "error", { verifiedLive: false }), "error");
  // Un scaffold es "pending" aunque la portada responda.
  const scaffold = SOURCE_SPECS.find((s) => s.implementation === "scaffold");
  if (scaffold && !scaffold.requiresAgreement) {
    assert.equal(effectiveStatus(scaffold, "available"), "pending");
  }
});

test("La metadata expuesta incluye los alias del contrato del admin", () => {
  const meta = specToMetadata(SOURCE_SPECS[0]);
  assert.equal(meta.baseUrl, SOURCE_SPECS[0].homeUrl);
  assert.equal(meta.accessType, SOURCE_SPECS[0].access);
  assert.equal(meta.maturity, SOURCE_SPECS[0].lifecycle);
  assert.equal(meta.complianceMode, SOURCE_SPECS[0].compliance);
  assert.ok(Array.isArray(meta.discoveryKinds));
  // Los patrones internos NO se filtran como tales al admin.
  assert.ok(!("productUrlPattern" in meta));
});
