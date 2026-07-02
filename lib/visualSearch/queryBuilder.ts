import type { DetectedItem } from "@/lib/types";

/**
 * Genera queries de búsqueda optimizadas (español + inglés) a partir de la
 * evidencia visual del item. NUNCA inventa marcas: solo usa visible_brand
 * (evidencia clara) o brand_guess (evidencia visual fuerte según el prompt
 * de visión). El texto OCR visible (visible_text) se incluye porque suele ser
 * el discriminador más potente para encontrar el producto exacto.
 */

export const COLOR_EN: Record<string, string> = {
  negro: "black", blanco: "white", gris: "grey", azul: "blue",
  rojo: "red", verde: "green", amarillo: "yellow", rosa: "pink",
  morado: "purple", violeta: "purple", marron: "brown", "marrón": "brown",
  beige: "beige", naranja: "orange", burdeos: "burgundy", granate: "burgundy",
  crema: "cream", dorado: "gold", plateado: "silver", denim: "denim",
  "azul marino": "navy blue", turquesa: "turquoise", caqui: "khaki",
};

export const CATEGORY_EN: Record<string, string> = {
  camiseta: "t-shirt", sudadera: "hoodie", pantalon: "trousers",
  "pantalón": "trousers", vaqueros: "jeans", chaqueta: "jacket",
  abrigo: "coat", vestido: "dress", falda: "skirt", camisa: "shirt",
  zapatillas: "sneakers", zapatos: "shoes", botas: "boots",
  bolso: "bag", mochila: "backpack", gorra: "cap", gafas: "sunglasses",
  reloj: "watch", auriculares: "headphones", ropa: "clothing",
  calzado: "footwear", silla: "chair", mesa: "table", lampara: "lamp",
  "lámpara": "lamp", sofa: "sofa", "sofá": "sofa",
};

export function translate(map: Record<string, string>, value?: string | null): string | null {
  if (!value) return null;
  const key = value.toLowerCase().trim();
  if (map[key]) return map[key];
  for (const [es, en] of Object.entries(map)) {
    if (key.includes(es)) return en;
  }
  return value; // ya podría estar en inglés (sneakers, hoodie...)
}

function compact(parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const key = q.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || key.split(" ").length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(q.trim());
  }
  return out;
}

/**
 * Devuelve queries ordenadas de más específica a más genérica.
 * Las primeras `maxQueriesPerItem` son las que se lanzan a los motores.
 */
export function buildSearchQueries(item: DetectedItem, max = 4): string[] {
  const brand = item.visible_brand || item.brand_guess || null;
  const categoryEn = translate(CATEGORY_EN, item.subcategory || item.category);
  const colorEn = translate(COLOR_EN, item.color);
  const text = item.visible_text?.trim() || null;
  const genderEn =
    item.gender_fit === "hombre" ? "men" : item.gender_fit === "mujer" ? "women" : null;

  const queries: string[] = [];

  // 1) Marca + OCR + categoría (lo más discriminante).
  if (brand && text && text.toLowerCase() !== brand.toLowerCase()) {
    queries.push(compact([brand, `"${text}"`, categoryEn, colorEn]));
  }
  // 2) Marca + categoría + color (EN — los feeds de shopping indexan mejor en inglés).
  if (brand) {
    queries.push(compact([brand, colorEn, categoryEn, genderEn]));
    // 3) Variante con detalle de logo si lo hay.
    if (item.logo_visible && item.logo_description) {
      const logoHint = /manga|sleeve/i.test(item.logo_description)
        ? "logo sleeve"
        : /pecho|chest/i.test(item.logo_description)
          ? "chest logo"
          : "logo";
      queries.push(compact([brand, colorEn, categoryEn, logoHint]));
    }
  }
  // 4) OCR sin marca (el texto impreso identifica el producto).
  if (!brand && text) {
    queries.push(compact([`"${text}"`, categoryEn, colorEn]));
  }
  // 5) Query del modelo de visión (ya optimizada para Amazon ES).
  if (item.search_query_es) queries.push(item.search_query_es);
  // 6) Descriptiva EN sin marca.
  queries.push(compact([colorEn, categoryEn, item.pattern === "liso" ? null : item.pattern, genderEn]));
  // 7) Alternativas del modelo.
  queries.push(...(item.alternative_queries ?? []));

  return dedupe(queries).slice(0, max);
}
