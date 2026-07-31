import { createHash } from "node:crypto";

/**
 * Normalización de atributos de producto. El objetivo es que dos fichas del
 * mismo producto (misma tienda o tiendas distintas) converjan al mismo texto
 * normalizado para poder deduplicar por marca+título+color.
 */

/** Minúsculas, sin acentos, sin símbolos, espacios colapsados. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mapa ES/EN → color canónico en inglés. */
const COLOR_MAP: Record<string, string> = {
  negro: "black", black: "black",
  blanco: "white", white: "white", "off white": "white", crudo: "white", ecru: "white",
  rojo: "red", red: "red", burdeos: "burgundy", burgundy: "burgundy", granate: "burgundy",
  azul: "blue", blue: "blue", marino: "navy", navy: "navy", "azul marino": "navy",
  celeste: "light blue", "light blue": "light blue",
  verde: "green", green: "green", caqui: "khaki", khaki: "khaki", oliva: "olive", olive: "olive",
  amarillo: "yellow", yellow: "yellow", mostaza: "mustard", mustard: "mustard",
  naranja: "orange", orange: "orange",
  rosa: "pink", pink: "pink", fucsia: "fuchsia", fuchsia: "fuchsia",
  morado: "purple", purple: "purple", lila: "lilac", lilac: "lilac", violeta: "purple",
  marron: "brown", brown: "brown", camel: "camel", beige: "beige", arena: "beige", taupe: "taupe",
  gris: "grey", grey: "grey", gray: "grey", antracita: "anthracite", anthracite: "anthracite",
  plata: "silver", silver: "silver", dorado: "gold", gold: "gold",
  crema: "cream", cream: "cream", multicolor: "multicolor",
};

export function normalizeColor(input: string | null | undefined): string | null {
  const t = normalizeText(input);
  if (!t) return null;
  if (COLOR_MAP[t]) return COLOR_MAP[t];
  // Busca la primera palabra de color conocida dentro del texto
  // ("azul marino intenso" → navy antes que blue, por eso probamos bigramas primero)
  const words = t.split(" ");
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (COLOR_MAP[bigram]) return COLOR_MAP[bigram];
  }
  for (const w of words) if (COLOR_MAP[w]) return COLOR_MAP[w];
  return t;
}

