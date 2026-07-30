import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { parsePrice, normalizeCurrency } from "../normalization/normalize";
import type { ExtractedVariant, ExtractionLayer } from "./types";

/**
 * Extractores de datos ESTRUCTURADOS: JSON-LD, OpenGraph/meta y microdata.
 *
 * Son la vía preferente porque son los datos que la propia tienda publica para
 * Google: están pensados para ser leídos por máquinas, son estables entre
 * rediseños y no requieren adivinar selectores.
 */

/** Todos los nodos JSON-LD con @type Product (incluye @graph y arrays). */
export function findJsonLdProducts($: CheerioAPI): Record<string, any>[] {
  const products: Record<string, any>[] = [];
  const visit = (node: any, depth = 0): void => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && /^(Product|ProductGroup|IndividualProduct)$/i.test(t))) {
      products.push(node);
    }
    // Un ItemPage/WebPage puede llevar el Product colgando de mainEntity.
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "hasVariant", "isSimilarTo"]) {
      if (node[key]) visit(node[key], depth + 1);
    }
  };

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      visit(JSON.parse(raw));
    } catch {
      // JSON-LD roto (pasa: comas finales, HTML sin escapar). Intentamos
      // recortar hasta el último `}` equilibrado antes de rendirnos.
      const salvaged = salvageJson(raw);
      if (salvaged) {
        try {
          visit(JSON.parse(salvaged));
        } catch {
          /* sin suerte: el resto de extractores cubren el caso */
        }
      }
    }
  });
  return products;
}

/**
 * Extrae el objeto JSON que sigue a un marcador, contando llaves.
 *
 * Es lo que hace falta para el JSON embebido de las tiendas
 * (`window.zara.viewPayload`, `var productArticleDetails = {…}`): un regex con
 * `[\s\S]*?\}` se rompe con el primer `}` anidado o con un `;` inesperado, y
 * "se rompe" aquí significa un precio a null. Este lector respeta cadenas y
 * escapes, así que devuelve el objeto completo o nada.
 */
export function extractBalancedJson(html: string, marker: RegExp): string | null {
  const match = marker.exec(html);
  if (!match) return null;
  const start = html.indexOf("{", match.index + match[0].length - 1);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

/** Recorta un JSON truncado al último objeto/array equilibrado. */
function salvageJson(raw: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastBalanced = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) lastBalanced = i;
    }
  }
  return lastBalanced > 0 ? raw.slice(0, lastBalanced + 1) : null;
}

function textOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const t = textOf(item);
      if (t) return t;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return textOf(obj.name ?? obj["@value"] ?? obj.value ?? obj.url);
  }
  return null;
}

function urlsOf(value: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (!v) return;
    if (typeof v === "string") {
      if (/^https?:\/\//i.test(v) || v.startsWith("//") || v.startsWith("/")) out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      visit(obj.contentUrl ?? obj.url ?? obj["@id"]);
    }
  };
  visit(value);
  return [...new Set(out)];
}

function offerList(ld: Record<string, any>): any[] {
  const raw = ld.offers ?? ld.offer;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  // AggregateOffer envuelve las ofertas reales en .offers
  return list.flatMap((o) => {
    if (o && typeof o === "object" && /AggregateOffer/i.test(String(o["@type"] ?? ""))) {
      const inner = o.offers;
      const innerList = Array.isArray(inner) ? inner : inner ? [inner] : [];
      return innerList.length > 0 ? innerList : [o];
    }
    return [o];
  });
}

/** El precio "vigente" y el tachado, desde la lista de ofertas de JSON-LD. */
function priceFromOffers(ld: Record<string, any>): {
  price: number | null;
  originalPrice: number | null;
  currency: string | null;
  availability: string | null;
} {
  const offers = offerList(ld);
  let price: number | null = null;
  let currency: string | null = null;
  let availability: string | null = null;
  let originalPrice: number | null = null;

  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const p = parsePrice(offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price);
    if (p != null && (price == null || p < price)) price = p;
    currency ??= normalizeCurrency(
      offer.priceCurrency ?? offer.priceSpecification?.priceCurrency ?? ld.priceCurrency
    );
    availability ??= textOf(offer.availability);
    // schema.org no tiene "precio anterior" estándar; las tiendas usan
    // priceSpecification con ListPrice o highPrice de AggregateOffer.
    const list = parsePrice(
      offer.highPrice ??
        (Array.isArray(offer.priceSpecification)
          ? offer.priceSpecification.find((s: any) => /ListPrice|StrikethroughPrice/i.test(String(s?.["@type"] ?? s?.priceType ?? "")))?.price
          : /ListPrice|StrikethroughPrice/i.test(String(offer.priceSpecification?.priceType ?? ""))
            ? offer.priceSpecification?.price
            : null)
    );
    if (list != null && (originalPrice == null || list > originalPrice)) originalPrice = list;
  }
  if (originalPrice != null && price != null && originalPrice <= price) originalPrice = null;
  return { price, originalPrice, currency, availability };
}

