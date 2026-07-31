import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { detectLocale, parseAcceptLanguage } from "@/lib/detectLocale";
import { LOCALE_COOKIE_NAME } from "@/lib/localePersistence";
import type { Locale } from "./locales";
import { FORMATS } from "./formats";

export async function resolveRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const headerStore = await headers();

  return detectLocale({
    cookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null,
    languageTags: parseAcceptLanguage(headerStore.get("accept-language")),
  });
}

export async function loadMessages(locale: Locale) {
  const mod = await import(`../messages/${locale}.json`);
  return mod.default;
}

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale();
  const messages = await loadMessages(locale);

  return {
    locale,
    messages,
    formats: FORMATS,
  };
});
