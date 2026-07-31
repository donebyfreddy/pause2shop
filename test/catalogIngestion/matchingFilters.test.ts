import { test, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileCatalogStore } from "../../lib/catalogIngestion/catalog/fileStore";
import {
  attributeScore,
  genderConflicts,
  imageQualityScore,
  matchProducts,
} from "../../lib/catalogIngestion/catalog/matching";
import { tempDataDir, makeProduct } from "./helpers";

/**
 * Filtros y señales adicionales de la búsqueda en el catálogo (tipo, género,
 * material, patrón, imagen presentable).
 *
 * El criterio que se prueba una y otra vez: un atributo AUSENTE en la ficha no
 * puede descartarla. La visión acierta a medias con material/patrón/género, así
 * que tratarlos como filtros duros vaciaría el catálogo y parecería que no hay
 * productos cuando lo que falta es el dato.
 */

let store: FileCatalogStore;

before(async () => {
  const dir = tempDataDir("matching-filters");
  store = new FileCatalogStore(join(dir, "catalog.json"));
  await store.init();

  await store.saveProduct(
    makeProduct({
      id: "tote-woman",
      title: "Bolso tote de piel",
      category: "bag",
      subcategory: "tote",
      color: "beige",
      gender: "women",
      material: "piel",
      pattern: "liso",
      imageEmbedding: [1, 0, 0, 0],
      images: [
        {
          url: "http://x/tote.jpg",
          localPath: null,
          sha256: "sha-tote",
          perceptualHash: null,
          width: 900,
          height: 900,
        },
      ],
    })
  );
  await store.saveProduct(
    makeProduct({
      id: "tote-man",
      title: "Bolso tote de lona",
      category: "bag",
      subcategory: "tote",
      color: "beige",
      gender: "men",
      imageEmbedding: [1, 0, 0, 0],
      images: [
        {
          url: "http://x/tote-m.jpg",
          localPath: null,
          sha256: "sha-tote-m",
          perceptualHash: null,
          width: 300,
          height: 300,
        },
      ],
    })
  );
  await store.saveProduct(
    makeProduct({
      id: "tote-unisex",
      title: "Bolso tote unisex",
      category: "bag",
      subcategory: "tote",
      gender: "unisex",
      imageEmbedding: [1, 0, 0, 0],
      images: [
        {
          url: "http://x/tote-u.jpg",
          localPath: null,
          sha256: "sha-tote-u",
          perceptualHash: null,
          width: null,
          height: null,
        },
      ],
    })
  );
  // Ficha SIN género declarado: no puede quedar excluida por filtrar género.
  await store.saveProduct(
    makeProduct({
      id: "tote-nogender",
      title: "Bolso tote sin género",
      category: "bag",
      gender: null,
      imageEmbedding: [1, 0, 0, 0],
      images: [
        {
          url: "http://x/tote-n.jpg",
          localPath: null,
          sha256: "sha-tote-n",
          perceptualHash: null,
          width: 500,
          height: 500,
        },
      ],
    })
  );
  // Ficha con embedding pero SIN imagen: no se puede pintar como tarjeta.
  await store.saveProduct(
    makeProduct({
      id: "tote-noimage",
      title: "Bolso tote sin imagen",
      category: "bag",
      primaryImage: null,
      imageEmbedding: [1, 0, 0, 0],
      images: [],
    })
  );
});

const QUERY = { imageEmbedding: [1, 0, 0, 0], category: "bag", minScore: 0.1 };

test("requireImage descarta las fichas sin imagen presentable", async () => {
  const withImage = await matchProducts(store, { ...QUERY, requireImage: true });
  assert.ok(
    !withImage.some((m) => m.product.id === "tote-noimage"),
    "una ficha sin imagen no sirve como resultado de búsqueda visual"
  );

  // Sin exigirla, la ficha vuelve a estar disponible (búsqueda de texto, p. ej.).
  const anyImage = await matchProducts(store, { ...QUERY, requireImage: false });
  assert.ok(anyImage.some((m) => m.product.id === "tote-noimage"));
});

test("el género excluye solo cuando consta en ambos lados y no casa", async () => {
  const women = await matchProducts(store, {
    ...QUERY,
    gender: "women",
    requireImage: true,
  });
  const ids = women.map((m) => m.product.id);

  assert.ok(ids.includes("tote-woman"), "el género que casa entra");
  assert.ok(!ids.includes("tote-man"), "el género incompatible se descarta");
  assert.ok(ids.includes("tote-unisex"), "unisex es compatible con cualquier género");
  assert.ok(
    ids.includes("tote-nogender"),
    "una ficha SIN género no se descarta: falta el dato, no hay conflicto"
  );
});

test("genderConflicts es puro y no excluye por ausencia de dato", () => {
  assert.equal(genderConflicts("women", "men"), true);
  assert.equal(genderConflicts("women", "women"), false);
  assert.equal(genderConflicts("unisex", "men"), false);
  assert.equal(genderConflicts("men", "unisex"), false);
  assert.equal(genderConflicts(null, "men"), false);
  assert.equal(genderConflicts("men", null), false);
  assert.equal(genderConflicts("men", undefined), false);
});

