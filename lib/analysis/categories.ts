import type {
  AnalysisCategory,
  AnalysisIntensity,
  DetectedItem,
  ProductMatchingMode,
  VideoAnalysisConfig,
} from "@/lib/types";
import {
  DEFAULT_MATCHING_MODE,
  normalizeMatchingMode,
} from "@/lib/matching/types";

/**
 * Capa de categorías del análisis. Pura (sin I/O): se usa idéntica en backend y
 * cliente para (1) derivar la config, (2) construir el prompt dinámico y
 * (3) filtrar objetos por categoría entendiendo términos ES/EN.
 */

export const ALL_CATEGORIES: AnalysisCategory[] = [
  "clothing",
  "footwear",
  "watches_jewelry",
  "bags_accessories",
  "electronics",
  "vehicles",
  "furniture_home",
  "decoration",
];

export const CATEGORY_LABELS_ES: Record<AnalysisCategory, string> = {
  clothing: "Ropa",
  footwear: "Calzado",
  watches_jewelry: "Relojes y joyería",
  bags_accessories: "Bolsos y accesorios",
  electronics: "Electrónica",
  vehicles: "Vehículos",
  furniture_home: "Muebles y hogar",
  decoration: "Decoración",
  all: "Todos los productos",
};

/**
 * Palabras clave por categoría (ES + EN). Se comparan como substrings sobre
 * `name`, `category` y `subcategory` normalizados. Deliberadamente amplias para
 * absorber la variación léxica del modelo ("t-shirt" / "camiseta" / "playera").
 */
const CATEGORY_KEYWORDS: Record<Exclude<AnalysisCategory, "all">, string[]> = {
  clothing: [
    "clothing", "apparel", "garment", "ropa", "prenda", "vestimenta",
    "shirt", "t-shirt", "tshirt", "tee", "camiseta", "camisa", "playera",
    "polo", "blouse", "blusa", "top", "jersey", "sweater", "sudadera",
    "hoodie", "jacket", "chaqueta", "coat", "abrigo", "cazadora", "parka",
    "blazer", "americana", "dress", "vestido", "skirt", "falda",
    "trousers", "pants", "pantalon", "pantalones", "jeans", "vaqueros",
    "shorts", "bermudas", "leggings", "mallas", "suit", "traje",
    "uniform", "uniforme", "sportswear", "chandal", "outerwear",
    "cardigan", "chaleco", "vest", "underwear", "ropa interior",
    "socks", "calcetines", "scarf", "bufanda", "gloves", "guantes",
  ],
  footwear: [
    "footwear", "calzado", "shoe", "shoes", "zapato", "zapatos",
    "sneaker", "sneakers", "zapatilla", "zapatillas", "trainers",
    "boot", "boots", "bota", "botas", "sandal", "sandalia", "sandalias",
    "heel", "heels", "tacon", "tacones", "loafer", "mocasin",
    "slipper", "zapatilla de casa", "flip flop", "chancla",
  ],
  watches_jewelry: [
    "watch", "watches", "reloj", "relojes", "smartwatch",
    "jewelry", "jewellery", "joya", "joyeria", "joyería",
    "ring", "anillo", "necklace", "collar", "bracelet", "pulsera",
    "earring", "earrings", "pendiente", "pendientes", "brooch", "broche",
    "chain", "cadena", "pendant", "colgante", "cufflink", "gemelo",
  ],
  bags_accessories: [
    "bag", "bags", "bolso", "bolsos", "handbag", "purse", "cartera",
    "backpack", "mochila", "wallet", "billetera", "monedero",
    "belt", "cinturon", "cinturón", "hat", "sombrero", "cap", "gorra",
    "beanie", "gorro", "sunglasses", "gafas", "glasses", "lentes",
    "tie", "corbata", "accessory", "accesorio", "accessories",
    "clutch", "tote", "briefcase", "maletin", "maletín", "umbrella", "paraguas",
  ],
  electronics: [
    "electronics", "electronica", "electrónica", "phone", "smartphone",
    "movil", "móvil", "telefono", "teléfono", "iphone", "laptop",
    "portatil", "portátil", "notebook", "computer", "ordenador",
    "monitor", "pantalla", "tablet", "camera", "camara", "cámara",
    "headphone", "headphones", "auricular", "auriculares", "earbuds",
    "speaker", "altavoz", "console", "consola", "controller", "mando",
    "tv", "television", "televisor", "keyboard", "teclado", "mouse", "raton",
    "charger", "cargador", "drone", "dron", "gadget", "smartwatch band",
  ],
  vehicles: [
    "vehicle", "vehiculo", "vehículo", "car", "coche", "auto", "automovil",
    "motorcycle", "moto", "motocicleta", "bike", "bicycle", "bicicleta",
    "scooter", "patinete", "truck", "camion", "camión", "van", "furgoneta",
    "bus", "autobus", "boat", "barco", "yacht", "yate",
  ],
  furniture_home: [
    "furniture", "mueble", "muebles", "sofa", "sofá", "couch",
    "chair", "silla", "armchair", "sillon", "sillón", "table", "mesa",
    "desk", "escritorio", "bed", "cama", "shelf", "estanteria", "estantería",
    "wardrobe", "armario", "cabinet", "mueble", "stool", "taburete",
    "bench", "banco", "appliance", "electrodomestico", "electrodoméstico",
    "fridge", "nevera", "oven", "horno", "lamp", "lampara", "lámpara",
    "rug", "alfombra", "curtain", "cortina", "mattress", "colchon",
  ],
  decoration: [
    "decoration", "decor", "decoracion", "decoración", "vase", "jarron", "jarrón",
    "painting", "cuadro", "picture frame", "marco", "poster", "poster",
    "plant", "planta", "flower", "flor", "candle", "vela", "clock", "reloj de pared",
    "mirror", "espejo", "ornament", "adorno", "figurine", "figura",
    "cushion", "cojin", "cojín", "pillow", "almohada",
  ],
};

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * ¿El objeto detectado pertenece a alguna de las categorías seleccionadas?
 * "all" siempre acepta. La comparación es por substring sobre name/category/
 * subcategory normalizados (sin acentos, minúsculas), en ES y EN.
 */
