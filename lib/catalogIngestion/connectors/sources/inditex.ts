import type { ConnectorSpec } from "../base/types";
import { bespoke, declarative } from "./spec";

/**
 * Grupo Inditex. Todas las tiendas comparten plataforma y patrón de URL de
 * ficha (`…-l<id>.html` o `…-p<id>.html`), así que el motor declarativo las
 * cubre con una entrada por marca. Zara mantiene subclase propia porque además
 * embebe el estado de la ficha en `window.zara.viewPayload`.
 *
 * Aviso honesto: Inditex protege parte del catálogo con anti-bot. El código es
 * real y respeta robots.txt; si la tienda responde 403, el conector queda
 * `blocked` y NO se intenta eludir.
 */

const INDITEX_NOTE =
  "Plataforma Inditex: sitemaps públicos + JSON-LD en ficha. Anti-bot habitual: si responde 403 el conector queda `blocked` sin intentar eludirlo.";

export const INDITEX_SOURCES: ConnectorSpec[] = [
  bespoke({
    id: "zara",
    label: "Zara",
    brand: "Zara",
    group: "Inditex",
    homeUrl: "https://www.zara.com/es/",
    sitemapUrls: [
      "https://www.zara.com/sitemaps/sitemap-es-es.xml",
      "https://www.zara.com/sitemap.xml",
    ],
    productUrlPattern: String.raw`zara\.com\/.+-p\d{6,}\.html`,
    productIdPattern: String.raw`-p(\d{6,})\.html`,
    segments: ["women", "men", "kids"],
    categories: ["clothing", "footwear", "accessories"],
    verification: "contract",
    notes:
      "Contrato de extracción cubierto por tests (window.zara.viewPayload, precios en céntimos) contra fixtures SINTÉTICOS, no capturas de la tienda. " +
      "Desde el entorno de desarrollo zara.com devuelve 403 a nivel de IP y no se intenta eludir: " +
      "el estado real es `blocked_or_challenged` hasta poder probarlo desde una red permitida.",
  }),
  declarative({
    id: "massimo-dutti",
    label: "Massimo Dutti",
    brand: "Massimo Dutti",
    group: "Inditex",
    homeUrl: "https://www.massimodutti.com/es/",
    sitemapUrls: ["https://www.massimodutti.com/sitemap.xml"],
    productUrlPattern: String.raw`massimodutti\.com\/.+-l\d{3,}\.html`,
    productIdPattern: String.raw`-l(\d{3,})\.html`,
    tier: "premium",
    segments: ["women", "men"],
    categories: ["clothing", "footwear", "accessories"],
    notes: INDITEX_NOTE,
  }),
  declarative({
    id: "pull-and-bear",
    label: "Pull&Bear",
    brand: "Pull&Bear",
    group: "Inditex",
    homeUrl: "https://www.pullandbear.com/es/",
    sitemapUrls: ["https://www.pullandbear.com/sitemap.xml"],
    productUrlPattern: String.raw`pullandbear\.com\/.+-l\d{3,}\.html`,
    productIdPattern: String.raw`-l(\d{3,})\.html`,
    categories: ["clothing", "footwear", "accessories"],
    notes: INDITEX_NOTE,
  }),
  declarative({
    id: "bershka",
    label: "Bershka",
    brand: "Bershka",
    group: "Inditex",
    homeUrl: "https://www.bershka.com/es/",
    sitemapUrls: ["https://www.bershka.com/sitemap.xml"],
    productUrlPattern: String.raw`bershka\.com\/.+-c\d+p\d+\.html`,
    productIdPattern: String.raw`p(\d+)\.html`,
    categories: ["clothing", "footwear", "accessories"],
    notes: INDITEX_NOTE,
  }),
  declarative({
    id: "stradivarius",
    label: "Stradivarius",
    brand: "Stradivarius",
    group: "Inditex",
    homeUrl: "https://www.stradivarius.com/es/",
    sitemapUrls: ["https://www.stradivarius.com/sitemap.xml"],
    productUrlPattern: String.raw`stradivarius\.com\/.+-l\d{3,}\.html`,
    productIdPattern: String.raw`-l(\d{3,})\.html`,
    segments: ["women"],
    categories: ["clothing", "footwear", "accessories"],
    notes: INDITEX_NOTE,
  }),
  declarative({
    id: "oysho",
    label: "Oysho",
    brand: "Oysho",
    group: "Inditex",
    homeUrl: "https://www.oysho.com/es/",
    sitemapUrls: ["https://www.oysho.com/sitemap.xml"],
    productUrlPattern: String.raw`oysho\.com\/.+-l\d{3,}\.html`,
    productIdPattern: String.raw`-l(\d{3,})\.html`,
    segments: ["women"],
    categories: ["clothing", "activewear"],
    notes: INDITEX_NOTE,
  }),
  declarative({
    id: "lefties",
    label: "Lefties",
    brand: "Lefties",
    group: "Inditex",
    homeUrl: "https://www.lefties.com/es/",
    sitemapUrls: ["https://www.lefties.com/sitemap.xml"],
    productUrlPattern: String.raw`lefties\.com\/.+-l\d{3,}\.html`,
    productIdPattern: String.raw`-l(\d{3,})\.html`,
    segments: ["women", "men", "kids"],
    categories: ["clothing", "footwear"],
    notes: INDITEX_NOTE,
  }),
  declarative({
    id: "zara-home",
    label: "Zara Home",
    brand: "Zara Home",
    group: "Inditex",
    homeUrl: "https://www.zarahome.com/es/",
    sitemapUrls: ["https://www.zarahome.com/sitemap.xml"],
    productUrlPattern: String.raw`zarahome\.com\/.+-p\d{3,}\.html`,
    productIdPattern: String.raw`-p(\d{3,})\.html`,
    segments: ["unisex"],
    categories: ["home", "decoration", "textile"],
    notes: `${INDITEX_NOTE} Útil para las categorías de hogar/decoración del analizador.`,
  }),
];
