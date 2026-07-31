/**
 * Datasets soportados.
 *
 * Los campos disponibles y no disponibles se declaran aquí, y son la ÚNICA
 * fuente de verdad sobre lo que el dataset puede ofrecer. El normalizador
 * los usa para rellenar `unavailableFields`, y la UI los usa para escribir
 * "dato no disponible en dataset" en vez de dejar un hueco vacío que parezca
 * un fallo de importación.
 */
import type { DatasetDescriptor } from "./types";

/**
 * Campos que el dataset SÍ trae. Coinciden 1:1 con el esquema publicado por el
 * dataset viewer de HuggingFace; están verificados contra
 * `GET /info?dataset=hgjun/fashion-product-images-small`.
 */
const FASHION_AVAILABLE = [
  "id",
  "gender",
  "masterCategory",
  "subCategory",
  "articleType",
  "baseColour",
  "season",
  "year",
  "usage",
  "productDisplayName",
  "image",
] as const;

/**
 * Campos que el dataset NO trae de forma fiable. Cada uno de estos queda a
 * null en el catálogo. No se derivan, no se estiman y no se inventan: un
 * precio inventado en un catálogo llega hasta el botón de comprar.
 */
const FASHION_UNAVAILABLE = [
  "price",
  "originalPrice",
  "currency",
  "availability",
  "stock",
  "productUrl",
  "merchant",
  "sku",
  "gtin",
  "description",
  "material",
  "sizes",
  "variants",
] as const;

export const FASHION_PRODUCT_IMAGES_SMALL: DatasetDescriptor = {
  id: "fashion-product-images-small",
  repo: "hgjun/fashion-product-images-small",
  // Procedencia original del dataset. El mirror de HuggingFace es una copia en
  // parquet del dataset de Kaggle de paramaggarwal.
  originRepo: "paramaggarwal/fashion-product-images-small",
  provider: "huggingface",
  kaggleRef: "paramaggarwal/fashion-product-images-small",
  split: "train",
  config: "default",
  // El dataset no declara licencia en su tarjeta de HuggingFace. Se trata como
  // "solo investigación/demo": ni redistribución ni uso comercial.
  license: "no declarada (uso demo/investigación)",
  availableFields: FASHION_AVAILABLE,
  unavailableFields: FASHION_UNAVAILABLE,
};

const DATASETS: readonly DatasetDescriptor[] = [FASHION_PRODUCT_IMAGES_SMALL];

export const DEFAULT_DATASET_ID = FASHION_PRODUCT_IMAGES_SMALL.id;

export function listDatasets(): readonly DatasetDescriptor[] {
  return DATASETS;
}

export function getDataset(id?: string): DatasetDescriptor {
  const wanted = id?.trim() || DEFAULT_DATASET_ID;
  const found = DATASETS.find((d) => d.id === wanted);
  if (!found) {
    throw new Error(
      `Dataset desconocido: "${wanted}". Disponibles: ${DATASETS.map((d) => d.id).join(", ")}`
    );
  }
  return found;
}

/**
 * `source` del catálogo para un dataset. Es el primer eje de la clave de
 * deduplicación `(source, source_product_id)`, así que tiene que ser estable
 * entre ejecuciones: si cambia, la segunda importación duplica todo.
 */
export function catalogSourceFor(descriptor: DatasetDescriptor): string {
  return descriptor.id;
}
