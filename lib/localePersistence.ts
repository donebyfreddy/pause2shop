import { matchLocaleTag } from "./detectLocale";
import type { Locale } from "@/i18n/locales";

/**
 * Persistencia del locale elegido por el usuario, en cliente.
 *
 * Doble almacenamiento a propósito: la cookie es lo que lee el servidor
 * (`i18n/request.ts`) para renderizar ya en el idioma correcto en el primer
 * byte; localStorage es una capa de respaldo y lo que se consulta para la
 * detección inicial junto al idioma del navegador. Ambas se escriben siempre
 * juntas para que nunca queden desincronizadas.
 */

export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
export const LOCALE_STORAGE_KEY = "pause2shop:locale";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function readLocaleCookie(cookieString: string | undefined | null): string | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === LOCALE_COOKIE_NAME) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

export function getLocaleCookieClient(): string | null {
  if (typeof document === "undefined") return null;
  return readLocaleCookie(document.cookie);
}

export function setLocaleCookieClient(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function getLocaleFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLocaleInStorage(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* cuota o almacenamiento deshabilitado — ignorar */
  }
}

/** Escribe el locale elegido en ambos almacenes de una vez. */
export function persistLocale(locale: Locale): void {
  setLocaleCookieClient(locale);
  setLocaleInStorage(locale);
}

/** Lee las preferencias de idioma del navegador, en orden de preferencia. */
export function getBrowserLanguageTags(): string[] {
  if (typeof navigator === "undefined") return [];
  return [...navigator.languages];
}

/** Valida y normaliza un valor persistido (cookie o localStorage) a un locale, o null. */
export function readPersistedLocale(raw: string | null): Locale | null {
  return matchLocaleTag(raw);
}
