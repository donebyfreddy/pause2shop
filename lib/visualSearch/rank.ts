import type { DetectedItem } from "@/lib/types";
import { COLOR_EN, CATEGORY_EN, translate } from "./queryBuilder";
import type {
  MatchType,
  RankedCandidate,
  VisualCandidate,
} from "./types";

/**
 * Re-ranking de candidatos por coincidencia visual con el item detectado.
 *
 * Reglas de scoring (spec del producto):
 *   exact image match        +100
 *   misma marca              +50
 *   logo/texto coincide      +40
 *   mismo color              +15
 *   misma categoría          +10
 *   mismo género/estilo      +10
 *   marketplace fiable       +30
 *   tienda desconocida       -20
 * Además: pequeño bonus por posición alta en el motor (los motores ya
 * ordenan por similitud visual) y por tener precio (producto concreto).
 */

/** Dominios de tiendas fiables (prioridad de la spec + retailers ya verificados). */
const TRUSTED_DOMAINS = [
  "amazon.es", "amazon.com", "zalando.es", "zalando.com", "asos.com",
  "elcorteingles.es", "nike.com", "adidas.es", "adidas.com", "zara.com",
  "decathlon.es", "mediamarkt.es", "pccomponentes.com", "ikea.com",
  "leroymerlin.es", "sephora.es", "mango.com", "pullandbear.com",
  "bershka.com", "footlocker.es", "jdsports.es", "sprintersports.com",
  "veepee.es", "privalia.com", "farfetch.com", "mytheresa.com",
  "net-a-porter.com", "ssense.com", "elpalaciodehierro.com", "ebay.es",
];

/** Marcas oficiales: dominio == marca detectada también puntúa como fiable. */
function isTrustedDomain(domain: string | null, brand: string | null): boolean {
  if (!domain) return false;
  if (TRUSTED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return true;
  }
  if (brand) {
    const b = brand.toLowerCase().replace(/\s+/g, "");
    if (domain.startsWith(`${b}.`) || domain.includes(`.${b}.`)) return true;
  }
  return false;
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** ¿El texto contiene la palabra/frase (con límites de palabra)? */
function containsWord(haystack: string, needle: string): boolean {
  const n = norm(needle).trim();
  if (n.length < 2) return false;
  return new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(
    norm(haystack)
  );
}

/** Términos equivalentes ES+EN para un atributo (p.ej. "burdeos" → ["burdeos","burgundy"]). */
function bilingualTerms(value: string | null | undefined, map: Record<string, string>): string[] {
  if (!value) return [];
  const terms = [value];
  const en = translate(map, value);
  if (en && en !== value) terms.push(en);
  return terms;
}

export function scoreCandidate(
  candidate: VisualCandidate,
  item: DetectedItem
): RankedCandidate {
  const breakdown: Record<string, number> = {};
  const text = `${candidate.title} ${candidate.brand ?? ""} ${candidate.store ?? ""}`;
  const brand = item.visible_brand || item.brand_guess || null;

  if (candidate.exactImageMatch) breakdown.exact_image_match = 100;

  // Coincidencia visual del motor Lens: las primeras posiciones del reverse
  // image search son las más parecidas a la imagen real.
  if (!candidate.exactImageMatch && candidate.queryUsed === null && candidate.position != null) {
    if (candidate.position <= 3) breakdown.lens_top_position = 45;
    else if (candidate.position <= 10) breakdown.lens_high_position = 25;
    else breakdown.lens_result = 10;
  }

  if (brand && containsWord(text, brand)) breakdown.same_brand = 50;

  if (item.visible_text && containsWord(text, item.visible_text)) {
    breakdown.visible_text_match = 40;
  }

  const colorTerms = bilingualTerms(item.color, COLOR_EN);
  if (colorTerms.some((t) => containsWord(text, t))) breakdown.same_color = 15;

  const categoryTerms = [
    ...bilingualTerms(item.subcategory, CATEGORY_EN),
    ...bilingualTerms(item.category, CATEGORY_EN),
  ];
  if (categoryTerms.some((t) => containsWord(text, t))) breakdown.same_category = 10;

  const genderTerms =
    item.gender_fit === "hombre"
      ? ["hombre", "men", "man"]
      : item.gender_fit === "mujer"
        ? ["mujer", "women", "woman"]
        : [];
  const styleTerms = item.style ? [item.style] : [];
  if ([...genderTerms, ...styleTerms].some((t) => containsWord(text, t))) {
    breakdown.same_style_gender = 10;
  }

  if (isTrustedDomain(candidate.domain, brand)) breakdown.trusted_store = 30;
  else breakdown.unknown_store = -20;

  // Producto concreto con precio > enlace sin producto.
  if (candidate.price != null) breakdown.has_price = 8;

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { ...candidate, score, matchType: matchTypeFor(score, breakdown), scoreBreakdown: breakdown };
}

function matchTypeFor(score: number, breakdown: Record<string, number>): MatchType {
  if (breakdown.exact_image_match) return "exact";
  if (score >= 95 || (breakdown.same_brand && breakdown.visible_text_match)) {
    return "near_exact";
  }
  if (score >= 70 && breakdown.same_brand) return "near_exact";
  return "similar";
}

/** Dedupe por URL y por (dominio + título normalizado). */
export function dedupeCandidates(candidates: VisualCandidate[]): VisualCandidate[] {
  const seen = new Set<string>();
  const out: VisualCandidate[] = [];
  for (const c of candidates) {
    const keys = [c.link, `${c.domain}|${norm(c.title)}`];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(c);
  }
  return out;
}

/** Rankea (dedupe + score + orden descendente). */
export function rankCandidates(
  candidates: VisualCandidate[],
  item: DetectedItem
): RankedCandidate[] {
  return dedupeCandidates(candidates)
    .map((c) => scoreCandidate(c, item))
    .sort((a, b) => b.score - a.score);
}
