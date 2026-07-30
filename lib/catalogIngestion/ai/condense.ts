import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

/**
 * Condensador de HTML para la IA.
 *
 * Enviar la página entera a un modelo es caro, lento y contraproducente: el
 * 90% de un HTML de e-commerce es JavaScript, CSS, menús y footer, y ese ruido
 * empuja al modelo a inventar. Aquí se recorta a lo que de verdad describe el
 * producto, se conserva la evidencia útil (labels, tablas, atributos data-*,
 * itemprop, JSON-LD residual) y se acota el tamaño.
 *
 * El resultado incluye un hash estable para cachear: dos ejecuciones sobre la
 * misma ficha sin cambios reutilizan la extracción en vez de volver a pagar.
 */

/** Se eliminan por completo: nunca describen el producto. */
const DROP_SELECTORS = [
  "script:not([type='application/ld+json'])",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "canvas",
  "video",
  "audio",
  "link",
  "nav",
  "header",
  "footer",
  "aside",
  "form[role='search']",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[aria-hidden='true']",
  "[hidden]",
].join(", ");

/**
 * Bloques que por marcador son ruido de tienda: cookies, newsletter,
 * recomendados… Los "también te puede gustar" son especialmente dañinos
 * porque traen OTROS productos con OTROS precios.
 */
const DROP_BY_MARKER =
  /(cookie|consent|newsletter|breadcrumb|recommend|related|similar|also-like|you-may|carousel-recommend|footer|menu|megamenu|social|chat-widget|skip-link)/i;

/** Atributos que se conservan: el resto (class, style, tracking) se descarta. */
const KEEP_ATTRS = new Set([
  "itemprop",
  "itemtype",
  "property",
  "name",
  "content",
  "alt",
  "title",
  "href",
  "src",
  "value",
  "label",
  "for",
  "id",
  "type",
  "aria-label",
  "datetime",
  "lang",
  "currency",
]);

/** Prefijos de atributos data-* que suelen llevar datos reales del producto. */
const KEEP_DATA_ATTR = /^data-(price|currency|product|sku|id|size|color|colour|name|availability|test|testid|qa|variant|gtin|ean|brand)/i;

export interface CondensedHtml {
  /** HTML recortado, listo para el prompt. */
  html: string;
  /** Longitud original en caracteres (para el log de ahorro). */
  originalChars: number;
  /** ¿Se truncó por el límite configurado? */
  truncated: boolean;
  /** sha256 del HTML condensado — clave de caché. */
  hash: string;
}

/**
 * Condensa el HTML de una ficha. `maxChars` es un techo duro sobre la salida.
 */
export function condenseHtml(html: string, maxChars: number): CondensedHtml {
  const originalChars = html.length;
  const $ = cheerio.load(html);

  $(DROP_SELECTORS).remove();
  $("*")
    .filter((_, el) => {
      const node = $(el);
      const marker = `${node.attr("class") ?? ""} ${node.attr("id") ?? ""} ${node.attr("data-testid") ?? ""}`;
      return DROP_BY_MARKER.test(marker);
    })
    .remove();

  // Comentarios HTML: puro ruido para el modelo.
  $("*")
    .contents()
    .filter((_, node) => node.type === "comment")
    .remove();

  // Poda de atributos: `class="grid grid-cols-4 md:..."` no aporta nada y come
  // tokens. Se conservan los que llevan datos o semántica.
  $("*").each((_, el) => {
    const node = $(el);
    const attribs = (el as unknown as { attribs?: Record<string, string> }).attribs ?? {};
    for (const attr of Object.keys(attribs)) {
      if (KEEP_ATTRS.has(attr) || KEEP_DATA_ATTR.test(attr)) continue;
      node.removeAttr(attr);
    }
  });

  // Nodos vacíos que solo aportan profundidad de árbol.
  for (let pass = 0; pass < 3; pass++) {
    $("div, span, section, article, p, li, ul, td, tr, table, label, i, b, em, strong").each((_, el) => {
      const node = $(el);
      if (node.children().length === 0 && node.text().trim() === "" && Object.keys((el as unknown as { attribs?: Record<string, string> }).attribs ?? {}).length === 0) {
        node.remove();
      }
    });
  }

  const head = $("head");
  const keptHead = [
    `<title>${$("title").first().text().trim()}</title>`,
    ...head
      .find("meta[property], meta[name], link[rel='canonical']")
      .map((_, el) => $.html(el))
      .get(),
    ...$("script[type='application/ld+json']")
      .map((_, el) => `<script type="application/ld+json">${$(el).contents().text().slice(0, 4000)}</script>`)
      .get(),
  ].join("\n");

  const bodyHtml = ($("body").html() ?? $.html())
    .replace(/\s{2,}/g, " ")
    .replace(/>\s+</g, "><")
    .trim();

  let combined = `${keptHead}\n<body>${bodyHtml}</body>`;
  const truncated = combined.length > maxChars;
  if (truncated) {
    // Recortamos por el final: la cabecera y el inicio del body (título,
    // precio, galería) es donde vive la información del producto.
    combined = `${combined.slice(0, maxChars)}\n<!-- HTML truncado a ${maxChars} caracteres -->`;
  }

  return {
    html: combined,
    originalChars,
    truncated,
    hash: createHash("sha256").update(combined).digest("hex"),
  };
}

/**
 * Hash estable del DOM para invalidar caché. Se calcula sobre el HTML
 * condensado, no sobre el bruto: así un cambio de tracking o de CSS no
 * invalida una extracción que daría exactamente el mismo resultado.
 */
export function domHash(condensed: CondensedHtml): string {
  return condensed.hash;
}
