import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLocale, matchLocaleTag, parseAcceptLanguage } from "../lib/detectLocale";

test("matchLocaleTag: coincidencia exacta", () => {
  assert.equal(matchLocaleTag("zh-CN"), "zh-CN");
  assert.equal(matchLocaleTag("es"), "es");
});

test("matchLocaleTag: coincidencia por idioma base", () => {
  assert.equal(matchLocaleTag("pt-BR"), "pt");
  assert.equal(matchLocaleTag("en-US"), "en");
  assert.equal(matchLocaleTag("zh-TW"), "zh-CN");
});

test("matchLocaleTag: etiqueta desconocida o vacía", () => {
  assert.equal(matchLocaleTag("xx-YY"), null);
  assert.equal(matchLocaleTag(""), null);
  assert.equal(matchLocaleTag(null), null);
  assert.equal(matchLocaleTag(undefined), null);
});

test("parseAcceptLanguage: ordena por q descendente", () => {
  const tags = parseAcceptLanguage("fr;q=0.5, en-US;q=0.9, es;q=1.0, de;q=0.1");
  assert.deepEqual(tags, ["es", "en-US", "fr", "de"]);
});

test("parseAcceptLanguage: sin q asume 1", () => {
  assert.deepEqual(parseAcceptLanguage("en-GB"), ["en-GB"]);
});

test("parseAcceptLanguage: cabecera vacía", () => {
  assert.deepEqual(parseAcceptLanguage(undefined), []);
  assert.deepEqual(parseAcceptLanguage(null), []);
});

test("detectLocale: la cookie gana a todo lo demás", () => {
  const result = detectLocale({
    cookie: "ja",
    localStorage: "de",
    languageTags: ["fr"],
  });
  assert.equal(result, "ja");
});

test("detectLocale: sin cookie válida, gana localStorage", () => {
  const result = detectLocale({
    cookie: "xx",
    localStorage: "ko",
    languageTags: ["fr"],
  });
  assert.equal(result, "ko");
});

test("detectLocale: sin cookie ni localStorage válidos, gana el navegador", () => {
  const result = detectLocale({
    cookie: null,
    localStorage: null,
    languageTags: ["xx-YY", "fr-CA"],
  });
  assert.equal(result, "fr");
});

test("detectLocale: fallback a español si nada coincide", () => {
  const result = detectLocale({ cookie: null, localStorage: null, languageTags: ["xx"] });
  assert.equal(result, "es");
});

test("detectLocale: sin ninguna entrada, fallback a español", () => {
  assert.equal(detectLocale({}), "es");
});
