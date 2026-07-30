import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHtml, extractJsonLd, extractMicrodata, extractOpenGraph } from "../../lib/catalogIngestion/extraction/structured";
import {
  extractWithHeuristics,
  extractWithSelectors,
  extractProductLinks,
  extractNextPage,
  currencyFromText,
} from "../../lib/catalogIngestion/extraction/dom";
import {
  mergeLayers,
  missingEssentials,
  type ExtractionLayer,
} from "../../lib/catalogIngestion/extraction/types";

/**
 * Tests de los extractores por capas. Cada uno se prueba con HTML que imita la
 * forma REAL en que las tiendas publican los datos (incluidos los casos rotos:
 * JSON-LD truncado, precio tachado, listados).
 */

/* ------------------------------- JSON-LD ------------------------------- */

const JSONLD_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Vestido midi plisado",
 "brand":{"@type":"Brand","name":"Mango"},"color":"Negro","material":"Poliéster",
 "sku":"77050512","gtin13":"8445555123456",
 "image":["https://cdn.example.com/a.jpg","https://cdn.example.com/b.jpg"],
 "description":"Vestido midi de tejido plisado.",
 "offers":[
   {"@type":"Offer","price":"49.99","priceCurrency":"EUR","availability":"https://schema.org/InStock","itemOffered":{"size":"S"},"sku":"77050512-S"},
   {"@type":"Offer","price":"49.99","priceCurrency":"EUR","availability":"https://schema.org/OutOfStock","itemOffered":{"size":"M"},"sku":"77050512-M"}
 ]}
</script></head><body><h1>Vestido midi plisado</h1></body></html>`;

test("JSON-LD: extrae producto, precio, moneda, tallas y variantes", () => {
  const layer = extractJsonLd(loadHtml(JSONLD_HTML));
  assert.ok(layer, "debería encontrar un Product");
  assert.equal(layer.kind, "jsonld");
  assert.equal(layer.fields.title, "Vestido midi plisado");
  assert.equal(layer.fields.brand, "Mango");
  assert.equal(layer.fields.price, 49.99);
  assert.equal(layer.fields.currency, "EUR");
  assert.equal(layer.fields.sku, "77050512");
  assert.equal(layer.fields.gtin, "8445555123456");
  assert.deepEqual(layer.fields.imageUrls, [
    "https://cdn.example.com/a.jpg",
    "https://cdn.example.com/b.jpg",
  ]);
  // Una talla NO es un producto: las tallas van en `sizes` y las combinaciones
  // en `variants`.
  assert.deepEqual(layer.fields.sizes, ["S", "M"]);
  assert.equal(layer.fields.variants?.length, 2);
  assert.equal(layer.fields.variants?.[0].size, "S");
});

test("JSON-LD: encuentra el Product dentro de @graph y de mainEntity", () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"BreadcrumbList","itemListElement":[]},
      {"@type":"WebPage","mainEntity":{"@type":"Product","name":"Camisa de lino",
        "offers":{"@type":"Offer","price":29.95,"priceCurrency":"EUR"}}}
    ]}</script>`;
  const layer = extractJsonLd(loadHtml(html));
  assert.equal(layer?.fields.title, "Camisa de lino");
  assert.equal(layer?.fields.price, 29.95);
});

test("JSON-LD: AggregateOffer aporta el precio mínimo y el tachado", () => {
  const html = `<script type="application/ld+json">
    {"@type":"Product","name":"Zapatillas","offers":{"@type":"AggregateOffer",
      "lowPrice":"39.90","highPrice":"79.90","priceCurrency":"EUR"}}</script>`;
  const layer = extractJsonLd(loadHtml(html));
  assert.equal(layer?.fields.price, 39.9);
  assert.equal(layer?.fields.originalPrice, 79.9);
});

test("JSON-LD roto: se recupera lo posible sin lanzar", () => {
  // JSON truncado a media llave: pasa de verdad cuando la tienda corta el HTML.
  const html = `<script type="application/ld+json">
    {"@type":"Product","name":"Jersey de punto","offers":{"price":"35.00","priceCurrency":"EUR"}}
    ,{"basura"</script>`;
  assert.doesNotThrow(() => extractJsonLd(loadHtml(html)));
});

test("JSON-LD ausente: devuelve null en vez de inventar", () => {
  assert.equal(extractJsonLd(loadHtml("<html><body><p>hola</p></body></html>")), null);
});

/* ----------------------------- OpenGraph ------------------------------ */

test("OpenGraph: título, precio, moneda e imágenes", () => {
  const html = `<html><head>
    <meta property="og:type" content="product">
    <meta property="og:title" content="Abrigo de lana">
    <meta property="og:description" content="Abrigo largo de lana.">
    <meta property="product:price:amount" content="129,00">
    <meta property="product:price:currency" content="EUR">
    <meta property="og:image" content="https://cdn.example.com/coat.jpg">
    </head><body></body></html>`;
  const layer = extractOpenGraph(loadHtml(html));
  assert.equal(layer?.fields.title, "Abrigo de lana");
  assert.equal(layer?.fields.price, 129);
  assert.equal(layer?.fields.currency, "EUR");
  assert.equal(layer?.fields.productType, "product");
  assert.deepEqual(layer?.fields.imageUrls, ["https://cdn.example.com/coat.jpg"]);
});

