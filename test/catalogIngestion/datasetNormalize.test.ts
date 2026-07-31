import { test } from "node:test";
import assert from "node:assert/strict";

import {
  datasetImagePath,
  datasetUri,
  matchesFilters,
  normalizeDatasetRow,
} from "../../lib/catalogIngestion/datasets/normalize";
import { FASHION_PRODUCT_IMAGES_SMALL } from "../../lib/catalogIngestion/datasets/registry";
import type { FashionDatasetRow } from "../../lib/catalogIngestion/datasets/types";
import { normalizeCategory, categoryFamily } from "../../lib/catalogIngestion/normalization/normalize";

/**
 * Normalización de fila de dataset a producto de catálogo.
 *
 * El invariante central: lo que el dataset NO trae queda a null. Estos tests
 * existen para que nadie "mejore" el importador rellenando huecos con datos
 * plausibles.
 */

const DESCRIPTOR = FASHION_PRODUCT_IMAGES_SMALL;

function row(overrides: Partial<FashionDatasetRow> = {}): FashionDatasetRow {
  return {
    id: 15970,
    gender: "Men",
    masterCategory: "Apparel",
    subCategory: "Topwear",
    articleType: "Shirts",
    baseColour: "Navy Blue",
    season: "Fall",
    year: 2011,
    usage: "Casual",
    productDisplayName: "Turtle Check Men Navy Blue Shirt",
    imageUrl: "https://example.test/image.jpg",
    rowIndex: 0,
    ...overrides,
  };
}

function normalize(r: FashionDatasetRow = row()) {
  return normalizeDatasetRow({
    row: r,
    descriptor: DESCRIPTOR,
    version: "abc123",
    provider: "huggingface",
    image: {
      url: "https://blob.test/catalog/datasets/fashion-product-images-small/15970.jpg",
      localPath: "catalog/datasets/fashion-product-images-small/15970.jpg",
      sha256: "a".repeat(64),
      perceptualHash: "b8b0e8cccce8e8f0",
      width: 60,
      height: 80,
    },
    embedding: {
      imageEmbedding: [0.1, 0.2],
      provider: "local",
      dimension: 2,
      status: "ready",
    },
  });
}

test("los campos comerciales que el dataset no trae quedan a NULL", () => {
  const { product } = normalize();
  // Ninguno de estos se puede derivar del dataset. Cualquier valor aquí sería
  // inventado, y un precio inventado llega hasta el botón de comprar.
  assert.equal(product.price, null);
  assert.equal(product.originalPrice, null);
  assert.equal(product.currency, null);
  assert.equal(product.merchant, null);
  assert.equal(product.sku, null);
  assert.equal(product.gtin, null);
  assert.equal(product.description, null);
  assert.equal(product.material, null);
  assert.deepEqual(product.sizes, []);
  assert.deepEqual(product.variants, []);
  // No sabemos el stock y nunca lo sabremos por esta vía: "unknown", no
  // "in_stock" optimista ni "out_of_stock" pesimista.
  assert.equal(product.availability, "unknown");
});

test("se marca como demo y declara qué campos faltan", () => {
  const { product } = normalize();
  assert.equal(product.origin, "dataset_demo");
  assert.equal(product.sourceMetadata.isDemoProduct, true);
  assert.ok(product.dataset);
  assert.ok(
    product.dataset.unavailableFields.includes("price"),
    "price debe declararse como no disponible"
  );
  assert.ok(product.dataset.unavailableFields.includes("productUrl"));
});

test("la URL canónica NO es una URL de tienda inventada", () => {
  const { product } = normalize();
  assert.equal(product.canonicalUrl, "dataset://fashion-product-images-small/15970");
  assert.ok(
    !product.canonicalUrl.startsWith("http"),
    "no debe parecer navegable: un enlace http falso acabaría en un botón de compra"
  );
});

test("los campos disponibles se mapean a columnas que significan lo mismo", () => {
  const { product } = normalize();
  assert.equal(product.title, "Turtle Check Men Navy Blue Shirt");
  assert.equal(product.subcategory, "Topwear");
  assert.equal(product.gender, "Men");
  assert.equal(product.color, "navy");
  assert.equal(product.collection, "Fall 2011", "season + year = colección");
  assert.equal(product.style, "Casual", "usage = estilo");
  assert.equal(product.source, "fashion-product-images-small");
  assert.equal(product.sourceProductId, "15970");
});

test("los valores originales se conservan sin tocar para trazabilidad", () => {
  const { product } = normalize();
  const raw = product.sourceMetadata.raw as Record<string, unknown>;
  assert.equal(raw.articleType, "Shirts", "el crudo se conserva, no el normalizado");
  assert.equal(raw.baseColour, "Navy Blue");
  assert.equal(raw.masterCategory, "Apparel");
  assert.equal(raw.year, 2011);
});

test("la categoría se normaliza al vocabulario del catálogo, plurales incluidos", () => {
  // Sin esto, "Shirts" se quedaba como "shirts", que no existe ni en el mapa de
  // categorías ni en el de familias: el matching por categoría fallaba EN
  // SILENCIO contra un item detectado como "shirt".
  const { product } = normalize();
  assert.equal(product.category, "shirt");
  assert.equal(categoryFamily(product.category), "clothing");

  assert.equal(normalizeCategory("Tshirts"), "t-shirt");
  assert.equal(normalizeCategory("Watches"), "watch");
  assert.equal(normalizeCategory("Handbags"), "bag");
  assert.equal(normalizeCategory("Casual Shoes"), "shoes");
  assert.equal(normalizeCategory("Flip Flops"), "sandals");
  // El español no se rompe con el añadido de la regla de plural inglés.
  assert.equal(normalizeCategory("camisa"), "shirt");
  assert.equal(normalizeCategory("zapatillas"), "sneakers");
});

