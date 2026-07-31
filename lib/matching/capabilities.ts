import { getMatchingConfig } from "./config";
import { MATCHING_MODES, type MatchingMode } from "./types";
import { getVisualSearchConfig } from "@/lib/visualSearch/config";
import { isPubliclyReachableBase } from "@/lib/mediaStorage";

/**
 * Qué fuentes de coincidencias puede usar REALMENTE este despliegue.
 *
 * Sirve para que el selector deshabilite lo que no funciona en vez de dejar al
 * usuario elegir un modo que devolverá cero resultados sin explicación. La
 * regla es no fingir: si no hay credenciales del proveedor externo, la opción
 * se muestra deshabilitada con el motivo, no se simula la llamada.
 */

export type SourceAvailability = {
  available: boolean;
  /** Motivo legible cuando `available` es false (nunca expone secretos). */
  reason: string | null;
};

export type MatchingCapabilities = {
  catalog: SourceAvailability & { indexedProducts: number | null };
  external: SourceAvailability & { primaryProvider: string | null };
  /** Por modo: si se puede seleccionar y por qué no. */
  modes: Record<MatchingMode, SourceAvailability>;
  defaultMode: MatchingMode;
  thresholds: {
    catalog: number;
    external: number;
    hybrid: number;
  };
};

/** Disponibilidad del pipeline externo: credenciales + storage alcanzable. */
export function externalAvailability(
  env: NodeJS.ProcessEnv = process.env
): SourceAvailability & { primaryProvider: string | null } {
  const cfg = getVisualSearchConfig(env);
  const hasKey = Boolean(cfg.searchApiKey || cfg.serpApiKey);
  if (!hasKey) {
    return {
      available: false,
      reason:
        "No hay credenciales del proveedor externo (SEARCHAPI_API_KEY o SERPAPI_API_KEY).",
      primaryProvider: null,
    };
  }

  // Sin una URL pública alcanzable, el proveedor no puede descargar el crop:
  // la llamada se gastaría para nada.
  const base = cfg.storage?.publicBaseUrl;
  if (base && !isPubliclyReachableBase(base)) {
    return {
      available: false,
      reason:
        "La URL pública de medios no es alcanzable desde Internet: el proveedor externo no podría descargar el recorte.",
      primaryProvider: null,
    };
  }

  const primaryProvider =
    env.REVERSE_IMAGE_PRIMARY_PROVIDER === "serpapi_google_lens"
      ? "serpapi_google_lens"
      : "searchapi_google_lens";
  return { available: true, reason: null, primaryProvider };
}

/**
 * Combina disponibilidad de fuentes con el número de productos indexados para
 * decidir qué modos son seleccionables.
 *
 * `indexedProducts === null` significa "no se pudo consultar el catálogo": en
 * ese caso NO se deshabilita nada (no bloqueamos por un fallo de lectura).
 */
export function buildCapabilities(opts: {
  indexedProducts: number | null;
  env?: NodeJS.ProcessEnv;
}): MatchingCapabilities {
  const env = opts.env ?? process.env;
  const config = getMatchingConfig(env);
  const external = externalAvailability(env);

  const catalogEmpty = opts.indexedProducts === 0;
  const catalog: MatchingCapabilities["catalog"] = {
    available: !catalogEmpty,
    reason: catalogEmpty
      ? "El catálogo todavía no contiene productos indexados."
      : null,
    indexedProducts: opts.indexedProducts,
  };

  const modes = {} as Record<MatchingMode, SourceAvailability>;
  for (const mode of MATCHING_MODES) {
    modes[mode] = availabilityForMode(mode, catalog, external);
  }

  return {
    catalog,
    external,
    modes,
    defaultMode: config.mode,
    thresholds: {
      catalog: config.catalogMatchMinScore,
      external: config.externalMatchMinScore,
      hybrid: config.hybridMatchMinScore,
    },
  };
}

function availabilityForMode(
  mode: MatchingMode,
  catalog: SourceAvailability,
  external: SourceAvailability
): SourceAvailability {
  switch (mode) {
    case "catalog_only":
      return catalog;
    case "external_only":
      return { available: external.available, reason: external.reason };
    case "catalog_first":
      // Sigue siendo útil aunque falte una de las dos: con el catálogo vacío
      // cae al externo, y sin externo devuelve lo que tenga el catálogo.
      return catalog.available || external.available
        ? { available: true, reason: null }
        : {
            available: false,
            reason: "Ni el catálogo ni la búsqueda externa están disponibles.",
          };
    case "catalog_and_external":
      // Comparar exige DOS fuentes: con una sola no hay nada que comparar.
      if (catalog.available && external.available) {
        return { available: true, reason: null };
      }
      return {
        available: false,
        reason: catalog.available
          ? external.reason
          : catalog.reason ?? "El catálogo no está disponible.",
      };
  }
}
