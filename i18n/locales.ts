/**
 * Lista única de locales soportados y sus metadatos de presentación.
 *
 * Es la fuente de verdad tanto para el selector de idioma (cliente) como
 * para la resolución de locale en servidor (`i18n/request.ts`).
 */

export const LOCALES = [
  "es",
  "en",
  "it",
  "fr",
  "de",
  "pt",
  "ca",
  "zh-CN",
  "ja",
  "ko",
  "ar",
] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

export const RTL_LOCALES: ReadonlySet<Locale> = new Set(["ar"]);

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export interface LocaleMeta {
  /** Código corto mostrado en el disparador del selector (mayúsculas). */
  shortCode: string;
  /** Nombre del idioma en su propia lengua. */
  nativeName: string;
  /** Nombre del idioma en inglés (ayuda a la búsqueda). */
  englishName: string;
  /** Emoji de bandera representativo (no implica nacionalidad del idioma). */
  flag: string;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  es: { shortCode: "ES", nativeName: "Español", englishName: "Spanish", flag: "🇪🇸" },
  en: { shortCode: "EN", nativeName: "English", englishName: "English", flag: "🇬🇧" },
  it: { shortCode: "IT", nativeName: "Italiano", englishName: "Italian", flag: "🇮🇹" },
  fr: { shortCode: "FR", nativeName: "Français", englishName: "French", flag: "🇫🇷" },
  de: { shortCode: "DE", nativeName: "Deutsch", englishName: "German", flag: "🇩🇪" },
  pt: { shortCode: "PT", nativeName: "Português", englishName: "Portuguese", flag: "🇵🇹" },
  // El catalán no tiene bandera de país ISO propia; se omite para no forzar
  // una asociación política — el selector ya muestra código + nombre.
  ca: { shortCode: "CA", nativeName: "Català", englishName: "Catalan", flag: "" },
  "zh-CN": { shortCode: "ZH", nativeName: "简体中文", englishName: "Chinese (Simplified)", flag: "🇨🇳" },
  ja: { shortCode: "JA", nativeName: "日本語", englishName: "Japanese", flag: "🇯🇵" },
  ko: { shortCode: "KO", nativeName: "한국어", englishName: "Korean", flag: "🇰🇷" },
  ar: { shortCode: "AR", nativeName: "العربية", englishName: "Arabic", flag: "🇸🇦" },
};

/** Mapa de idioma base (sin región) a locale soportado, para el detector. */
export const BASE_LANGUAGE_MAP: Record<string, Locale> = {
  es: "es",
  en: "en",
  it: "it",
  fr: "fr",
  de: "de",
  pt: "pt",
  ca: "ca",
  zh: "zh-CN",
  ja: "ja",
  ko: "ko",
  ar: "ar",
};
