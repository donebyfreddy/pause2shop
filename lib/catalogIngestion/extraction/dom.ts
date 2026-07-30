import type { CheerioAPI } from "cheerio";
import { parsePrice, normalizeCurrency } from "../normalization/normalize";
import type { ExtractionLayer } from "./types";

/**
 * Extractores basados en DOM: selectores declarados por el conector primero, y
 * heurísticas genéricas después.
 *
 * Las heurísticas son el último recurso ANTES de la IA: cubren tiendas que no
 * publican datos estructurados pero sí marcan el precio con una clase que
 * contiene "price", el título en un <h1>, etc. Son deliberadamente
 * conservadoras — con `confidence` baja — porque se equivocan más.
 */

/** Selectores CSS por campo, declarados en el spec de cada conector. */
export interface ConnectorSelectors {
  title?: string;
  brand?: string;
  price?: string;
  originalPrice?: string;
  currency?: string;
  description?: string;
  color?: string;
  material?: string;
  /** Imágenes de la galería. Se leen src/data-src/srcset/content. */
  images?: string;
  /** Cada elemento es una talla (botón, label, option). */
  sizes?: string;
  availability?: string;
  sku?: string;
  /** Enlaces a fichas dentro de una página de categoría (descubrimiento). */
  productLink?: string;
  /** Enlace a la página siguiente en un listado paginado. */
  nextPage?: string;
}

/** Atributos donde vive una URL de imagen, en orden de preferencia. */
const IMAGE_ATTRS = [
  "src",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-image",
  "content",
  "href",
];

/** Extrae la mejor URL de un nodo de imagen (soporta srcset y lazy-loading). */
export function imageUrlFrom($: CheerioAPI, el: any): string | null {
  const node = $(el);
  for (const attr of IMAGE_ATTRS) {
    const value = node.attr(attr);
    if (value && !value.startsWith("data:")) return value.trim();
  }
  // srcset: "url 320w, url2 640w" → la de mayor anchura declarada
  for (const attr of ["srcset", "data-srcset"]) {
    const srcset = node.attr(attr);
    if (!srcset) continue;
    const best = srcset
      .split(",")
      .map((part) => {
        const [url, size] = part.trim().split(/\s+/);
        return { url, width: Number((size ?? "").replace(/\D/g, "")) || 0 };
      })
      .filter((c) => c.url && !c.url.startsWith("data:"))
      .sort((a, b) => b.width - a.width)[0];
    if (best) return best.url;
  }
  return null;
}

function firstText($: CheerioAPI, selector: string | undefined): string | null {
  if (!selector) return null;
  const el = $(selector).first();
  if (el.length === 0) return null;
  const value = el.attr("content") ?? el.attr("value") ?? el.text();
  return value?.replace(/\s+/g, " ").trim() || null;
}

function allTexts($: CheerioAPI, selector: string | undefined, max = 60): string[] {
  if (!selector) return [];
  return [
    ...new Set(
      $(selector)
        .map((_, el) => {
          const node = $(el);
          return (node.attr("data-size") ?? node.attr("value") ?? node.text())
            .replace(/\s+/g, " ")
            .trim();
        })
        .get()
        .filter((t) => t.length > 0 && t.length <= 24)
    ),
  ].slice(0, max);
}

/** Símbolo o código de moneda presente en un texto de precio. */
export function currencyFromText(text: string | null): string | null {
  if (!text) return null;
  if (/€|\bEUR\b/i.test(text)) return "EUR";
  if (/£|\bGBP\b/i.test(text)) return "GBP";
  if (/\$|\bUSD\b/i.test(text)) return "USD";
  if (/\bSEK\b|\bkr\b/i.test(text)) return "SEK";
  if (/\bPLN\b|\bzł/i.test(text)) return "PLN";
  if (/\bCHF\b/i.test(text)) return "CHF";
  return null;
}

