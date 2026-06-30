import type { DetectedItem, ProductLink } from "./types";
import { encodeQuery } from "./utils";

/**
 * Build clean search URLs for an item. We never scrape — only deep-link into
 * the public search pages of trusted marketplaces and verified retailers.
 */

type StoreDef = {
  provider: string;
  type: ProductLink["type"];
  trustLevel: ProductLink["trustLevel"];
  label: string;
  build: (q: string) => string;
};

const AMAZON_ES: StoreDef = {
  provider: "Amazon España",
  type: "marketplace",
  trustLevel: "high",
  label: "Buscar en Amazon",
  build: (q) => `https://www.amazon.es/s?k=${encodeQuery(q)}`,
};

const GOOGLE_SHOPPING: StoreDef = {
  provider: "Google Shopping",
  type: "shopping_search",
  trustLevel: "medium",
  label: "Comparar en Google Shopping",
  build: (q) => `https://www.google.com/search?tbm=shop&q=${encodeQuery(q)}`,
};

// Verified stores keyed by an internal category bucket.
const VERIFIED_STORES: Record<string, StoreDef[]> = {
  fashion: [
    store("Zalando", "high", "Ver en Zalando", (q) => `https://www.zalando.es/catalogo/?q=${encodeQuery(q)}`),
    store("ASOS", "medium", "Ver en ASOS", (q) => `https://www.asos.com/es/search/?q=${encodeQuery(q)}`),
    store("El Corte Inglés", "high", "Ver en El Corte Inglés", (q) => `https://www.elcorteingles.es/search/?s=${encodeQuery(q)}`),
    store("Zara", "high", "Ver en Zara", (q) => `https://www.zara.com/es/es/search?searchTerm=${encodeQuery(q)}`),
  ],
  sport: [
    store("Decathlon", "high", "Ver en Decathlon", (q) => `https://www.decathlon.es/search?Ntt=${encodeQuery(q)}`),
    store("Nike", "high", "Ver en Nike", (q) => `https://www.nike.com/es/w?q=${encodeQuery(q)}`),
    store("Adidas", "high", "Ver en Adidas", (q) => `https://www.adidas.es/search?q=${encodeQuery(q)}`),
    store("Zalando", "high", "Ver en Zalando", (q) => `https://www.zalando.es/catalogo/?q=${encodeQuery(q)}`),
  ],
  electronics: [
    store("MediaMarkt", "high", "Ver en MediaMarkt", (q) => `https://www.mediamarkt.es/es/search.html?query=${encodeQuery(q)}`),
    store("PcComponentes", "high", "Ver en PcComponentes", (q) => `https://www.pccomponentes.com/buscar/?query=${encodeQuery(q)}`),
    store("El Corte Inglés", "high", "Ver en El Corte Inglés", (q) => `https://www.elcorteingles.es/search/?s=${encodeQuery(q)}`),
  ],
  gaming: [
    store("PcComponentes", "high", "Ver en PcComponentes", (q) => `https://www.pccomponentes.com/buscar/?query=${encodeQuery(q)}`),
    store("MediaMarkt", "high", "Ver en MediaMarkt", (q) => `https://www.mediamarkt.es/es/search.html?query=${encodeQuery(q)}`),
  ],
  home: [
    store("IKEA", "high", "Ver en IKEA", (q) => `https://www.ikea.com/es/es/search/?q=${encodeQuery(q)}`),
    store("Leroy Merlin", "high", "Ver en Leroy Merlin", (q) => `https://www.leroymerlin.es/search?q=${encodeQuery(q)}`),
    store("Maisons du Monde", "medium", "Ver en Maisons du Monde", (q) => `https://www.maisonsdumonde.com/ES/es/search?q=${encodeQuery(q)}`),
  ],
  beauty: [
    store("Sephora", "high", "Ver en Sephora", (q) => `https://www.sephora.es/buscar?q=${encodeQuery(q)}`),
    store("Druni", "medium", "Ver en Druni", (q) => `https://www.druni.es/buscar?controller=search&s=${encodeQuery(q)}`),
    store("Primor", "medium", "Ver en Primor", (q) => `https://www.primor.eu/es/buscar?controller=search&s=${encodeQuery(q)}`),
  ],
};

function store(
  provider: string,
  trustLevel: ProductLink["trustLevel"],
  label: string,
  build: (q: string) => string
): StoreDef {
  return { provider, type: "verified_store", trustLevel, label, build };
}

/** Map a detected item to one of the verified-store buckets. */
function resolveBucket(item: DetectedItem): string {
  const hay = [item.category, item.subcategory, item.style]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const has = (...words: string[]) => words.some((w) => hay.includes(w));

  if (has("gaming", "gamer", "consola", "mando")) return "gaming";
  if (has("belleza", "beauty", "cosm", "maquillaje", "perfume", "skincare")) return "beauty";
  if (has("hogar", "mueble", "decora", "lámpara", "lampara", "silla", "interior", "cocina"))
    return "home";
  if (has("electr", "gadget", "portátil", "portatil", "auricular", "tech", "móvil", "movil", "tablet", "cámara", "camara", "tv"))
    return "electronics";
  if (has("deport", "sport", "outdoor", "running", "fitness", "trekking")) return "sport";
  if (
    has(
      "ropa",
      "calzado",
      "zapat",
      "moda",
      "accesorio",
      "bolso",
      "mochila",
      "reloj",
      "gafas",
      "chaqueta",
      "camiseta",
      "gorra"
    )
  )
    return "fashion";

  return "fashion";
}

export function buildProductLinks(item: DetectedItem): ProductLink[] {
  const primary = item.search_query_es || item.name;
  const verifiedQuery = item.verified_provider_queries?.[0] || primary;

  const links: ProductLink[] = [
    toLink(AMAZON_ES, primary),
    toLink(GOOGLE_SHOPPING, primary),
  ];

  const bucket = resolveBucket(item);
  for (const def of VERIFIED_STORES[bucket] ?? []) {
    links.push(toLink(def, verifiedQuery));
  }

  return links;
}

function toLink(def: StoreDef, query: string): ProductLink {
  return {
    provider: def.provider,
    type: def.type,
    url: def.build(query),
    label: def.label,
    trustLevel: def.trustLevel,
  };
}
