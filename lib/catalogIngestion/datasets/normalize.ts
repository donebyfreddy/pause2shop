/**
 * Fila de dataset -> `NormalizedProduct` del catálogo.
 *
 * REGLA QUE MANDA SOBRE TODO LO DEMÁS: lo que el dataset no trae, no se
 * rellena. Ni precio estimado, ni URL de tienda construida, ni marca adivinada,
 * ni disponibilidad supuesta. Esos campos quedan a null y se enumeran en
 * `dataset.unavailableFields`, para que la UI pueda decir "dato no disponible en
 * dataset" en vez de mostrar un hueco que parezca un fallo de importación.
 *
 * Lo que sí se hace es mapear los campos reales a las columnas del catálogo que
 * significan lo mismo, en vez de dejarlos sueltos en un cajón de metadatos:
 *   · `articleType` -> `category` (normalizada con el mapa EN/ES existente)
 *   · `subCategory` -> `subcategory`   · `baseColour` -> `color`
 *   · `season` + `year` -> `collection` (colección de temporada)
 *   · `usage` -> `style` (Casual / Formal / Sports / Ethnic ES estilo)
 * Los valores crudos se conservan además en `sourceMetadata.raw`, sin tocar, por
 * trazabilidad: si el mapeo resulta discutible, el original sigue ahí.
 */
import {
  computeContentHash,
  normalizeCategory,
  normalizeColor,
} from "../normalization/normalize";
import type {
  DatasetProvenance,
  NormalizedProduct,
  ProductExtractionMeta,
  ProductImage,
} from "../catalog/types";
import { extractBrand } from "./brands";
import { catalogSourceFor } from "./registry";
import type { DatasetDescriptor, FashionDatasetRow } from "./types";

/**
 * Esquema de URI interno para fichas de dataset.
 *
 * `catalog_products.canonical_url` es NOT NULL, pero el dataset no tiene URL de
 * producto. Antes de romper el esquema o de inventar una URL de tienda (que
 * acabaría siendo un enlace roto en un botón de "Comprar"), se usa un URI
 * `dataset:` que es explícitamente NO navegable. La API expone `productUrl:
 * null` para estas fichas, así que la UI no puede ofrecer compra ni por
 * accidente.
 */
export function datasetUri(descriptor: DatasetDescriptor, sourceProductId: string): string {
  return `dataset://${descriptor.id}/${sourceProductId}`;
}

/** Ruta del objeto en storage. Estable: reimportar no duplica el objeto. */
export function datasetImagePath(
  descriptor: DatasetDescriptor,
  sourceProductId: string
): string {
  return `catalog/datasets/${descriptor.id}/${sourceProductId}.jpg`;
}

export function datasetThumbPath(
  descriptor: DatasetDescriptor,
  sourceProductId: string
): string {
  return `catalog/datasets/${descriptor.id}/thumbs/${sourceProductId}.jpg`;
}

/**
 * Título de la ficha. `productDisplayName` es el título real; cuando falta, se
 * compone con los atributos que SÍ existen y se deja constancia en un warning.
 * No es invención: son los mismos campos del dataset concatenados, y el aviso
 * dice que el título es derivado.
 */
function buildTitle(row: FashionDatasetRow): { title: string; derived: boolean } {
  if (row.productDisplayName?.trim()) {
    return { title: row.productDisplayName.trim(), derived: false };
  }
  const composed = [row.gender, row.baseColour, row.articleType]
    .filter((p): p is string => Boolean(p?.trim()))
    .map((p) => p.trim())
    .join(" ");
  // Última red: el id. `title` es NOT NULL en la base y una fila sin ningún
  // atributo textual sigue siendo una imagen válida para el matching visual.
  return { title: composed || `${row.id}`, derived: true };
}

/**
 * Evidencia por campo. El admin ya tiene un inspector de evidencia para las
 * fichas scrapeadas ("¿de dónde ha salido este precio?"); las de dataset
 * responden lo mismo, y además dejan explícito qué campos NO tienen dato.
 */
function buildExtraction(
  row: FashionDatasetRow,
  descriptor: DatasetDescriptor,
  warnings: string[]
): ProductExtractionMeta {
  const evidence: ProductExtractionMeta["evidence"] = [];
  const add = (field: string, value: string | number | null): void => {
    if (value === null || value === "") return;
    evidence.push({
      field,
      source: `dataset:${descriptor.id}`,
      snippet: String(value).slice(0, 120),
      // 1 = leído literalmente de una columna del dataset. No hay inferencia.
      confidence: 1,
    });
  };
  add("title", row.productDisplayName);
  add("gender", row.gender);
  add("masterCategory", row.masterCategory);
  add("subCategory", row.subCategory);
  add("articleType", row.articleType);
  add("baseColour", row.baseColour);
  add("season", row.season);
  add("year", row.year);
  add("usage", row.usage);

  return {
    extractorsUsed: ["dataset"],
    primaryExtractor: "dataset",
    aiUsed: false,
    browserUsed: false,
    aiModel: null,
    aiCostUsd: 0,
    aiTokens: 0,
    // Los campos leídos son literales, pero la ficha está INCOMPLETA respecto a
    // un producto comercial (no hay precio ni stock). Reflejarlo como 1.0 sería
    // engañoso, así que la confianza es la fracción de campos comerciales que
    // el dataset puede cubrir.
    confidence: 0.6,
    evidence,
    warnings,
    extractedAt: new Date().toISOString(),
    durationMs: 0,
  };
}

