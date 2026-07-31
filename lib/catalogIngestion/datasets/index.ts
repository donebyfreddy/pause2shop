/**
 * Importación de catálogos desde datasets públicos de moda.
 *
 * Punto de entrada único: el resto del sistema importa de aquí y no de los
 * módulos internos, para que reorganizarlos no rompa a nadie.
 */
export { brandAllowlist, extractBrand } from "./brands";
export { prepareDatasetImage } from "./images";
export {
  buildCheckpoint,
  countersToProgress,
  DatasetImporter,
  resolveOptions,
} from "./importer";
export {
  datasetImagePath,
  datasetThumbPath,
  datasetUri,
  matchesFilters,
  normalizeDatasetRow,
} from "./normalize";
export { getReader, getReaderWithFallback, type DatasetReader } from "./reader";
export {
  catalogSourceFor,
  DEFAULT_DATASET_ID,
  FASHION_PRODUCT_IMAGES_SMALL,
  getDataset,
  listDatasets,
} from "./registry";
export type {
  CatalogDatasetImporter,
  DatasetDescriptor,
  DatasetImportCheckpoint,
  DatasetImportCounters,
  DatasetImportOptions,
  DatasetImportResult,
  DatasetInfo,
  DatasetProviderId,
  FashionDatasetRow,
} from "./types";
