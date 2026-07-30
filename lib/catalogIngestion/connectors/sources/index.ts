import type { ConnectorSpec } from "../base/types";
import { INDITEX_SOURCES } from "./inditex";
import { HM_GROUP_SOURCES } from "./hmGroup";
import { SPAIN_SOURCES } from "./spain";
import { EUROPE_SOURCES } from "./europe";
import { SPORTSWEAR_SOURCES } from "./sportswear";
import { PREMIUM_SOURCES } from "./premium";

/**
 * Catálogo de fuentes de moda. Es DATOS: añadir una tienda es una entrada
 * declarativa en el fichero de su grupo, no una clase nueva.
 *
 * El orden define el orden por defecto en el admin: primero lo verificado.
 */
export const SOURCE_SPECS: ConnectorSpec[] = [
  ...INDITEX_SOURCES,
  ...HM_GROUP_SOURCES,
  ...SPAIN_SOURCES,
  ...EUROPE_SOURCES,
  ...SPORTSWEAR_SOURCES,
  ...PREMIUM_SOURCES,
];

/** Guard de integridad del registro: ids únicos y patrones compilables. */
export function assertSourcesValid(specs: ConnectorSpec[] = SOURCE_SPECS): void {
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.id)) throw new Error(`spec duplicado: ${spec.id}`);
    seen.add(spec.id);
    new RegExp(spec.productUrlPattern);
    if (spec.productIdPattern) new RegExp(spec.productIdPattern);
    if (spec.implementation !== "scaffold" && spec.productUrlPattern === "$^") {
      throw new Error(`spec ${spec.id}: falta productUrlPattern`);
    }
    if (spec.implementation === "scaffold" && !spec.notes) {
      throw new Error(`spec ${spec.id}: un scaffold necesita notes explicando qué falta`);
    }
  }
}

export {
  INDITEX_SOURCES,
  HM_GROUP_SOURCES,
  SPAIN_SOURCES,
  EUROPE_SOURCES,
  SPORTSWEAR_SOURCES,
  PREMIUM_SOURCES,
};
