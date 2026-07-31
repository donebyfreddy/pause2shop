import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  readLocaleCookie,
  getLocaleCookieClient,
  setLocaleCookieClient,
  getLocaleFromStorage,
  setLocaleInStorage,
  readPersistedLocale,
} from "../lib/localePersistence";

test("readLocaleCookie: extrae el valor entre otras cookies", () => {
  const raw = `theme=dark; ${LOCALE_COOKIE_NAME}=ja; other=1`;
  assert.equal(readLocaleCookie(raw), "ja");
});

test("readLocaleCookie: decodifica valores codificados", () => {
  assert.equal(readLocaleCookie(`${LOCALE_COOKIE_NAME}=zh-CN`), "zh-CN");
});

test("readLocaleCookie: null si no está presente o la cadena está vacía", () => {
  assert.equal(readLocaleCookie("theme=dark"), null);
  assert.equal(readLocaleCookie(undefined), null);
  assert.equal(readLocaleCookie(null), null);
});

test("getLocaleCookieClient / setLocaleCookieClient: sin document, no falla", () => {
  assert.equal(typeof document === "undefined", true, "este test asume entorno sin DOM");
  assert.equal(getLocaleCookieClient(), null);
  assert.doesNotThrow(() => setLocaleCookieClient("en"));
});

test("getLocaleFromStorage / setLocaleInStorage: sin window, no falla", () => {
  assert.equal(typeof window === "undefined", true, "este test asume entorno sin DOM");
  assert.equal(getLocaleFromStorage(), null);
  assert.doesNotThrow(() => setLocaleInStorage("en"));
});

test("getLocaleCookieClient/setLocaleCookieClient: con un document simulado", () => {
  const store = { value: "" };
  const fakeDocument = {
    get cookie() {
      return store.value;
    },
    set cookie(v: string) {
      // Emula el comportamiento real: cada set añade/actualiza una cookie.
      const [pair] = v.split(";");
      const [key] = pair.split("=");
      const rest = store.value
        .split(";")
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith(`${key}=`));
      store.value = [...rest, pair.trim()].join("; ");
    },
  };
  (globalThis as unknown as { document: unknown }).document = fakeDocument;
  try {
    setLocaleCookieClient("ko");
    assert.equal(getLocaleCookieClient(), "ko");
    setLocaleCookieClient("de");
    assert.equal(getLocaleCookieClient(), "de");
  } finally {
    delete (globalThis as unknown as { document?: unknown }).document;
  }
});

test("getLocaleFromStorage/setLocaleInStorage: con un localStorage simulado", () => {
  const store = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  };
  (globalThis as unknown as { window: unknown }).window = fakeWindow;
  try {
    assert.equal(getLocaleFromStorage(), null);
    setLocaleInStorage("pt");
    assert.equal(store.get(LOCALE_STORAGE_KEY), "pt");
    assert.equal(getLocaleFromStorage(), "pt");
  } finally {
    delete (globalThis as unknown as { window?: unknown }).window;
  }
});

test("readPersistedLocale: valida y normaliza, o null", () => {
  assert.equal(readPersistedLocale("fr"), "fr");
  assert.equal(readPersistedLocale("pt-BR"), "pt");
  assert.equal(readPersistedLocale("bogus"), null);
  assert.equal(readPersistedLocale(null), null);
});
