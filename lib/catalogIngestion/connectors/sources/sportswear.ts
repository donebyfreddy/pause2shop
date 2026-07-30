import type { ConnectorSpec } from "../base/types";
import { declarative, scaffold } from "./spec";

/**
 * Deporte y sneakers. Categoría crítica para la demo: el analizador detecta
 * zapatillas y ropa deportiva constantemente en vídeo.
 *
 * Nota honesta: Nike, adidas y los grandes retailers de sneakers usan
 * protección anti-bot fuerte. El conector es real y educado; si la tienda
 * bloquea, el health lo reporta como `blocked` y ahí se queda.
 */

const ANTIBOT_NOTE =
  "Protección anti-bot habitual en sneakers: el conector respeta robots.txt y NO intenta eludir bloqueos. Si responde 403 queda `blocked` y la fuente debe pasar por su programa de afiliación.";

export const SPORTSWEAR_SOURCES: ConnectorSpec[] = [
  declarative({
    id: "nike",
    label: "Nike",
    brand: "Nike",
    homeUrl: "https://www.nike.com/es/",
    sitemapUrls: ["https://www.nike.com/sitemap.xml"],
    productUrlPattern: String.raw`nike\.com\/[a-z]{2}\/t\/[A-Za-z][A-Za-z0-9_-]*[A-Za-z0-9]{6,}([?#]|$)`,
    productIdPattern: null,
    tier: "sportswear",
    markets: ["ES", "EU"],
    segments: ["women", "men", "kids"],
    categories: ["footwear", "clothing", "accessories"],
    notes: ANTIBOT_NOTE,
  }),
  declarative({
    id: "adidas",
    label: "adidas",
    brand: "adidas",
    homeUrl: "https://www.adidas.es/",
    sitemapUrls: ["https://www.adidas.es/sitemap.xml"],
    productUrlPattern: String.raw`adidas\.[a-z.]+\/.+\/[A-Z0-9]{6,}\.html`,
    productIdPattern: String.raw`\/([A-Z0-9]{6,})\.html`,
    tier: "sportswear",
    markets: ["ES", "EU"],
    segments: ["women", "men", "kids"],
    categories: ["footwear", "clothing", "accessories"],
    notes: ANTIBOT_NOTE,
  }),
  declarative({
    id: "puma",
    label: "PUMA",
    brand: "PUMA",
    homeUrl: "https://eu.puma.com/es/es",
    sitemapUrls: ["https://eu.puma.com/sitemap.xml"],
    productUrlPattern: String.raw`eu\.puma\.com\/.+\/pd\/.+\/\d{6}([?#]|$)`,
    productIdPattern: String.raw`eu\.puma\.com\/.+\/pd\/.+\/(\d{6})([?#]|$)`,
    tier: "sportswear",
    segments: ["women", "men", "kids"],
    categories: ["footwear", "clothing", "accessories"],
    notes: ANTIBOT_NOTE,
  }),
  declarative({
    id: "new-balance",
    label: "New Balance",
    brand: "New Balance",
    homeUrl: "https://www.newbalance.es/",
    sitemapUrls: ["https://www.newbalance.es/sitemap.xml"],
    productUrlPattern: String.raw`newbalance\.[a-z.]+\/.+\/[A-Z0-9]+\.html`,
    productIdPattern: String.raw`\/([A-Z0-9]+)\.html`,
    tier: "sportswear",
    segments: ["women", "men", "kids"],
    categories: ["footwear", "clothing"],
    notes: "Salesforce Commerce Cloud con JSON-LD. Patrón de ficha sin verificar.",
  }),
  declarative({
    id: "decathlon",
    label: "Decathlon",
    brand: "Decathlon",
    homeUrl: "https://www.decathlon.es/",
    sitemapUrls: ["https://www.decathlon.es/sitemap.xml"],
    productUrlPattern: String.raw`decathlon\.es\/.+\/p\/[\w-]*\d{6,}`,
    productIdPattern: String.raw`(\d{6,})`,
    tier: "sportswear",
    segments: ["women", "men", "kids", "unisex"],
    categories: ["clothing", "footwear", "equipment"],
    notes:
      "Catálogo amplio con datos estructurados y robots.txt permisivo para fichas. Patrón sin verificar.",
  }),
  declarative({
    id: "snipes",
    label: "SNIPES",
    brand: "SNIPES",
    homeUrl: "https://www.snipes.com/es/",
    sitemapUrls: ["https://www.snipes.com/sitemap.xml"],
    productUrlPattern: String.raw`snipes\.com\/.+\/p\/\d+`,
    productIdPattern: String.raw`\/p\/(\d+)`,
    tier: "marketplace",
    region: "DE",
    segments: ["women", "men", "kids"],
    categories: ["footwear", "clothing", "accessories"],
    notes: ANTIBOT_NOTE,
  }),
  scaffold({
    id: "jd-sports",
    label: "JD Sports",
    brand: "JD Sports",
    homeUrl: "https://www.jdsports.es/",
    productUrlPattern: String.raw`jdsports\.[a-z.]+\/product\/[\w-]+\/\d+`,
    productIdPattern: String.raw`\/(\d+)\/?$`,
    tier: "marketplace",
    region: "UK",
    segments: ["women", "men", "kids"],
    categories: ["footwear", "clothing"],
    access: "affiliate_feed",
    compliance: "affiliate_agreement",
    lifecycle: "partner_required",
    requiresEnv: ["JD_AFFILIATE_FEED_URL"],
    notes:
      "Bloqueo anti-bot en catálogo. Vía legítima: feed de afiliación (Awin/Rakuten). Pendiente de alta.",
    docsUrl: "https://www.awin.com/",
  }),
  scaffold({
    id: "foot-locker",
    label: "Foot Locker",
    brand: "Foot Locker",
    homeUrl: "https://www.footlocker.es/",
    productUrlPattern: String.raw`footlocker\.[a-z.]+\/.+\/[\w-]+\.html`,
    productIdPattern: String.raw`\/(\w+)\.html`,
    tier: "marketplace",
    region: "EU",
    segments: ["women", "men", "kids"],
    categories: ["footwear", "clothing"],
    access: "affiliate_feed",
    compliance: "affiliate_agreement",
    lifecycle: "partner_required",
    requiresEnv: ["FOOTLOCKER_AFFILIATE_FEED_URL"],
    notes:
      "Bloqueo anti-bot en catálogo. Vía legítima: feed de afiliación. Pendiente de alta.",
    docsUrl: "https://www.awin.com/",
  }),
];
