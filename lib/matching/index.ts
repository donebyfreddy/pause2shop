import { CatalogClient, getCatalogClient } from "./catalogClient";
import { CatalogMatchingProvider } from "./catalogProvider";
import { getMatchingConfig, type MatchingConfig } from "./config";
import {
  ExternalVisualSearchProvider,
  type ExternalSearchFn,
} from "./externalProvider";
import {
  CatalogFirstMatchingProvider,
  HybridMatchingProvider,
} from "./hybridProvider";
import type { MatchingMode, ProductMatchingProvider } from "./types";

export * from "./types";
export { catalogThresholdFor, getMatchingConfig, isMatchingMode } from "./config";
export type { MatchingConfig } from "./config";
export { CatalogClient, getCatalogClient } from "./catalogClient";
export { CatalogMatchingProvider } from "./catalogProvider";
export {
  ExternalVisualSearchProvider,
  externalOutcomeToResult,
  type ExternalPipelineOutcome,
  type ExternalSearchFn,
} from "./externalProvider";
export {
  CatalogFirstMatchingProvider,
  HybridMatchingProvider,
  dedupeAcrossSources,
  productIdentityKey,
} from "./hybridProvider";

/** Dependencias inyectables del orquestador (tests y wiring del route). */
export type MatchingProviderDeps = {
  config?: MatchingConfig;
  client?: CatalogClient;
  catalog?: ProductMatchingProvider;
  /** Delegado sobre el pipeline externo EXISTENTE (el route pasa su closure). */
  externalSearch?: ExternalSearchFn;
  external?: ProductMatchingProvider;
};

/**
 * Orquestador: devuelve el provider de la estrategia pedida.
 *
 *  - external-only  → el pipeline actual intacto (default si no hay env).
 *  - catalog-only   → solo catálogo; si está caído, NO_MATCH con warning.
 *  - catalog-first  → catálogo y, si no resuelve, fallback externo + ingesta.
 *  - hybrid         → ambos con ranking común sin mezclar procedencia.
 */
export function getMatchingProvider(
  mode: MatchingMode,
  deps: MatchingProviderDeps = {}
): ProductMatchingProvider {
  const config = deps.config ?? getMatchingConfig();
  const client = deps.client ?? getCatalogClient();
  const catalog =
    deps.catalog ?? new CatalogMatchingProvider({ client, config });
  const external =
    deps.external ??
    new ExternalVisualSearchProvider(
      deps.externalSearch ??
        // Sin delegado no hay pipeline externo utilizable: se degrada a
        // "sin resultados" en vez de romper (el route SIEMPRE pasa el suyo).
        (async () => ({
          match: null,
          providerUsed: null,
          fallbackUsed: false,
          cached: false,
          timings: {},
        })),
      config.externalMatchMinScore
    );

  switch (mode) {
    case "catalog_only":
      return stampMode(catalog, "catalog_only");
    case "external_only":
      return stampMode(external, "external_only");
    case "catalog_first":
      return new CatalogFirstMatchingProvider({ catalog, external, client, config });
    case "hybrid":
      return new HybridMatchingProvider({ catalog, external, client, config });
  }
}

/**
 * Marca el resultado con el modo que lo produjo. Los providers simples no
 * conocen la estrategia que los envuelve; los compuestos sí y ya se marcan.
 */
function stampMode(
  provider: ProductMatchingProvider,
  mode: MatchingMode
): ProductMatchingProvider {
  return {
    async search(input) {
      const result = await provider.search(input);
      return { ...result, matchingMode: mode };
    },
  };
}