/** Categorías canónicas (alineadas con las de pause2shop). */
const CATEGORY_MAP: Record<string, string> = {
  vestido: "dress", vestidos: "dress", dress: "dress", dresses: "dress",
  camiseta: "t-shirt", camisetas: "t-shirt", "t shirt": "t-shirt", tshirt: "t-shirt", tee: "t-shirt",
  camisa: "shirt", camisas: "shirt", shirt: "shirt", blusa: "blouse", blouse: "blouse",
  pantalon: "trousers", pantalones: "trousers", trousers: "trousers", pants: "trousers",
  vaquero: "jeans", vaqueros: "jeans", jeans: "jeans", denim: "jeans",
  falda: "skirt", faldas: "skirt", skirt: "skirt",
  chaqueta: "jacket", chaquetas: "jacket", jacket: "jacket", cazadora: "jacket",
  blazer: "blazer", americana: "blazer",
  abrigo: "coat", abrigos: "coat", coat: "coat", parka: "coat", trench: "coat", gabardina: "coat",
  jersey: "sweater", jerseis: "sweater", sweater: "sweater", sudadera: "sweatshirt",
  sweatshirt: "sweatshirt", hoodie: "sweatshirt", cardigan: "cardigan", punto: "sweater", knitwear: "sweater",
  zapato: "shoes", zapatos: "shoes", shoes: "shoes", zapatilla: "sneakers", zapatillas: "sneakers",
  sneakers: "sneakers", trainers: "sneakers", bota: "boots", botas: "boots", boots: "boots",
  sandalia: "sandals", sandalias: "sandals", sandals: "sandals", tacon: "heels", heels: "heels",
  bolso: "bag", bolsos: "bag", bag: "bag", bags: "bag", mochila: "backpack", backpack: "backpack",
  cinturon: "belt", belt: "belt", bufanda: "scarf", scarf: "scarf", scarves: "scarf",
  gorra: "cap", cap: "cap", sombrero: "hat", hat: "hat",
  gafas: "sunglasses", sunglasses: "sunglasses", reloj: "watch", watch: "watch",
  short: "shorts", shorts: "shorts", bermuda: "shorts",
  top: "top", tops: "top", body: "bodysuit", bodysuit: "bodysuit", mono: "jumpsuit", jumpsuit: "jumpsuit",
  // Vocabulario de `articleType` del dataset fashion-product-images-small que
  // la regla de plural no resuelve sola (o cuyo singular tampoco estaba).
  handbag: "bag", handbags: "bag", clutch: "bag", clutches: "bag",
  "flip flop": "sandals", "flip flops": "sandals", chanclas: "sandals",
  flat: "shoes", flats: "shoes", mocasin: "shoes", loafers: "shoes",
  tunic: "top", tunics: "top", kurta: "top", kurtas: "top", kurtis: "top",
  saree: "dress", sarees: "dress", sari: "dress",
  wallet: "wallet", wallets: "wallet", cartera: "wallet",
  earring: "jewelry", earrings: "jewelry", pendientes: "jewelry",
  necklace: "jewelry", collar: "jewelry", bracelet: "jewelry", pulsera: "jewelry",
  ring: "jewelry", anillo: "jewelry", pendant: "jewelry",
  sock: "socks", socks: "socks", calcetines: "socks",
  capri: "trousers", capris: "trousers", leggings: "trousers", jeggings: "trousers",
  // Cuidado personal. Estos NO son prendas, pero el dataset los trae y el
  // catálogo tiene que decir algo honesto de ellos.
  //
  // Sin estas entradas, "Perfume and Body Mist" caía en el bucle por palabras,
  // encontraba "body" y quedaba clasificado como `bodysuit`: 22 perfumes
  // catalogados como bodies. Como el bucle recorre las palabras EN ORDEN, tener
  // "perfume" en el mapa lo resuelve antes de llegar a "body".
  perfume: "fragrance", fragrance: "fragrance", colonia: "fragrance",
  perfumes: "fragrance", deodorant: "fragrance", desodorante: "fragrance",
  // Descriptores GRUESOS que devuelve el modelo de visión al describir un
  // objeto del frame ("prenda superior", "calzado"…). No son categorías finas
  // de catálogo, así que se mapean directamente a la FAMILIA.
  //
  // Sin esto no casaban con nada: `categoriesMatch` es filtro duro, así que una
  // camiseta detectada como "prenda superior" descartaba el catálogo entero y
  // la UI decía "no hay productos indexados para esta categoría" teniendo mil.
  // Se mapean a familia y no a una categoría fina a propósito: "prenda
  // superior" no dice si es camiseta, camisa o jersey, y elegir una sería
  // inventarse precisión que la detección no tiene. Quien discrimina de verdad
  // es el embedding visual.
  prenda: "clothing", prendas: "clothing", ropa: "clothing",
  "prenda superior": "clothing", "prenda inferior": "clothing",
  "parte superior": "clothing", "parte inferior": "clothing",
  clothing: "clothing", apparel: "clothing", garment: "clothing",
  calzado: "footwear", footwear: "footwear",
  accesorio: "bags_accessories", accesorios: "bags_accessories",
  complemento: "bags_accessories", complementos: "bags_accessories",
  accessory: "bags_accessories", accessories: "bags_accessories",
  bags_accessories: "bags_accessories",
  joyeria: "watches_jewelry", jewellery: "watches_jewelry",
  watches_jewelry: "watches_jewelry",
  lipstick: "makeup", makeup: "makeup", maquillaje: "makeup",
  "nail polish": "makeup", "lip gloss": "makeup", mascara: "makeup",
  foundation: "makeup", kajal: "makeup", eyeshadow: "makeup",
};

/**
 * Singular inglés aproximado. No pretende ser un lematizador: solo cubre los
 * plurales regulares con los que llegan los `articleType` del dataset
 * ("Shirts", "Watches", "Jackets").
 */