export function isCategoryAllowed(
  item: Pick<DetectedItem, "name" | "category" | "subcategory">,
  categories: AnalysisCategory[],
): boolean {
  if (!categories.length || categories.includes("all")) return true;
  const haystack = `${norm(item.category)} ${norm(item.subcategory)} ${norm(item.name)}`;
  for (const cat of categories) {
    if (cat === "all") return true;
    const keywords = CATEGORY_KEYWORDS[cat];
    if (keywords?.some((kw) => haystack.includes(norm(kw)))) return true;
  }
  return false;
}

/** Categorías que se llevan puestas/sostienen (definen el modo person-centric). */
const WEARABLE_CATEGORIES: AnalysisCategory[] = [
  "clothing",
  "footwear",
  "watches_jewelry",
  "bags_accessories",
];

/**
 * Deriva la config completa a partir de la selección del usuario.
 * - Solo `clothing` (o solo categorías "wearable") ⇒ personCentric automático.
 * - `all` o categorías de entorno (muebles, decoración, vehículos) ⇒ no forzado.
 */
export function deriveAnalysisConfig(
  categories: AnalysisCategory[],
  analysisIntensity: AnalysisIntensity,
  overrides?: Partial<
    Pick<
      VideoAnalysisConfig,
      "personCentric" | "reverseImageSearch" | "matchingMode"
    >
  >,
): VideoAnalysisConfig {
  const cats = categories.length ? categories : ["all" as AnalysisCategory];
  const onlyWearable =
    !cats.includes("all") &&
    cats.every((c) => WEARABLE_CATEGORIES.includes(c));
  const matchingMode = overrides?.matchingMode ?? DEFAULT_MODE;
  return {
    categories: cats,
    analysisIntensity,
    personCentric: overrides?.personCentric ?? onlyWearable,
    // En catalog_only no hay búsqueda externa que autorizar: el flag queda a
    // false para que ningún camino intente gastar una llamada de pago.
    reverseImageSearch:
      matchingMode === "catalog_only"
        ? false
        : overrides?.reverseImageSearch ?? true,
    matchingMode,
  };
}

/** ¿Debe aceptarse este `relationship` dado el modo person-centric? */
export function isRelationshipAllowed(
  relationship: DetectedItem["relationship"],
  config: Pick<VideoAnalysisConfig, "personCentric" | "categories">,
): boolean {
  if (!config.personCentric) return true;
  const rel = relationship ?? "near_person";
  if (rel === "background") return false;
  if (rel === "worn" || rel === "used") return true;
  if (rel === "held" || rel === "near_person") {
    // held/near_person solo si se seleccionaron bolsos/accesorios o calzado.
    return (
      config.categories.includes("all") ||
      config.categories.includes("bags_accessories") ||
      config.categories.includes("footwear") ||
      config.categories.includes("watches_jewelry")
    );
  }
  return true;
}

