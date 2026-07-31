import { test } from "node:test";
import assert from "node:assert/strict";
import { LOCALES, DEFAULT_LOCALE } from "../i18n/locales";

type Messages = Record<string, unknown>;

function flatten(obj: Messages, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flatten(value as Messages, path);
    }
    return [path];
  });
}

async function loadLocaleMessages(locale: string): Promise<Messages> {
  const mod = await import(`../messages/${locale}.json`);
  return mod.default as Messages;
}

test("es.json (locale por defecto) carga y no está vacío", async () => {
  const es = await loadLocaleMessages(DEFAULT_LOCALE);
  const keys = flatten(es);
  assert.ok(keys.length > 0, "es.json no debería estar vacío");
});

test("todos los locales soportados tienen exactamente el mismo conjunto de claves que es.json", async () => {
  const es = await loadLocaleMessages(DEFAULT_LOCALE);
  const esKeys = new Set(flatten(es));

  const problems: string[] = [];

  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    const messages = await loadLocaleMessages(locale);
    const keys = new Set(flatten(messages));

    const missing = [...esKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !esKeys.has(k));

    if (missing.length > 0) {
      problems.push(`${locale}: faltan ${missing.length} claves → ${missing.join(", ")}`);
    }
    if (extra.length > 0) {
      problems.push(`${locale}: ${extra.length} claves de más → ${extra.join(", ")}`);
    }
  }

  assert.equal(problems.length, 0, `Desincronización de mensajes:\n${problems.join("\n")}`);
});

test("cada valor de mensaje con llaves { } tiene llaves balanceadas (sintaxis ICU básica)", async () => {
  const problems: string[] = [];

  for (const locale of LOCALES) {
    const messages = await loadLocaleMessages(locale);
    const entries = flattenWithValues(messages);
    for (const [path, value] of entries) {
      if (typeof value !== "string") continue;
      let depth = 0;
      for (const ch of value) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
        if (depth < 0) {
          problems.push(`${locale}.${path}: llave "}" sin abrir en "${value}"`);
          break;
        }
      }
      if (depth > 0) {
        problems.push(`${locale}.${path}: llave "{" sin cerrar en "${value}"`);
      }
    }
  }

  assert.equal(problems.length, 0, `Mensajes con llaves ICU desbalanceadas:\n${problems.join("\n")}`);
});

function flattenWithValues(obj: Messages, prefix = ""): Array<[string, unknown]> {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenWithValues(value as Messages, path);
    }
    return [[path, value]] as Array<[string, unknown]>;
  });
}