function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  // "watches" -> "watch", pero no "dresses" -> "dress" por esta vía (ya está
  // en el mapa) ni "shoes" -> "sho".
  if (/(ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function normalizeCategory(input: string | null | undefined): string | null {
  const t = normalizeText(input);
  if (!t) return null;
  if (CATEGORY_MAP[t]) return CATEGORY_MAP[t];
  const words = t.split(" ");
  for (const w of words) if (CATEGORY_MAP[w]) return CATEGORY_MAP[w];

  // Último recurso: plural inglés. Se intenta SOLO cuando nada ha casado, así
  // que no puede alterar ningún resultado que ya funcionaba.
  //
  // Sin esto, "Shirts" se quedaba como "shirts" — que no está en el mapa ni en
  // CATEGORY_FAMILY —, así que un producto de dataset con articleType "Shirts"
  // no casaba por categoría ni por familia con un item detectado como "shirt".
  // El matching fallaba en silencio, sin error y sin resultado.
  const singularFull = singularize(t);
  if (CATEGORY_MAP[singularFull]) return CATEGORY_MAP[singularFull];
  for (const w of words) {
    const singular = singularize(w);
    if (CATEGORY_MAP[singular]) return CATEGORY_MAP[singular];
  }
  return t;
}

/**
 * Familia gruesa de cada categoría canónica — alineada con AnalysisCategory
 * de pause2shop (clothing, footwear, bags_accessories, watches_jewelry…).
 * pause2shop detecta a este nivel grueso; el catálogo almacena al nivel fino.
 */
const CATEGORY_FAMILY: Record<string, string> = {
  dress: "clothing", "t-shirt": "clothing", shirt: "clothing", blouse: "clothing",
  trousers: "clothing", jeans: "clothing", skirt: "clothing", jacket: "clothing",
  blazer: "clothing", coat: "clothing", sweater: "clothing", sweatshirt: "clothing",
  cardigan: "clothing", shorts: "clothing", top: "clothing", bodysuit: "clothing",
  jumpsuit: "clothing",
  shoes: "footwear", sneakers: "footwear", boots: "footwear", sandals: "footwear",
  heels: "footwear",
  bag: "bags_accessories", backpack: "bags_accessories", belt: "bags_accessories",
  scarf: "bags_accessories", cap: "bags_accessories", hat: "bags_accessories",
  sunglasses: "bags_accessories", wallet: "bags_accessories",
  socks: "clothing",
  watch: "watches_jewelry", jewelry: "watches_jewelry",
  // `beauty` no es una familia que pause2shop detecte en vídeo: se declara para
  // que estas fichas tengan una familia real en vez de `null`, y para que quede
  // explícito que NO son ropa.
  fragrance: "beauty", makeup: "beauty",
};

export function categoryFamily(canonical: string | null): string | null {
  if (!canonical) return null;
  return CATEGORY_FAMILY[canonical] ?? null;
}

/**
 * ¿Son compatibles dos categorías? Cubre la asimetría de granularidad entre
 * pause2shop (familias gruesas: "clothing") y el catálogo (finas: "dress"):
 * iguales tras normalizar, o una es la familia de la otra. "all" no filtra.
 */
export function categoriesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizeCategory(a);
  const nb = normalizeCategory(b);
  if (!na || !nb || na === "all" || nb === "all") return true;
  if (na === nb) return true;
  return categoryFamily(na) === nb || categoryFamily(nb) === na;
}

export function normalizeBrand(input: string | null | undefined): string | null {
  const t = normalizeText(input);
  if (!t) return null;
  // Alias frecuentes de las tiendas soportadas
  const aliases: Record<string, string> = {
    "h m": "hm", "h and m": "hm", "hennes mauritz": "hm",
    "zara home": "zara", "mango outlet": "mango",
  };
  return aliases[t] ?? t;
}

/** Clave de dedup marca+título+color (nivel 7 del dedup multinivel). */
export function identityKey(
  brand: string | null,
  title: string,
  color: string | null
): string {
  return [normalizeBrand(brand) ?? "", normalizeText(title), normalizeColor(color) ?? ""].join("|");
}

/**
 * Hash de contenido: sha256 de los campos que definen la ficha. Si no cambia
 * entre syncs, el producto solo actualiza lastSeenAt (sync incremental barato).
 *
 * La TAXONOMÍA cuenta como contenido. Antes no entraba, y eso hacía que un
 * cambio de categoría fuese invisible al detector de cambios: se corrigió el
 * mapeo que clasificaba 22 perfumes como `bodysuit`, se reimportaron las 1.000
 * fichas, el job reportó "995 actualizados"… y los 22 perfumes seguían siendo
 * bodies, porque el hash no había cambiado y `ingestProduct` solo tocaba
 * `lastSeenAt`. La categoría decide con qué casa un producto en el matching, así
 * que un cambio de categoría ES un cambio de la ficha.
 *
 * Coste de incluirla: la primera ejecución tras este cambio ve todas las fichas
 * existentes como "cambiadas" y las reescribe una vez. Es una escritura por
 * producto, sin pérdida de datos (`ingestProduct` conserva id, origen,
 * priceHistory y firstSeenAt).
 */
export function computeContentHash(p: {
  title: string;
  brand: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  availability: string;
  color: string | null;
  images: Array<{ url: string }>;
  sizes: string[];
  category?: string | null;
  subcategory?: string | null;
  gender?: string | null;
}): string {
  const payload = JSON.stringify([
    p.title, p.brand, p.description, p.price, p.currency,
    p.availability, p.color, p.images.map((i) => i.url), p.sizes,
    p.category ?? null, p.subcategory ?? null, p.gender ?? null,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

/** Precio "12,95 €" / "$12.95" / "1.299,00" → número. */
export function parsePrice(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  const cleaned = input.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  // Si hay coma después del último punto, la coma es el separador decimal (formato EU)
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const CURRENCIES = new Set(["EUR", "USD", "GBP", "SEK", "PLN", "MXN", "CHF", "DKK", "NOK"]);

export function normalizeCurrency(input: string | null | undefined): string | null {
  if (!input) return null;
  const t = input.trim().toUpperCase();
  if (CURRENCIES.has(t)) return t;
  if (t === "€") return "EUR";
  if (t === "$") return "USD";
  if (t === "£") return "GBP";
  return t.length === 3 ? t : null;
}

export function normalizeAvailability(
  input: string | null | undefined
): "in_stock" | "out_of_stock" | "unknown" {
  const t = normalizeText(input);
  if (!t) return "unknown";
  if (/(instock|in stock|available|disponible|backorder|preorder|limitedavailability)/.test(t.replace(/\s+/g, " "))) {
    return "in_stock";
  }
  if (/(outofstock|out of stock|soldout|sold out|agotado|discontinued)/.test(t)) {
    return "out_of_stock";
  }
  // schema.org manda URLs tipo https://schema.org/InStock
  if (t.includes("in stock") || t.endsWith("instock")) return "in_stock";
  return "unknown";
}
