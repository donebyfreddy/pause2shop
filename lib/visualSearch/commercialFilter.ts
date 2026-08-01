import type { VisualCandidate } from "./types";

const NON_COMMERCE_HOSTS = [
  "news.",
  "wikipedia.",
  "youtube.",
  "instagram.",
  "facebook.",
  "tiktok.",
  "pinterest.",
  "reddit.",
  "medium.",
];

const EDITORIAL_TITLE =
  /\b(news|noticias|biograph(?:y|y)|biograf[ií]a|celebrity|famos[oa]|actor|actress|interview|entrevista|article|art[ií]culo|review|opinion|lookbook|street style)\b/i;

/**
 * Puerta final antes de presentar un resultado externo como comprable.
 * Exige una URL comercial y señal de producto (merchant/precio/marca), y
 * descarta redes, noticias, personas y contenido editorial.
 */
export function isCommercialVisualCandidate(candidate: VisualCandidate): boolean {
  let hostname = candidate.domain?.toLowerCase() ?? "";
  try {
    const url = new URL(candidate.link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    hostname ||= url.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (NON_COMMERCE_HOSTS.some((host) => hostname.includes(host))) return false;
  if (EDITORIAL_TITLE.test(candidate.title)) return false;
  return Boolean(candidate.price != null || candidate.store || candidate.brand);
}
