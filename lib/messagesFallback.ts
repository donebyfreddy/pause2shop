/**
 * Resolución de fallback para claves de traducción ausentes en el idioma
 * activo. Usado por `getMessageFallback` en `LocaleProvider` — separado en un
 * módulo propio para poder probarlo como función pura, sin next-intl ni DOM.
 */

export type Messages = Record<string, unknown>;

export function readByDotPath(source: Messages, dotPath: string): unknown {
  return dotPath.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

/**
 * Devuelve el string en español para `dotPath`, o el propio `dotPath` si ni
 * siquiera existe en el fallback en español (evita romper el render; deja un
 * rastro reconocible en pantalla para depurar).
 */
export function resolveFallback(esMessages: Messages, dotPath: string): string {
  const value = readByDotPath(esMessages, dotPath);
  return typeof value === "string" ? value : dotPath;
}
