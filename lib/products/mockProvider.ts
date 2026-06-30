import type { CatalogItem, RecommendationInput } from "@/lib/catalog/types";
import type { ProductProvider } from "./types";
import { placeholderImage } from "./shared";

/**
 * Proveedor mock: genera productos ficticios pero realistas (título, url,
 * imagen, precio, marca, similitud y motivo) de forma determinista por item,
 * para que el catálogo y la UI funcionen sin ninguna API real.
 *
 * Activado salvo que ENABLE_MOCK_PRODUCTS === "false".
 */
export class MockProductProvider implements ProductProvider {
  readonly name = "MockProductProvider";

  isEnabled(): boolean {
    return process.env.ENABLE_MOCK_PRODUCTS !== "false";
  }

  async search(query: string, item: CatalogItem): Promise<RecommendationInput[]> {
    const rng = mulberry32(hashString(`${item.id}:${query}`));
    const count = 3 + Math.floor(rng() * 3); // 3..5
    const stores = storesForType(item.type);
    const priceRange = priceRangeForType(item.type);
    const color = item.color ? `${item.color} ` : "";

    const results: RecommendationInput[] = [];
    for (let i = 0; i < count; i++) {
      const store = stores[i % stores.length];
      const brand = item.visibleBrand || pick(rng, GENERIC_BRANDS);
      const variant = pick(rng, TITLE_VARIANTS);
      const title = capitalize(
        `${brand} ${color}${item.name} ${variant}`.replace(/\s+/g, " ").trim()
      );
      const price = round2(
        priceRange[0] + rng() * (priceRange[1] - priceRange[0])
      );
      const similarity = round2(0.92 - i * 0.07 - rng() * 0.03);

      results.push({
        provider: `${store.label} (demo)`,
        title,
        productUrl: store.url(query),
        imageUrl: placeholderImage(title, item.color),
        price,
        currency: "EUR",
        brand,
        similarityScore: Math.max(0.4, similarity),
        reason: buildReason(item, rng),
      });
    }
    return results.sort(
      (a, b) => (b.similarityScore ?? 0) - (a.similarityScore ?? 0)
    );
  }
}

// --- helpers ---------------------------------------------------------------

const GENERIC_BRANDS = [
  "Urban Basics",
  "NorthLine",
  "Studio 84",
  "Aura",
  "Vela",
  "Modena",
  "Kairos",
  "Lumen",
];

const TITLE_VARIANTS = [
  "edición esencial",
  "corte regular",
  "premium",
  "colección 2026",
  "unisex",
  "edición limitada",
];

type Store = { label: string; url: (q: string) => string };

const AMAZON: Store = {
  label: "Amazon",
  url: (q) => `https://www.amazon.es/s?k=${encodeURIComponent(q)}`,
};

function storesForType(type: CatalogItem["type"]): Store[] {
  const z = (label: string, base: string): Store => ({
    label,
    url: (q) => `${base}${encodeURIComponent(q)}`,
  });
  switch (type) {
    case "clothing":
    case "footwear":
    case "accessory":
      return [AMAZON, z("Zalando", "https://www.zalando.es/catalogo/?q="), z("ASOS", "https://www.asos.com/es/search/?q=")];
    case "electronics":
      return [AMAZON, z("MediaMarkt", "https://www.mediamarkt.es/es/search.html?query="), z("PcComponentes", "https://www.pccomponentes.com/buscar/?query=")];
    case "home":
      return [AMAZON, z("IKEA", "https://www.ikea.com/es/es/search/?q="), z("Leroy Merlin", "https://www.leroymerlin.es/search?q=")];
    case "beauty":
      return [AMAZON, z("Sephora", "https://www.sephora.es/buscar?q=")];
    default:
      return [AMAZON];
  }
}

function priceRangeForType(type: CatalogItem["type"]): [number, number] {
  switch (type) {
    case "clothing":
      return [15, 70];
    case "footwear":
      return [40, 130];
    case "accessory":
      return [12, 90];
    case "electronics":
      return [29, 320];
    case "home":
      return [20, 200];
    case "beauty":
      return [8, 45];
    default:
      return [10, 80];
  }
}

function buildReason(item: CatalogItem, rng: () => number): string {
  const bits = [
    item.style ? `encaja con el estilo ${item.style}` : "",
    item.color ? `mismo tono ${item.color}` : "",
    "buena relación calidad-precio",
    "alta valoración de usuarios",
  ].filter(Boolean);
  return capitalize(pick(rng, bits) || "recomendado para este look") + ".";
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