/* ----------------------------- Microdata ------------------------------ */

test("Microdata: itemprop dentro del itemscope del producto", () => {
  const html = `<html><body>
    <div itemscope itemtype="https://schema.org/Product">
      <h1 itemprop="name">Falda vaquera</h1>
      <span itemprop="color">Azul</span>
      <meta itemprop="sku" content="ABC-123">
      <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
        <span itemprop="price">25,50</span>
        <meta itemprop="priceCurrency" content="EUR">
      </div>
      <img itemprop="image" src="https://cdn.example.com/skirt.jpg">
    </div></body></html>`;
  const layer = extractMicrodata(loadHtml(html));
  assert.equal(layer?.fields.title, "Falda vaquera");
  assert.equal(layer?.fields.color, "Azul");
  assert.equal(layer?.fields.price, 25.5);
  assert.equal(layer?.fields.currency, "EUR");
  assert.equal(layer?.fields.sku, "ABC-123");
});

/* ---------------------------- Selectores ------------------------------ */

const SELECTOR_HTML = `<html><body>
  <h1 class="pdp-title">Pantalón chino</h1>
  <span class="brand-name">Springfield</span>
  <span class="price-current">34,99 €</span>
  <span class="price-old">49,99 €</span>
  <ul class="sizes"><li class="size">38</li><li class="size">40</li><li class="size">42</li></ul>
  <div class="gallery">
    <img class="pdp-image" data-src="https://cdn.example.com/1.jpg">
    <img class="pdp-image" srcset="https://cdn.example.com/2-320.jpg 320w, https://cdn.example.com/2-1200.jpg 1200w">
  </div></body></html>`;

test("Selectores del conector: campos, precio tachado y srcset", () => {
  const layer = extractWithSelectors(loadHtml(SELECTOR_HTML), {
    title: ".pdp-title",
    brand: ".brand-name",
    price: ".price-current",
    originalPrice: ".price-old",
    sizes: ".sizes .size",
    images: ".pdp-image",
  });
  assert.equal(layer?.fields.title, "Pantalón chino");
  assert.equal(layer?.fields.brand, "Springfield");
  assert.equal(layer?.fields.price, 34.99);
  assert.equal(layer?.fields.originalPrice, 49.99);
  // La moneda se deduce del símbolo del propio texto de precio.
  assert.equal(layer?.fields.currency, "EUR");
  assert.deepEqual(layer?.fields.sizes, ["38", "40", "42"]);
  // De un srcset se toma la MAYOR resolución declarada.
  assert.deepEqual(layer?.fields.imageUrls, [
    "https://cdn.example.com/1.jpg",
    "https://cdn.example.com/2-1200.jpg",
  ]);
});

test("Selectores que no matchean nada: null, no una capa vacía", () => {
  const layer = extractWithSelectors(loadHtml(SELECTOR_HTML), { title: ".no-existe" });
  assert.equal(layer, null);
});

/* ---------------------------- Heurísticas ----------------------------- */

test("Heurísticas: h1, precio por marcador de clase e imágenes grandes", () => {
  const html = `<html><body>
    <nav><span class="price">9,99 €</span></nav>
    <h1>Camiseta orgánica</h1>
    <div class="product-price">19,90 €</div>
    <img src="https://cdn.example.com/tee.jpg" width="800" height="1200" alt="Camiseta">
    <img src="https://cdn.example.com/logo.svg" width="40" height="40" alt="logo">
    <footer><span class="price">99,00 €</span></footer>
  </body></html>`;
  const layer = extractWithHeuristics(loadHtml(html));
  assert.equal(layer?.fields.title, "Camiseta orgánica");
  // El precio del nav y del footer se descartan: son de otros productos.
  assert.equal(layer?.fields.price, 19.9);
  assert.deepEqual(layer?.fields.imageUrls, ["https://cdn.example.com/tee.jpg"]);
});

test("Heurísticas: 'agotado' visible es evidencia de falta de stock", () => {
  const html = `<html><body><h1>Bolso</h1><div class="price">50 €</div>
    <p>Producto agotado temporalmente</p></body></html>`;
  const layer = extractWithHeuristics(loadHtml(html));
  assert.equal(layer?.fields.availability, "out_of_stock");
});

test("Heurísticas: sin precio fiable lo declara en warnings", () => {
  const layer = extractWithHeuristics(
    loadHtml(`<html><body><h1>Producto</h1><img src="/x.jpg" width="600" height="600"></body></html>`)
  );
  assert.ok(layer?.warnings?.some((w) => w.includes("precio")));
});

