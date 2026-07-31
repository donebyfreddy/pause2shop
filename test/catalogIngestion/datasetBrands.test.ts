import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brandAllowlist,
  extractBrand,
} from "../../lib/catalogIngestion/datasets/brands";

/**
 * Extracción de marca del dataset.
 *
 * Lo que se protege aquí no es una función: es la promesa de NO inventar marcas.
 * Cada caso de abajo es un fallo real que se produjo o que se produciría con la
 * heurística obvia de "las primeras palabras son la marca".
 */

test("marca verificada: se extrae de la lista derivada del dataset", () => {
  assert.equal(extractBrand("Peter England Men Party Blue Jeans").brand, "Peter England");
  assert.equal(extractBrand("Puma Men Black Sports Shoes").brand, "Puma");
  assert.equal(extractBrand("Titan Women Silver Watch").brand, "Titan");
});

test("NO inventa marca cuando el prefijo no está verificado", () => {
  const result = extractBrand("Some Random Thing Men Blue Top");
  assert.equal(result.brand, null, "una marca no verificada debe quedar a null");
  assert.equal(result.reason, "not_in_allowlist");
  // El candidato se conserva para poder auditar POR QUÉ se rechazó.
  assert.equal(result.candidate, "Some Random Thing");
});

test("no confunde un atributo con la marca: 'Turtle Check' es Turtle", () => {
  // Este es el caso que motivó todo el módulo. Tomar el prefijo hasta el token
  // de género daría "Turtle Check", pero "Check" es el estampado, no la marca.
  assert.equal(extractBrand("Turtle Check Men Navy Blue Shirt").brand, "Turtle");
  assert.equal(extractBrand("Turtle Solid Men Blue Shirt").brand, "Turtle");
});

test("las líneas de producto colapsan a la marca madre", () => {
  assert.equal(extractBrand("Jockey ELANCE Men White Vest").brand, "Jockey");
  assert.equal(extractBrand("Jockey COMFORT PLUS Women Bra").brand, "Jockey");
  assert.equal(extractBrand("Nike Fragrances Men Deodorant").brand, "Nike");
  assert.equal(extractBrand("Arrow New York Men Formal Shirt").brand, "Arrow");
});

test("marcas independientes que comparten primer token NO se colapsan", () => {
  // Lee y Lee Cooper son dos empresas distintas. La poda mecánica de sub-marcas
  // las fusionaría, y por eso "Lee Cooper" es una excepción declarada.
  assert.equal(extractBrand("Lee Cooper Men Brown Casual Shoes").brand, "Lee Cooper");
  assert.equal(extractBrand("Lee Men Blue Jeans").brand, "Lee");
});

test("los alias se canonicalizan a una sola forma", () => {
  // Sin esto el catálogo tendría "Levis" y "Levi's" como dos marcas, y filtrar
  // por una perdería la mitad de las fichas.
  assert.equal(extractBrand("Levis Men Blue Jeans").brand, "Levi's");
  assert.equal(extractBrand("ADIDAS Men Black Shoes").brand, "Adidas");
  assert.equal(extractBrand("ADIDAS Originals Men White Shoes").brand, "Adidas");
  assert.equal(
    extractBrand("UCB Men Striped Tshirt").brand,
    "United Colors of Benetton"
  );
  assert.equal(
    extractBrand("United Colors Of Benetton Men Tshirt").brand,
    "United Colors of Benetton"
  );
  assert.equal(extractBrand("Gini Jony Girls Pink Dress").brand, "Gini and Jony");
});

test("las palabras genéricas excluidas no se toman por marca", () => {
  assert.equal(extractBrand("Basics Men Blue Shirt").brand, null);
});

test("sin título no hay marca y se dice por qué", () => {
  assert.equal(extractBrand(null).reason, "no_title");
  assert.equal(extractBrand("   ").reason, "no_title");
  assert.equal(extractBrand(null).brand, null);
});

test("nombre sin token de género: se informa del motivo, no se adivina", () => {
  const result = extractBrand("Algo Totalmente Distinto Sin Genero");
  assert.equal(result.brand, null);
  assert.equal(result.reason, "no_gender_boundary");
});

test("la lista efectiva no contiene entradas redundantes ni excluidas", () => {
  const list = brandAllowlist();
  assert.ok(list.length > 100, "la lista derivada debe tener cientos de marcas");

  const lower = new Set(list.map((b) => b.toLowerCase()));
  assert.ok(!lower.has("basics"), "las genéricas deben estar excluidas");
  assert.ok(!lower.has("jockey elance"), "las líneas de producto deben podarse");
  assert.ok(lower.has("lee cooper"), "las excepciones declaradas deben sobrevivir");

  // Se ordena de más larga a más corta: es lo que hace que "Lee Cooper" gane a
  // "Lee" en el emparejamiento.
  const lengths = list.map((b) => b.split(/\s+/).length);
  for (let i = 1; i < lengths.length; i += 1) {
    assert.ok(lengths[i] <= lengths[i - 1], "la lista debe ir de más larga a más corta");
  }
});
