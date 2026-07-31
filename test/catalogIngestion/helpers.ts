import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogProduct, NormalizedProduct } from "../../lib/catalogIngestion/catalog/types";

/**
 * Utilidades compartidas de tests. Cada suite trabaja sobre un directorio
 * temporal propio (store + imágenes) para no tocar data/ del proyecto.
 */

export function tempDataDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `catalog-test-${prefix}-`));
  process.env.CATALOG_DATA_DIR = dir;
  process.env.CATALOG_IMAGES_DIR = join(dir, "images");
  return dir;
}

const FIXTURES_IMAGES_DIR = join(import.meta.dirname, "fixtures", "images");

export function fixtureImage(name: string): Buffer {
  return readFileSync(join(FIXTURES_IMAGES_DIR, name));
}

let counter = 0;

/** Producto normalizado mínimo para tests, con overrides. */
export function makeNormalized(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  counter++;
  return {
    source: "zara",
    sourceProductId: `test-${counter}`,
    canonicalUrl: `https://www.zara.com/es/es/test-p0000${counter}.html`,
    brand: "Zara",
    title: `Producto de prueba ${counter}`,
    description: null,
    category: "dress",
    subcategory: null,
    gender: "women",
    collection: null,
    color: "red",
    secondaryColors: [],
    material: null,
    pattern: null,
    style: null,
    price: 19.99,
    originalPrice: null,
    currency: "EUR",
    availability: "in_stock",
    merchant: "Zara",
    country: "ES",
    locale: "es-ES",
    images: [],
    primaryImage: null,
    variants: [],
    sizes: [],
    sku: null,
    gtin: null,
    sourceMetadata: {},
    extraction: null,
    contentHash: `hash-${counter}`,
    perceptualHash: null,
    textEmbedding: null,
    imageEmbedding: null,
    embeddingStatus: "pending",
    embeddingProvider: null,
    embeddingDimension: null,
    dataset: null,
    scrapedAt: new Date().toISOString(),
    origin: "scraped",
    ...overrides,
  };
}

export function makeProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  const now = new Date().toISOString();
  return {
    ...makeNormalized(),
    id: `id-${++counter}`,
    priceHistory: [],
    firstSeenAt: now,
    lastSeenAt: now,
    updatedAt: now,
    isActive: true,
    externalScore: null,
    ...overrides,
  };
}