export interface NormalizeResult {
  product: NormalizedProduct;
  warnings: string[];
  /** Marca rechazada por no estar en la lista verificada, si la hubo. */
  rejectedBrandCandidate: string | null;
}

export function normalizeDatasetRow(options: {
  row: FashionDatasetRow;
  descriptor: DatasetDescriptor;
  version: string;
  provider: "huggingface" | "kaggle";
  /** Imagen ya subida a storage persistente, si se subió. */
  image: ProductImage | null;
  embedding: {
    imageEmbedding: number[] | null;
    provider: string | null;
    dimension: number | null;
    status: NormalizedProduct["embeddingStatus"];
  };
}): NormalizeResult {
  const { row, descriptor, image, embedding } = options;
  const warnings: string[] = [];
  const sourceProductId = String(row.id);

  const { title, derived } = buildTitle(row);
  if (derived) {
    warnings.push(
      "El dataset no trae productDisplayName para esta fila: el título se ha " +
        "compuesto con los atributos disponibles."
    );
  }

  const brandResult = extractBrand(row.productDisplayName);
  if (brandResult.reason === "not_in_allowlist" && brandResult.candidate) {
    warnings.push(
      `Marca no asignada: "${brandResult.candidate}" no está en la lista ` +
        "verificada de marcas del dataset. Se deja a null en vez de adivinarla."
    );
  }

  // El dataset no trae disponibilidad. "unknown" es la respuesta honesta: no es
  // que esté agotado, es que no lo sabemos y nunca lo sabremos por esta vía.
  const provenance: DatasetProvenance = {
    id: descriptor.id,
    repo: descriptor.repo,
    provider: options.provider,
    version: options.version,
    split: descriptor.split,
    rowIndex: row.rowIndex,
    importedAt: new Date().toISOString(),
    unavailableFields: [...descriptor.unavailableFields],
  };

  const images = image ? [image] : [];
  const collection = [row.season, row.year ? String(Math.trunc(row.year)) : null]
    .filter(Boolean)
    .join(" ") || null;

  const product: NormalizedProduct = {
    source: catalogSourceFor(descriptor),
    sourceProductId,
    canonicalUrl: datasetUri(descriptor, sourceProductId),
    brand: brandResult.brand,
    title,
    // El dataset no tiene descripción. No se fabrica una a partir del título.
    description: null,
    category: normalizeCategory(row.articleType),
    subcategory: row.subCategory,
    gender: row.gender,
    collection,
    color: normalizeColor(row.baseColour),
    secondaryColors: [],
    material: null,
    pattern: null,
    style: row.usage,
    price: null,
    originalPrice: null,
    currency: null,
    availability: "unknown",
    merchant: null,
    country: null,
    locale: null,
    images,
    primaryImage: image?.url ?? null,
    variants: [],
    sizes: [],
    sku: null,
    gtin: null,
    sourceMetadata: {
      // Valores originales sin tocar: si el mapeo a columnas resulta
      // discutible, el dato crudo sigue disponible.
      raw: {
        id: row.id,
        gender: row.gender,
        masterCategory: row.masterCategory,
        subCategory: row.subCategory,
        articleType: row.articleType,
        baseColour: row.baseColour,
        season: row.season,
        year: row.year,
        usage: row.usage,
        productDisplayName: row.productDisplayName,
      },
      isDemoProduct: true,
      brandExtraction: {
        reason: brandResult.reason,
        candidate: brandResult.candidate,
      },
    },
    extraction: buildExtraction(row, descriptor, warnings),
    contentHash: computeContentHash({
      title,
      brand: brandResult.brand,
      description: null,
      price: null,
      currency: null,
      availability: "unknown",
      color: normalizeColor(row.baseColour),
      images: images.map((i) => ({ url: i.url })),
      sizes: [],
      // La taxonomía entra en el hash: si mejora el mapeo de categorías, la
      // reimportación tiene que propagarlo en vez de considerar la ficha
      // "sin cambios".
      category: normalizeCategory(row.articleType),
      subcategory: row.subCategory,
      gender: row.gender,
    }),
    perceptualHash: image?.perceptualHash ?? null,
    // El dataset no da texto suficiente para un embedding de texto útil más
    // allá del título; se deja a null y lo genera el reindex si hace falta.
    textEmbedding: null,
    imageEmbedding: embedding.imageEmbedding,
    embeddingStatus: embedding.status,
    embeddingProvider: embedding.provider,
    embeddingDimension: embedding.dimension,
    dataset: provenance,
    scrapedAt: new Date().toISOString(),
    origin: "dataset_demo",
  };

  return { product, warnings, rejectedBrandCandidate: brandResult.candidate };
}

/** ¿La fila pasa los filtros de categoría/género pedidos? */
export function matchesFilters(
  row: FashionDatasetRow,
  filters: { categories: string[]; genders: string[] }
): boolean {
  if (filters.categories.length > 0) {
    // Se compara contra masterCategory Y subCategory: pedir "Footwear" (master)
    // y pedir "Shoes" (sub) son ambas peticiones razonables.
    const haystack = [row.masterCategory, row.subCategory]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    const wanted = filters.categories.map((c) => c.toLowerCase());
    if (!haystack.some((h) => wanted.includes(h))) return false;
  }
  if (filters.genders.length > 0) {
    const gender = row.gender?.toLowerCase() ?? "";
    if (!filters.genders.map((g) => g.toLowerCase()).includes(gender)) return false;
  }
  return true;
}