/** Variantes desde ofertas + hasVariant. Una talla NO es un producto aparte. */
function variantsFromLd(ld: Record<string, any>): ExtractedVariant[] {
  const variants: ExtractedVariant[] = [];
  const push = (source: any, fallbackColor: string | null): void => {
    if (!source || typeof source !== "object") return;
    const item = source.itemOffered ?? source;
    const size = textOf(item.size ?? source.size ?? item.additionalProperty);
    const color = textOf(item.color ?? source.color) ?? fallbackColor;
    const sku = textOf(item.sku ?? source.sku ?? item.mpn);
    if (!size && !color && !sku) return;
    variants.push({
      color,
      size,
      sku,
      price: parsePrice(source.price ?? item.price),
      currency: normalizeCurrency(source.priceCurrency ?? item.priceCurrency),
      availability: textOf(source.availability ?? item.availability),
    });
  };

  const baseColor = textOf(ld.color);
  for (const offer of offerList(ld)) push(offer, baseColor);
  const hasVariant = Array.isArray(ld.hasVariant) ? ld.hasVariant : ld.hasVariant ? [ld.hasVariant] : [];
  for (const variant of hasVariant) {
    const color = textOf(variant?.color) ?? baseColor;
    const offers = offerList(variant ?? {});
    if (offers.length === 0) push(variant, color);
    else for (const offer of offers) push({ ...offer, color }, color);
  }
  // Dedup por color+talla+sku: las tiendas repiten ofertas por mercado.
  const seen = new Set<string>();
  return variants.filter((v) => {
    const key = `${v.color ?? ""}|${v.size ?? ""}|${v.sku ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Capa JSON-LD. Devuelve null si la página no publica ningún Product. */
export function extractJsonLd($: CheerioAPI): ExtractionLayer | null {
  const products = findJsonLdProducts($);
  if (products.length === 0) return null;
  // Si hay varios, el más completo (más claves) es el de la ficha; los otros
  // suelen ser productos relacionados.
  const ld = products.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];

  const { price, originalPrice, currency, availability } = priceFromOffers(ld);
  const variants = variantsFromLd(ld);
  const sizes = [...new Set(variants.map((v) => v.size).filter((s): s is string => Boolean(s)))];

  return {
    kind: "jsonld",
    fields: {
      productType: "product",
      title: textOf(ld.name),
      brand: textOf(ld.brand ?? ld.manufacturer),
      model: textOf(ld.model ?? ld.mpn),
      description: textOf(ld.description),
      category: textOf(ld.category),
      color: textOf(ld.color),
      material: textOf(ld.material),
      pattern: textOf(ld.pattern),
      gender: textOf(ld.audience?.suggestedGender ?? ld.gender ?? ld.suggestedGender),
      sku: textOf(ld.sku ?? ld.productID),
      gtin: textOf(ld.gtin13 ?? ld.gtin ?? ld.gtin14 ?? ld.gtin12 ?? ld.gtin8 ?? ld.isbn),
      sourceProductId: textOf(ld.productID ?? ld.sku ?? ld.mpn),
      imageUrls: urlsOf(ld.image),
      price,
      originalPrice,
      currency,
      availability,
      variants,
      sizes,
    },
    snippets: {
      title: "ld+json Product.name",
      price: `ld+json offers.price = ${price ?? "null"}`,
      currency: "ld+json offers.priceCurrency",
      brand: "ld+json Product.brand",
      imageUrls: `ld+json Product.image (${urlsOf(ld.image).length})`,
      availability: "ld+json offers.availability",
      variants: `ld+json offers/hasVariant (${variants.length})`,
    },
  };
}

/** Capa OpenGraph / Twitter / meta estándar. */
export function extractOpenGraph($: CheerioAPI): ExtractionLayer | null {
  const meta = (name: string): string | null => {
    const el = $(`meta[property="${name}"], meta[name="${name}"]`).first();
    const content = el.attr("content");
    return content?.trim() || null;
  };

  // OJO: aquí NO se usa el <title> del documento. `<title>` casi siempre lleva
  // el nombre de la tienda pegado ("Vestido midi plisado | MANGO"), y esta capa
  // tiene prioridad alta: si aportara el título, pisaría al del JSON embebido,
  // que es el limpio. El <title> se usa como último recurso en las heurísticas.
  const title = meta("og:title") ?? meta("twitter:title");
  const priceAmount =
    meta("product:price:amount") ??
    meta("og:price:amount") ??
    meta("twitter:data1");
  const images = [
    ...$('meta[property="og:image"], meta[property="og:image:secure_url"]')
      .map((_, el) => $(el).attr("content") ?? "")
      .get(),
    meta("twitter:image") ?? "",
  ].filter(Boolean);

  const ogType = meta("og:type");
  const hasAny = Boolean(title || priceAmount || images.length > 0);
  if (!hasAny) return null;

  return {
    kind: "opengraph",
    fields: {
      productType: /product/i.test(ogType ?? "") ? "product" : "unknown",
      title,
      description: meta("og:description") ?? meta("description") ?? meta("twitter:description"),
      brand: meta("product:brand") ?? meta("og:brand"),
      price: parsePrice(priceAmount),
      currency: normalizeCurrency(meta("product:price:currency") ?? meta("og:price:currency")),
      availability: meta("product:availability") ?? meta("og:availability"),
      color: meta("product:color"),
      sku: meta("product:retailer_item_id") ?? meta("product:sku"),
      gtin: meta("product:gtin") ?? meta("product:ean"),
      imageUrls: [...new Set(images)],
    },
    snippets: {
      title: "meta og:title",
      price: "meta product:price:amount",
      imageUrls: `meta og:image (${images.length})`,
      description: "meta og:description",
    },
  };
}

/** Capa microdata (itemprop) — schema.org sin JSON-LD. */
export function extractMicrodata($: CheerioAPI): ExtractionLayer | null {
  const scope = $('[itemtype*="schema.org/Product" i]').first();
  const scoped = scope.length > 0;
  /** Busca dentro del itemscope del producto si existe; si no, en todo el doc. */
  const find = (selector: string) => (scoped ? scope.find(selector) : $(selector));

  const prop = (name: string): string | null => {
    const el = find(`[itemprop="${name}"]`).first();
    if (el.length === 0) return null;
    const value =
      el.attr("content") ??
      el.attr("datetime") ??
      (el.is("meta") ? el.attr("content") : null) ??
      (el.is("img") ? el.attr("src") : null) ??
      (el.is("a") || el.is("link") ? el.attr("href") : null) ??
      el.text();
    return value?.trim() || null;
  };

  const images = find('[itemprop="image"]')
    .map((_, el) => $(el).attr("content") ?? $(el).attr("src") ?? $(el).attr("href") ?? "")
    .get()
    .filter(Boolean);

  const title = prop("name");
  const price = parsePrice(prop("price") ?? prop("lowPrice"));
  if (!title && price == null && images.length === 0) return null;

  return {
    kind: "microdata",
    fields: {
      productType: scoped ? "product" : "unknown",
      title,
      brand: prop("brand"),
      description: prop("description"),
      color: prop("color"),
      material: prop("material"),
      sku: prop("sku") ?? prop("productID"),
      gtin: prop("gtin13") ?? prop("gtin"),
      price,
      currency: normalizeCurrency(prop("priceCurrency")),
      availability: prop("availability"),
      imageUrls: [...new Set(images)],
    },
    snippets: {
      title: 'itemprop="name"',
      price: 'itemprop="price"',
      imageUrls: `itemprop="image" (${images.length})`,
    },
  };
}

/** Carga HTML en cheerio una sola vez y la comparte entre extractores. */
export function loadHtml(html: string): CheerioAPI {
  return cheerio.load(html);
}