/** Capa de selectores CSS del conector. Null si el spec no declara ninguno. */
export function extractWithSelectors(
  $: CheerioAPI,
  selectors: ConnectorSelectors | undefined
): ExtractionLayer | null {
  if (!selectors) return null;
  const priceText = firstText($, selectors.price);
  const originalText = firstText($, selectors.originalPrice);
  const images = selectors.images
    ? [
        ...new Set(
          $(selectors.images)
            .map((_, el) => imageUrlFrom($, el))
            .get()
            .filter((u): u is string => Boolean(u))
        ),
      ]
    : [];

  const fields = {
    title: firstText($, selectors.title),
    brand: firstText($, selectors.brand),
    description: firstText($, selectors.description),
    color: firstText($, selectors.color),
    material: firstText($, selectors.material),
    sku: firstText($, selectors.sku),
    availability: firstText($, selectors.availability),
    price: parsePrice(priceText),
    originalPrice: parsePrice(originalText),
    currency:
      normalizeCurrency(firstText($, selectors.currency)) ?? currencyFromText(priceText),
    sizes: allTexts($, selectors.sizes),
    imageUrls: images,
  };

  const anyFound = Object.values(fields).some(
    (v) => v != null && (!Array.isArray(v) || v.length > 0)
  );
  if (!anyFound) return null;

  return {
    kind: "selectors",
    fields,
    snippets: {
      title: `selector ${selectors.title ?? "-"}`,
      price: `selector ${selectors.price ?? "-"} → "${priceText ?? ""}"`,
      imageUrls: `selector ${selectors.images ?? "-"} (${images.length})`,
      sizes: `selector ${selectors.sizes ?? "-"}`,
    },
  };
}

/** Clases/atributos que las tiendas usan para el precio vigente. */
const PRICE_HINT = /(^|[-_ ])(price|precio|prix|preis|amount|money)([-_ ]|$)/i;
/** Y para el precio tachado (que NO debe confundirse con el vigente). */
const OLD_PRICE_HINT = /(old|was|previous|original|strike|crossed|regular|antiguo|anterior|list)/i;
/** Contenedores que no son parte de la ficha. */
const NOISE_SELECTOR =
  "script, style, noscript, template, nav, header, footer, aside, [hidden], [aria-hidden='true']";

interface PriceCandidate {
  value: number;
  currency: string | null;
  text: string;
  selector: string;
  isOld: boolean;
}