test("un perfume no es un body: las frases no se resuelven por una palabra suelta", () => {
  // Caso real encontrado en la importación: el bucle por palabras veía "Body"
  // dentro de "Perfume and Body Mist" y clasificaba 22 perfumes como
  // `bodysuit`. Como el bucle recorre las palabras en orden, tener "perfume" en
  // el vocabulario lo resuelve antes de llegar a "body".
  assert.equal(normalizeCategory("Perfume and Body Mist"), "fragrance");
  assert.equal(categoryFamily("fragrance"), "beauty");
  assert.equal(normalizeCategory("Deodorant"), "fragrance");
  assert.equal(normalizeCategory("Lipstick"), "makeup");
  assert.equal(normalizeCategory("Nail Polish"), "makeup");
  // Y un body sigue siendo un body.
  assert.equal(normalizeCategory("Bodysuit"), "bodysuit");
  assert.equal(categoryFamily("bodysuit"), "clothing");
  // Los plurales irregulares que la regla no cubre van en el vocabulario.
  assert.equal(normalizeCategory("Scarves"), "scarf");
});

test('"NA" del dataset no se toma como valor real', () => {
  // Varias columnas usan la cadena "NA" para huecos. Tratarla como valor daría
  // un catálogo lleno de productos de color "NA".
  const { product } = normalize(row({ baseColour: "NA", usage: "NA", season: null }));
  assert.equal(product.style, "NA", "el crudo se conserva tal cual...");
  // ...pero el lector es quien filtra "NA" antes de llegar aquí; ver
  // huggingface.test.ts. Lo que aquí se comprueba es que un color nulo no
  // inventa nada.
  const nulled = normalize(row({ baseColour: null }));
  assert.equal(nulled.product.color, null);
});

test("sin productDisplayName se compone el título y se avisa", () => {
  const { product, warnings } = normalize(row({ productDisplayName: null }));
  // `title` es NOT NULL en la base y una fila sin texto sigue sirviendo para el
  // matching visual, así que se compone con los atributos que SÍ existen.
  assert.equal(product.title, "Men Navy Blue Shirts");
  assert.ok(
    warnings.some((w) => w.includes("productDisplayName")),
    "el título derivado debe quedar declarado como derivado"
  );
  assert.equal(product.brand, null, "sin título tampoco hay marca");
});

test("la evidencia de extracción declara la fuente de cada campo", () => {
  const { product } = normalize();
  assert.ok(product.extraction);
  assert.equal(product.extraction.primaryExtractor, "dataset");
  assert.equal(product.extraction.aiUsed, false, "no se usa IA: no hay coste que declarar");
  assert.equal(product.extraction.browserUsed, false);
  assert.equal(product.extraction.aiCostUsd, 0);
  const fields = product.extraction.evidence.map((e) => e.field);
  assert.ok(fields.includes("articleType"));
  assert.ok(fields.includes("baseColour"));
  for (const e of product.extraction.evidence) {
    assert.equal(e.source, "dataset:fashion-product-images-small");
    assert.equal(e.confidence, 1, "leído literalmente de una columna: sin inferencia");
  }
});

test("el estado del embedding se propaga tal cual", () => {
  const { product } = normalize();
  assert.equal(product.embeddingStatus, "ready");
  assert.equal(product.embeddingProvider, "local");
  assert.equal(product.embeddingDimension, 2);
});

test("las rutas de storage son deterministas: reimportar no duplica objetos", () => {
  assert.equal(datasetUri(DESCRIPTOR, "15970"), "dataset://fashion-product-images-small/15970");
  assert.equal(
    datasetImagePath(DESCRIPTOR, "15970"),
    "catalog/datasets/fashion-product-images-small/15970.jpg"
  );
  assert.equal(
    datasetImagePath(DESCRIPTOR, "15970"),
    datasetImagePath(DESCRIPTOR, "15970"),
    "la misma ficha debe dar siempre la misma clave"
  );
});

test("filtros por categoría y género", () => {
  const r = row();
  assert.equal(matchesFilters(r, { categories: [], genders: [] }), true);
  // masterCategory
  assert.equal(matchesFilters(r, { categories: ["Apparel"], genders: [] }), true);
  // subCategory: pedir "Topwear" también es razonable
  assert.equal(matchesFilters(r, { categories: ["Topwear"], genders: [] }), true);
  assert.equal(matchesFilters(r, { categories: ["Footwear"], genders: [] }), false);
  // insensible a mayúsculas
  assert.equal(matchesFilters(r, { categories: ["apparel"], genders: [] }), true);
  assert.equal(matchesFilters(r, { categories: [], genders: ["Men"] }), true);
  assert.equal(matchesFilters(r, { categories: [], genders: ["Women"] }), false);
  // los dos filtros son AND
  assert.equal(matchesFilters(r, { categories: ["Apparel"], genders: ["Women"] }), false);
});
