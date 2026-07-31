"use client";

import { NextIntlClientProvider } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, isRtl, type Locale } from "@/i18n/locales";
import { FORMATS } from "@/i18n/formats";
import { persistLocale } from "@/lib/localePersistence";
import { readByDotPath } from "@/lib/messagesFallback";

/**
 * Único punto en el árbol que sabe conmutar idioma. Renderiza
 * `NextIntlClientProvider` una sola vez y solo cambia su `locale`/`messages`
 * vía estado local — `children` nunca se recrea ni se le pone `key` por
 * locale, así que React re-renderiza el texto pero no desmonta nada por
 * debajo (vídeo en curso, formularios, resultados, scroll).
 */

type Messages = Record<string, unknown>;

interface LocaleSwitchApi {
  locale: Locale;
  setLocale: (next: Locale) => Promise<void>;
  isSwitching: boolean;
}

const LocaleSwitchContext = createContext<LocaleSwitchApi | null>(null);

export function useLocaleSwitch(): LocaleSwitchApi {
  const ctx = useContext(LocaleSwitchContext);
  if (!ctx) {
    // Coherente con el patrón de useToast: no lanza si falta el provider,
    // se degrada a un no-op para no romper renders fuera de árbol de prueba.
    return { locale: DEFAULT_LOCALE, setLocale: async () => {}, isSwitching: false };
  }
  return ctx;
}

async function importMessages(locale: Locale): Promise<Messages> {
  const mod = await import(`../../messages/${locale}.json`);
  return mod.default as Messages;
}

function applyDocumentAttributes(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
}

let cachedEsMessages: Messages | null = null;
async function getEsFallbackMessages(): Promise<Messages> {
  if (!cachedEsMessages) {
    const mod = await import("../../messages/es.json");
    cachedEsMessages = mod.default as Messages;
  }
  return cachedEsMessages;
}

export function LocaleProvider({
  initialLocale,
  initialMessages,
  children,
}: {
  initialLocale: Locale;
  initialMessages: Messages;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState(initialLocale);
  const [messages, setMessages] = useState<Messages>(initialMessages);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    if (initialLocale === "es") {
      cachedEsMessages = initialMessages;
    } else {
      void getEsFallbackMessages();
    }
    // Solo debe ejecutarse una vez, al montar el provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback(
    async (next: Locale) => {
      if (next === locale) return;
      setIsSwitching(true);
      try {
        const nextMessages = await importMessages(next);
        setMessages(nextMessages);
        setLocaleState(next);
        persistLocale(next);
        applyDocumentAttributes(next);
      } finally {
        setIsSwitching(false);
      }
    },
    [locale]
  );

  const api = useMemo<LocaleSwitchApi>(
    () => ({ locale, setLocale, isSwitching }),
    [locale, setLocale, isSwitching]
  );

  return (
    <LocaleSwitchContext.Provider value={api}>
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        formats={FORMATS}
        onError={(error) => {
          if (error.code !== "MISSING_MESSAGE") {
            // eslint-disable-next-line no-console
            console.error(error);
          }
        }}
        getMessageFallback={({ key, namespace }) => {
          const dotPath = namespace ? `${namespace}.${key}` : key;
          // Resolución síncrona best-effort: si el fallback en español ya
          // está en caché (siempre lo estará tras el primer render, porque
          // es.json es el locale por defecto o ya se importó antes), se usa
          // directamente; si no, se devuelve la propia key para no romper el
          // render mientras se resuelve en segundo plano para la próxima vez.
          if (cachedEsMessages) {
            const value = readByDotPath(cachedEsMessages, dotPath);
            if (typeof value === "string") return value;
          } else {
            void getEsFallbackMessages();
          }
          return dotPath;
        }}
      >
        {children}
      </NextIntlClientProvider>
    </LocaleSwitchContext.Provider>
  );
}