function describeNode($: CheerioAPI, el: any): string {
  const node = $(el);
  const tag = (el.tagName ?? el.name ?? "div").toLowerCase();
  const id = node.attr("id");
  const cls = (node.attr("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  return `${tag}${id ? `#${id}` : ""}${cls ? `.${cls}` : ""}`;
}

/** Precios candidatos del DOM, separando vigente de tachado. */
function priceCandidates($: CheerioAPI): PriceCandidate[] {
  const out: PriceCandidate[] = [];
  $("[class], [id], [data-testid]").each((_, el) => {
    const node = $(el);
    const marker = `${node.attr("class") ?? ""} ${node.attr("id") ?? ""} ${node.attr("data-testid") ?? ""}`;
    if (!PRICE_HINT.test(marker)) return;
    // Solo hojas: un contenedor grande concatena varios precios.
    if (node.children().length > 3) return;
    const text = node.text().replace(/\s+/g, " ").trim();
    if (!text || text.length > 40) return;
    if (!/\d/.test(text)) return;
    const value = parsePrice(text);
    if (value == null || value <= 0 || value > 1_000_000) return;
    out.push({
      value,
      currency: currencyFromText(text),
      text,
      selector: describeNode($, el),
      isOld: OLD_PRICE_HINT.test(marker),
    });
  });
  return out;
}

/** Imágenes de producto plausibles: descarta iconos, logos y sprites. */
function heuristicImages($: CheerioAPI): Array<{ url: string; selector: string }> {
  const out: Array<{ url: string; selector: string }> = [];
  const seen = new Set<string>();
  $("img, source, [data-srcset]").each((_, el) => {
    const node = $(el);
    const url = imageUrlFrom($, el);
    if (!url || seen.has(url)) return;
    const alt = `${node.attr("alt") ?? ""} ${node.attr("class") ?? ""} ${url}`;
    if (/(logo|icon|sprite|placeholder|pixel|badge|flag|payment|social)/i.test(alt)) return;
    const width = Number(node.attr("width") ?? 0);
    const height = Number(node.attr("height") ?? 0);
    if ((width && width < 200) || (height && height < 200)) return;
    seen.add(url);
    out.push({ url, selector: describeNode($, el) });
  });
  return out.slice(0, 12);
}

const SIZE_TOKEN = /^(XXS|XS|S|M|L|XL|XXL|XXXL|3XL|4XL|\d{1,2}([.,]5)?|\d{2,3}\/\d{2,3}|T\d|U|ÚNICA|UNICA|ONE SIZE)$/i;

/** Tallas: elementos cortos en un contenedor cuyo marcador menciona talla. */
function heuristicSizes($: CheerioAPI): string[] {
  const out: string[] = [];
  $("[class], [id], [data-testid]").each((_, el) => {
    const node = $(el);
    const marker = `${node.attr("class") ?? ""} ${node.attr("id") ?? ""} ${node.attr("data-testid") ?? ""}`;
    if (!/(size|talla|taille|größe|grosse)/i.test(marker)) return;
    node.find("button, li, label, option, span, a").each((__, child) => {
      const text = $(child).text().replace(/\s+/g, " ").trim();
      if (SIZE_TOKEN.test(text) && !out.includes(text)) out.push(text);
    });
  });
  return out.slice(0, 40);
}

/**
 * Capa heurística: título del <h1>, precio por marcadores de clase, imágenes
 * grandes, tallas por contenedor. Confianza baja a propósito.
 */
export function extractWithHeuristics($raw: CheerioAPI): ExtractionLayer | null {
  // Trabajamos sobre una copia sin ruido: nav/footer traen precios de
  // "productos recomendados" que contaminarían la heurística de precio.
  const $ = $raw;
  $(NOISE_SELECTOR).remove();

  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim() || null;
  // El <title> es el último recurso para el nombre: se le quita el sufijo de la
  // tienda ("Vestido | MANGO" → "Vestido"), que no forma parte del producto.
  const documentTitle = cleanDocumentTitle($("title").first().text());
  const candidates = priceCandidates($);
  const current = candidates.filter((c) => !c.isOld).sort((a, b) => a.value - b.value)[0] ?? null;
  const old = candidates.filter((c) => c.isOld).sort((a, b) => b.value - a.value)[0] ?? null;
  const images = heuristicImages($);
  const sizes = heuristicSizes($);

  // Disponibilidad: solo si el texto es inequívoco. "Añadir a la cesta"
  // presente no garantiza stock; "agotado" visible sí es evidencia.
  const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 20000);
  const availability = /(agotado|sold out|out of stock|no disponible|ausverkauft)/i.test(bodyText)
    ? "out_of_stock"
    : null;

  if (!h1 && !current && images.length === 0) return null;

  return {
    kind: "heuristics",
    fields: {
      title: h1 ?? documentTitle,
      price: current?.value ?? null,
      originalPrice: old && current && old.value > current.value ? old.value : null,
      currency: current?.currency ?? null,
      availability,
      sizes,
      imageUrls: images.map((i) => i.url),
    },
    snippets: {
      title: h1 ? "h1" : "<title> (sin sufijo de tienda)",
      price: current ? `${current.selector} → "${current.text}"` : "-",
      originalPrice: old ? `${old.selector} → "${old.text}"` : "-",
      imageUrls: images
        .slice(0, 3)
        .map((i) => i.selector)
        .join(", "),
      sizes: `contenedor con marcador de talla (${sizes.length})`,
    },
    warnings: current ? [] : ["heurística: no se encontró un precio fiable en el DOM"],
  };
}

/**
 * Limpia el <title> del documento quitando el sufijo de la tienda. Los
 * separadores habituales son `|`, `–`, `—` y ` - `; se conserva el trozo más
 * largo, que es el nombre del producto.
 */
function cleanDocumentTitle(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const parts = text.split(/\s+[|–—]\s+|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const longest = parts.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length >= 3 ? longest : text;
}

/** Enlaces a fichas de producto en una página de categoría/listado. */
export function extractProductLinks(
  $: CheerioAPI,
  baseUrl: string,
  selectors: ConnectorSelectors | undefined,
  isProductUrl: (url: string) => boolean
): string[] {
  const found = new Set<string>();
  const push = (href: string | undefined): void => {
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (isProductUrl(absolute)) found.add(absolute.split("#")[0]);
  };

  if (selectors?.productLink) {
    $(selectors.productLink).each((_, el) => push($(el).attr("href")));
  }
  // Siempre barremos también todos los <a>: un selector desactualizado no
  // debe dejar el descubrimiento a cero si el patrón de URL sigue valiendo.
  $("a[href]").each((_, el) => push($(el).attr("href")));
  return [...found];
}

/** URL de la página siguiente en un listado paginado, si la hay. */
export function extractNextPage(
  $: CheerioAPI,
  baseUrl: string,
  selectors: ConnectorSelectors | undefined
): string | null {
  const candidates = [
    selectors?.nextPage,
    'link[rel="next"]',
    'a[rel="next"]',
    '[class*="pagination" i] a[aria-label*="next" i]',
    '[class*="pagination" i] a[aria-label*="siguiente" i]',
  ].filter((s): s is string => Boolean(s));

  for (const selector of candidates) {
    const href = $(selector).first().attr("href");
    if (!href) continue;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}