test("currencyFromText reconoce símbolo y código", () => {
  assert.equal(currencyFromText("34,99 €"), "EUR");
  assert.equal(currencyFromText("$19.99"), "USD");
  assert.equal(currencyFromText("19.99 GBP"), "GBP");
  assert.equal(currencyFromText("19.99"), null);
});

/* -------------------------- Descubrimiento DOM ------------------------ */

test("Enlaces de ficha en un listado: filtra por patrón y resuelve relativas", () => {
  const html = `<html><body>
    <a href="/es/producto/camisa-p12345.html">Camisa</a>
    <a href="/es/categoria/camisas">Ver más</a>
    <a href="https://otra.com/producto/x-p999.html">Externo</a>
  </body></html>`;
  const links = extractProductLinks(
    loadHtml(html),
    "https://tienda.example.com/es/categoria/camisas",
    undefined,
    (url) => /-p\d+\.html/.test(url)
  );
  assert.ok(links.includes("https://tienda.example.com/es/producto/camisa-p12345.html"));
  assert.ok(!links.some((l) => l.includes("/categoria/")));
  assert.equal(links.length, 2, "incluye la externa que también cumple el patrón");
});

test("Paginación: rel=next y contenedor de paginación", () => {
  const withRel = loadHtml(`<html><head><link rel="next" href="/lista?page=2"></head><body></body></html>`);
  assert.equal(
    extractNextPage(withRel, "https://tienda.example.com/lista", undefined),
    "https://tienda.example.com/lista?page=2"
  );
  const withAria = loadHtml(
    `<html><body><div class="pagination"><a aria-label="Siguiente" href="/lista?page=3">›</a></div></body></html>`
  );
  assert.equal(
    extractNextPage(withAria, "https://tienda.example.com/lista", undefined),
    "https://tienda.example.com/lista?page=3"
  );
  assert.equal(extractNextPage(loadHtml("<html></html>"), "https://x.com", undefined), null);
});

/* --------------------------- Mezcla de capas -------------------------- */

test("mergeLayers: gana la capa más fiable y queda registrada la evidencia", () => {
  const layers: ExtractionLayer[] = [
    {
      kind: "heuristics",
      fields: { title: "Título de heurística", price: 99 },
      snippets: { title: "h1" },
    },
    {
      kind: "jsonld",
      fields: { title: "Título de JSON-LD", price: 49.99, currency: "EUR" },
      snippets: { title: "ld+json name" },
    },
  ];
  const merged = mergeLayers("https://tienda.example.com/p/1", layers);
  assert.equal(merged.title, "Título de JSON-LD", "JSON-LD debe ganar a la heurística");
  assert.equal(merged.price, 49.99);
  const titleEvidence = merged.evidence.find((e) => e.field === "title");
  assert.equal(titleEvidence?.source, "jsonld");
  assert.equal(titleEvidence?.snippet, "ld+json name");
});

test("mergeLayers: la IA solo rellena lo que nadie resolvió", () => {
  const merged = mergeLayers("https://x.com/p/1", [
    { kind: "jsonld", fields: { title: "Real", price: 10, currency: "EUR" } },
    { kind: "ai", fields: { title: "Inventado por IA", color: "negro" } },
  ]);
  assert.equal(merged.title, "Real");
  assert.equal(merged.color, "negro", "la IA sí aporta el campo que faltaba");
  assert.equal(merged.evidence.find((e) => e.field === "color")?.source, "ai");
});

test("mergeLayers: campos vacíos no cuentan como resueltos", () => {
  const merged = mergeLayers("https://x.com/p/1", [
    { kind: "jsonld", fields: { title: "  ", imageUrls: [] } },
    { kind: "selectors", fields: { title: "Título real", imageUrls: ["https://x.com/a.jpg"] } },
  ]);
  assert.equal(merged.title, "Título real");
  assert.deepEqual(merged.imageUrls, ["https://x.com/a.jpg"]);
});

test("missingEssentials detecta exactamente lo que falta", () => {
  const merged = mergeLayers("https://x.com/p/1", [
    { kind: "jsonld", fields: { title: "Producto", imageUrls: ["https://x.com/a.jpg"] } },
  ]);
  assert.deepEqual(missingEssentials(merged), ["price", "currency"]);
});

test("La confianza sube cuando resuelven extractores fiables", () => {
  const soloHeuristica = mergeLayers("https://x.com/p/1", [
    { kind: "heuristics", fields: { title: "T", price: 10, currency: "EUR", imageUrls: ["a"] } },
  ]);
  const conJsonLd = mergeLayers("https://x.com/p/1", [
    { kind: "jsonld", fields: { title: "T", price: 10, currency: "EUR", imageUrls: ["a"] } },
  ]);
  assert.ok(
    conJsonLd.confidence > soloHeuristica.confidence,
    "JSON-LD debe dar más confianza que una heurística"
  );
});
