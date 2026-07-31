import { BASE_LANGUAGE_MAP, DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";

/**
 * Resuelve un locale soportado a partir de una etiqueta de idioma tipo BCP-47
 * (p. ej. "zh-CN", "pt-BR", "en-US"). Coincidencia exacta primero, luego por
 * idioma base, si no hay match ninguno.
 */
export function matchLocaleTag(tag: string | undefined | null): Locale | null {
  if (!tag) return null;
  const trimmed = tag.trim();
  if (!trimmed) return null;

  if (isLocale(trimmed)) return trimmed;

  const base = trimmed.split(/[-_]/)[0]?.toLowerCase();
  if (base && base in BASE_LANGUAGE_MAP) return BASE_LANGUAGE_MAP[base];

  return null;
}

/**
 * Parsea la cabecera `Accept-Language` (o `navigator.languages` ya como
 * array) en una lista de etiquetas ordenada por preferencia (q descendente).
 */
export function parseAcceptLanguage(header: string | undefined | null): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, qPart] = part.trim().split(";q=");
      const q = qPart ? Number.parseFloat(qPart) : 1;
      return { tag: tag?.trim(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((entry): entry is { tag: string; q: number } => Boolean(entry.tag))
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}

export interface DetectLocaleInput {
  /** Valor de la cookie NEXT_LOCALE, si existe. */
  cookie?: string | null;
  /** Valor guardado en localStorage, si existe. */
  localStorage?: string | null;
  /** Etiquetas de idioma del navegador o de Accept-Language, en orden de preferencia. */
  languageTags?: string[];
}

/**
 * Precedencia: cookie válida > localStorage válido > primera etiqueta del
 * navegador que resuelva a un locale soportado > DEFAULT_LOCALE.
 */
export function detectLocale(input: DetectLocaleInput): Locale {
  const fromCookie = matchLocaleTag(input.cookie ?? null);
  if (fromCookie) return fromCookie;

  const fromStorage = matchLocaleTag(input.localStorage ?? null);
  if (fromStorage) return fromStorage;

  for (const tag of input.languageTags ?? []) {
    const match = matchLocaleTag(tag);
    if (match) return match;
  }

  return DEFAULT_LOCALE;
}