test("tipo de artículo: se busca en subcategoría, estilo y título", () => {
  const tote = makeProduct({ subcategory: "tote", title: "Bolso tote de piel" });
  assert.equal(attributeScore(tote, { type: "tote" }), 1);
  assert.equal(attributeScore(tote, { type: "mochila" }), 0);
  // También vale si solo aparece en el título.
  const trench = makeProduct({ subcategory: null, title: "Trench largo beige" });
  assert.equal(attributeScore(trench, { type: "trench" }), 1);
});

test("material y patrón solo puntúan si la ficha los declara", () => {
  const withMaterial = makeProduct({ material: "piel", pattern: "liso" });
  assert.equal(attributeScore(withMaterial, { material: "piel" }), 1);
  assert.equal(attributeScore(withMaterial, { material: "lona" }), 0);

  // Sin el dato en la ficha, el filtro NO cuenta: no se penaliza la falta de
  // información (devuelve el neutro de "sin filtros aplicables").
  const withoutMaterial = makeProduct({ material: null, pattern: null });
  assert.equal(attributeScore(withoutMaterial, { material: "piel" }), 0.5);
  assert.equal(attributeScore(withoutMaterial, { pattern: "floral" }), 0.5);
});

test("attributeScore sigue siendo compatible con los filtros originales", () => {
  const p = makeProduct({ category: "dress", brand: "Zara", color: "rojo" });
  assert.equal(attributeScore(p, { category: "dress", brand: "Zara", color: "rojo" }), 1);
  assert.equal(attributeScore(p, { category: "shirt" }), 0);
  assert.equal(attributeScore(p, {}), 0.5);
});

test("calidad de imagen: desempata sin penalizar dimensiones desconocidas", () => {
  const big = makeProduct({
    images: [{ url: "u", localPath: null, sha256: null, perceptualHash: null, width: 900, height: 900 }],
  });
  const small = makeProduct({
    images: [{ url: "u", localPath: null, sha256: null, perceptualHash: null, width: 220, height: 220 }],
  });
  const unknown = makeProduct({
    images: [{ url: "u", localPath: null, sha256: null, perceptualHash: null, width: null, height: null }],
  });

  assert.ok(imageQualityScore(big) > imageQualityScore(small));
  // Desconocido = neutro: nunca por debajo de una imagen mala conocida.
  assert.equal(imageQualityScore(unknown), 0.5);
  assert.ok(imageQualityScore(unknown) > imageQualityScore(small));
});

test("a igualdad de score gana la ficha que se verá mejor en la tarjeta", async () => {
  // tote-woman (900px) y tote-man (300px) tienen el MISMO embedding, así que
  // su visualScore es idéntico: el desempate solo puede venir de la imagen.
  const matches = await matchProducts(store, {
    imageEmbedding: [1, 0, 0, 0],
    category: "bag",
    minScore: 0.1,
    requireImage: true,
  });
  const womanIdx = matches.findIndex((m) => m.product.id === "tote-woman");
  const manIdx = matches.findIndex((m) => m.product.id === "tote-man");
  assert.ok(womanIdx >= 0 && manIdx >= 0);
  assert.ok(
    womanIdx < manIdx,
    "con scores empatados, la imagen de 900px va antes que la de 300px"
  );
});

/* ------------- categorías gruesas del modelo de visión --------------------- */

test("los descriptores gruesos de la visión casan con las categorías finas", async () => {
  const { categoriesMatch, normalizeCategory } = await import(
    "../../lib/catalogIngestion/normalization/normalize"
  );

  // Lo que el modelo devuelve de verdad al describir un objeto de un frame.
  assert.equal(normalizeCategory("prenda superior"), "clothing");
  assert.equal(normalizeCategory("prenda inferior"), "clothing");
  assert.equal(normalizeCategory("calzado"), "footwear");
  assert.equal(normalizeCategory("accesorio"), "bags_accessories");

  // `categoriesMatch` es FILTRO DURO: sin esto, una camiseta detectada como
  // "prenda superior" descartaba el catálogo entero y la UI decía que no había
  // productos indexados teniendo mil.
  assert.equal(categoriesMatch("t-shirt", "prenda superior"), true);
  assert.equal(categoriesMatch("shirt", "prenda superior"), true);
  assert.equal(categoriesMatch("shorts", "prenda inferior"), true);
  assert.equal(categoriesMatch("sneakers", "calzado"), true);
  assert.equal(categoriesMatch("bag", "accesorio"), true);

  // Y sigue separando familias: lo grueso no puede volverse un comodín.
  assert.equal(categoriesMatch("sneakers", "prenda superior"), false);
  assert.equal(categoriesMatch("t-shirt", "calzado"), false);
  assert.equal(categoriesMatch("bag", "calzado"), false);
});

test("una detección con categoría gruesa encuentra productos del catálogo", async () => {
  const matches = await matchProducts(store, {
    imageEmbedding: [1, 0, 0, 0],
    // Exactamente lo que manda la UI tras detectar un bolso en un frame.
    category: "accesorio",
    minScore: 0.1,
    requireImage: true,
  });
  assert.ok(
    matches.length > 0,
    "un bolso detectado como 'accesorio' debe encontrar los bolsos del catálogo"
  );
});
