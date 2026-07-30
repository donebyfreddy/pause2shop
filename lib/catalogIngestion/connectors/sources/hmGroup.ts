import type { ConnectorSpec } from "../base/types";
import { bespoke, declarative } from "./spec";

/**
 * H&M Group. Todas las marcas comparten el patrón de ficha `productpage.<id>.html`
 * y publican JSON-LD con `offers` por variante, así que el motor declarativo las
 * cubre. H&M mantiene subclase propia por el JSON embebido `productArticleDetails`.
 */

const HM_NOTE =
  "Plataforma H&M Group: sitemap público + JSON-LD con offers por variante. Patrón de ficha `productpage.<id>.html`.";

export const HM_GROUP_SOURCES: ConnectorSpec[] = [
  bespoke({
    id: "hm",
    label: "H&M",
    brand: "H&M",
    group: "H&M Group",
    homeUrl: "https://www2.hm.com/es_es/index.html",
    sitemapUrls: ["https://www2.hm.com/es_es/sitemap.xml", "https://www2.hm.com/sitemap.xml"],
    productUrlPattern: String.raw`hm\.com\/.+productpage\.\d{8,}\.html`,
    productIdPattern: String.raw`productpage\.(\d{8,})\.html`,
    segments: ["women", "men", "kids"],
    categories: ["clothing", "footwear", "accessories", "home"],
    verification: "contract",
    notes:
      "Contrato de extracción cubierto por tests (JSON-LD + productArticleDetails) contra fixtures SINTÉTICOS, no capturas de la tienda. " +
      "Desde el entorno de desarrollo hm.com devuelve 403 a nivel de IP (un Chromium con UA por defecto recibe el mismo 403) y no se intenta eludir: " +
      "el estado real es `blocked_or_challenged` hasta poder probarlo desde una red permitida.",
  }),
  declarative({
    id: "cos",
    label: "COS",
    brand: "COS",
    group: "H&M Group",
    homeUrl: "https://www.cos.com/en_eur/index.html",
    sitemapUrls: ["https://www.cos.com/sitemap.xml"],
    productUrlPattern: String.raw`cos\.com\/.+\/[A-Za-z][A-Za-z_-]*-\d{10}([?#]|$)`,
    productIdPattern: String.raw`cos\.com\/.+\/[A-Za-z][A-Za-z_-]*-(\d{10})([?#]|$)`,
    tier: "premium",
    markets: ["ES", "EU"],
    categories: ["clothing", "footwear", "accessories"],
    notes: HM_NOTE,
  }),
  declarative({
    id: "arket",
    label: "ARKET",
    brand: "ARKET",
    group: "H&M Group",
    homeUrl: "https://www.arket.com/en/index.html",
    sitemapUrls: ["https://www.arket.com/sitemap.xml"],
    productUrlPattern: String.raw`arket\.com\/.+\/product\/[A-Za-z][A-Za-z_-]*-\d{10}([?#]|$)`,
    productIdPattern: String.raw`arket\.com\/.+\/product\/[A-Za-z][A-Za-z_-]*-(\d{10})([?#]|$)`,
    tier: "premium",
    markets: ["ES", "EU"],
    segments: ["women", "men", "kids"],
    categories: ["clothing", "footwear", "home"],
    notes: HM_NOTE,
  }),
  declarative({
    id: "other-stories",
    label: "& Other Stories",
    brand: "& Other Stories",
    group: "H&M Group",
    homeUrl: "https://www.stories.com/en_eur/index.html",
    sitemapUrls: ["https://www.stories.com/sitemap.xml"],
    productUrlPattern: String.raw`stories\.com\/.+\/product\.[A-Za-z][A-Za-z_-]*\.\d{10}\.html([?#]|$)`,
    productIdPattern: String.raw`stories\.com\/.+\/product\.[A-Za-z][A-Za-z_-]*\.(\d{10})\.html([?#]|$)`,
    tier: "premium",
    markets: ["ES", "EU"],
    segments: ["women"],
    categories: ["clothing", "footwear", "accessories", "beauty"],
    notes: HM_NOTE,
  }),
  declarative({
    id: "weekday",
    label: "Weekday",
    brand: "Weekday",
    group: "H&M Group",
    homeUrl: "https://www.weekday.com/en_eur/index.html",
    sitemapUrls: ["https://www.weekday.com/sitemap.xml"],
    productUrlPattern: String.raw`weekday\.com\/.+\/p\/.+-\d+([?#]|$)`,
    productIdPattern: null,
    markets: ["EU"],
    segments: ["women", "men"],
    categories: ["clothing", "footwear"],
    notes: HM_NOTE,
  }),
  declarative({
    id: "monki",
    label: "Monki",
    brand: "Monki",
    group: "H&M Group",
    homeUrl: "https://www.monki.com/en_eur/index.html",
    sitemapUrls: ["https://www.monki.com/sitemap.xml"],
    productUrlPattern: String.raw`monki\.com\/.+productpage\.\d{6,}\.html`,
    productIdPattern: String.raw`productpage\.(\d{6,})\.html`,
    markets: ["EU"],
    segments: ["women"],
    categories: ["clothing", "accessories"],
    notes: HM_NOTE,
  }),
];