/** Filtra los items de un análisis según categorías + relationship. */
export function filterItemsByConfig(
  items: DetectedItem[],
  config: VideoAnalysisConfig,
): DetectedItem[] {
  return items.filter(
    (it) =>
      isCategoryAllowed(it, config.categories) &&
      isRelationshipAllowed(it.relationship, config),
  );
}

/** Intensidad → intervalo mínimo entre análisis remotos (ms) para el cliente. */
export function intensityMinIntervalMs(intensity: AnalysisIntensity): number {
  switch (intensity) {
    case "fast":
      return 3000; // ~pocas detecciones profundas, pruebas rápidas
    case "exhaustive":
      return 800; // máxima densidad de detección (vídeos cortos)
    case "standard":
    default:
      return 1500;
  }
}

const DEFAULT_CATEGORIES = ((): AnalysisCategory[] => {
  const raw = process.env.NEXT_PUBLIC_VIDEO_ANALYSIS_DEFAULT_CATEGORIES;
  if (!raw) return ["clothing"];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AnalysisCategory =>
      (ALL_CATEGORIES as string[]).includes(s) || s === "all",
    );
  return parts.length ? parts : ["clothing"];
})();

const DEFAULT_INTENSITY: AnalysisIntensity = ((): AnalysisIntensity => {
  const raw = process.env.NEXT_PUBLIC_VIDEO_ANALYSIS_DEFAULT_INTENSITY;
  return raw === "fast" || raw === "exhaustive" || raw === "standard"
    ? raw
    : "standard";
})();

/**
 * Fuente de coincidencias por defecto. `NEXT_PUBLIC_PRODUCT_MATCHING_MODE`
 * permite que un despliegue arranque en otro modo; sin ella, catalog_first
 * (el recomendado). La elección del usuario SIEMPRE gana sobre esto.
 */
const DEFAULT_MODE: ProductMatchingMode =
  normalizeMatchingMode(process.env.NEXT_PUBLIC_PRODUCT_MATCHING_MODE) ??
  DEFAULT_MATCHING_MODE;

export const DEFAULT_ANALYSIS_MATCHING_MODE = DEFAULT_MODE;

export function defaultAnalysisConfig(): VideoAnalysisConfig {
  return deriveAnalysisConfig(DEFAULT_CATEGORIES, DEFAULT_INTENSITY);
}

/** Serializa la config para el body de la petición (sin campos derivables). */
export function serializeConfig(config: VideoAnalysisConfig): {
  categories: AnalysisCategory[];
  analysisIntensity: AnalysisIntensity;
  personCentric: boolean;
  reverseImageSearch: boolean;
  matchingMode: ProductMatchingMode;
} {
  return {
    categories: config.categories,
    analysisIntensity: config.analysisIntensity,
    personCentric: config.personCentric,
    reverseImageSearch: config.reverseImageSearch,
    matchingMode: config.matchingMode,
  };
}

/** Parsea/valida una config recibida del cliente en el backend. */
export function parseConfig(raw: unknown): VideoAnalysisConfig {
  if (!raw || typeof raw !== "object") return defaultAnalysisConfig();
  const o = raw as Record<string, unknown>;
  const categories = Array.isArray(o.categories)
    ? (o.categories.filter(
        (c): c is AnalysisCategory =>
          typeof c === "string" &&
          ((ALL_CATEGORIES as string[]).includes(c) || c === "all"),
      ) as AnalysisCategory[])
    : DEFAULT_CATEGORIES;
  const intensity: AnalysisIntensity =
    o.analysisIntensity === "fast" ||
    o.analysisIntensity === "exhaustive" ||
    o.analysisIntensity === "standard"
      ? o.analysisIntensity
      : DEFAULT_INTENSITY;
  return deriveAnalysisConfig(
    categories.length ? categories : DEFAULT_CATEGORIES,
    intensity,
    {
      personCentric:
        typeof o.personCentric === "boolean" ? o.personCentric : undefined,
      reverseImageSearch:
        typeof o.reverseImageSearch === "boolean"
          ? o.reverseImageSearch
          : undefined,
      // Un modo desconocido NO rompe el análisis: cae al default.
      matchingMode: normalizeMatchingMode(o.matchingMode) ?? undefined,
    },
  );
}
