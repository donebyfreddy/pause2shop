import type { DetectedItem } from "@/lib/types";
import { CatalogClient } from "./catalogClient";
import type { MatchingConfig } from "./config";
import type {
  MatchLabel,
  NormalizedProductMatch,
  ProductMatchingInput,
  ProductMatchingProvider,
  ProductMatchingResult,
} from "./types";
import { noMatchResult } from "./types";

/**
 * Estrategias compuestas: catalog-first (catálogo → fallback externo) e
 * hybrid (ambos, ranking común SIN mezclar procedencia — cada match conserva
 * su `source`). Resiliencia: catálogo caído → externo (si el modo lo permite);
 * externo caído → lo que dio el catálogo; ambos caídos → NO_MATCH sin romper.
 */

/** Providers del contrato externo aceptados por POST /products/external. */
const SAVABLE_PROVIDERS = new Set([
  "serpapi_google_lens",
  "searchapi_google_lens",
  "serpapi_google_shopping",
  "dataforseo_google_shopping",
]);

/**
 * Umbral de fiabilidad para INGERIR un resultado externo en el catálogo.
 * Más laxo que catalogMatchMinScore (que gobierna cuándo el catálogo
 * responde solo), pero exige etiqueta de match real, no SIMILAR.
 */
const SAVE_EXTERNAL_MIN_SCORE = 0.6;

function isReliableExternal(result: ProductMatchingResult): boolean {
  const best = result.matches[0];
  return (
    result.matchLabel === "EXTERNAL_MATCH" &&
    Boolean(best) &&
    best.scores.finalScore >= SAVE_EXTERNAL_MIN_SCORE
  );
}

/**
 * Ingesta best-effort del mejor resultado externo (POST /products/external).
 * Nunca lanza; los fallos se reportan como warning. La marca solo se envía
 * si hay evidencia (brandEvidenceScore) — nunca porque el título la contenga.
 */
export async function saveExternalResult(
  _client: CatalogClient,
  result: ProductMatchingResult,
  item: DetectedItem
): Promise<string | null> {
  const best = result.matches[0];
  if (!best) return "Sin match externo que guardar.";
  const provider = best.provider;
  if (!SAVABLE_PROVIDERS.has(provider)) {
    return `Proveedor externo no ingerible: ${best.provider}`;
  }
  if (!best.imageUrl || !best.productUrl) {
    return "El resultado externo no tiene imagen y URL comercial verificables.";
  }
  const { getExternalCandidateStore } = await import(
    "@/lib/videoProcessing/candidateStore"
  );
  await getExternalCandidateStore().save({
    id: best.productId ?? best.productUrl,
    title: best.title,
    ...(best.scores.brandEvidenceScore != null && best.brand
      ? { brand: best.brand }
      : {}),
    imageUrl: best.imageUrl,
    ...(best.merchant ? { merchant: best.merchant } : {}),
    ...(best.price != null ? { price: best.price } : {}),
    ...(best.currency ? { currency: best.currency } : {}),
    productUrl: best.productUrl,
    category: best.category ?? item.category,
    visualScore: best.scores.visualScore ?? best.scores.finalScore,
    commercialScore: [best.merchant, best.price != null, best.imageUrl].filter(Boolean)
      .length / 3,
    finalScore: best.scores.finalScore,
    provider,
    sourcePage: best.productUrl,
    originalImageUrl: best.imageUrl,
    evidence: [
      ...best.evidence,
      "Candidato externo pendiente de revisión; no publicado.",
    ],
    attributes: { color: item.color ?? null, category: item.category },
  });
  return null;
}

/**
 * Clave de identidad de un producto entre fuentes distintas: la URL canónica
 * (sin query de tracking) y, si no hay, marca+título normalizados.
 */
export function productIdentityKey(m: NormalizedProductMatch): string {
  const url = m.productUrl?.trim();
  if (url) {
    try {
      const u = new URL(url);
      return `url:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
    } catch {
      // URL no parseable: cae al criterio textual.
    }
  }
  const brand = (m.brand ?? "").trim().toLowerCase();
  const title = m.title.trim().toLowerCase().replace(/\s+/g, " ");
  return `txt:${brand}|${title}`;
}

/**
 * Deduplica el ranking combinado conservando, para cada producto, la aparición
 * de MAYOR score. En empate gana el catálogo: es la fuente sobre la que
 * tenemos control y datos verificados. La procedencia nunca se mezcla — el
 * match superviviente conserva su propio `source`.
 */
export function dedupeAcrossSources(
  all: NormalizedProductMatch[]
): NormalizedProductMatch[] {
  const best = new Map<string, NormalizedProductMatch>();
  for (const m of all) {
    const key = productIdentityKey(m);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, m);
      continue;
    }
    const better =
      m.scores.finalScore > prev.scores.finalScore ||
      (m.scores.finalScore === prev.scores.finalScore &&
        m.source === "catalog" &&
        prev.source === "external");
    if (better) best.set(key, m);
  }
  return [...best.values()].sort(
    (a, b) => b.scores.finalScore - a.scores.finalScore
  );
}

type CompositeDeps = {
  catalog: ProductMatchingProvider;
  external: ProductMatchingProvider;
  client: CatalogClient;
  config: MatchingConfig;
};

/**
 * catalog-first: catálogo primero; si su mejor finalScore alcanza el umbral
 * se devuelve SIN llamar al pipeline externo (coste cero). Si no, fallback
 * externo (si CATALOG_EXTERNAL_FALLBACK) y guardado del resultado fiable en
 * el catálogo (si CATALOG_SAVE_EXTERNAL_RESULTS).
 */
export class CatalogFirstMatchingProvider implements ProductMatchingProvider {
  constructor(private readonly deps: CompositeDeps) {}

  async search(input: ProductMatchingInput): Promise<ProductMatchingResult> {
    const { catalog, external, client, config } = this.deps;
    const catalogResult = await catalog.search(input);

    if (catalogResult.matchLabel === "CATALOG_MATCH") {
      // Coste cero: el catálogo resolvió, no se llama al proveedor externo.
      return {
        ...catalogResult,
        matchingMode: "catalog_first",
        catalogAttempted: true,
        externalAttempted: false,
        externalFallbackUsed: false,
      };
    }

    if (!config.catalogExternalFallback) {
      // Sin fallback permitido: se devuelve lo que dio el catálogo (SIMILAR
      // o NO_MATCH) — decisión explícita del operador.
      return {
        ...catalogResult,
        matchingMode: "catalog_first",
        catalogAttempted: true,
        externalAttempted: false,
        externalFallbackUsed: false,
      };
    }

    const externalResult = await external.search(input);
    const warnings = [
      ...(catalogResult.warnings ?? []),
      ...(externalResult.warnings ?? []),
    ];

    if (externalResult.matchLabel === "NO_MATCH" && catalogResult.matches.length > 0) {
      // El externo no aportó nada: mejor los SIMILAR del catálogo que nada.
      return {
        ...catalogResult,
        fallbackUsed: true,
        warnings: warnings.length ? warnings : undefined,
        timings: { ...catalogResult.timings, ...externalResult.timings },
        matchingMode: "catalog_first",
        catalogAttempted: true,
        externalAttempted: true,
        externalFallbackUsed: true,
      };
    }

    if (config.catalogSaveExternalResults && isReliableExternal(externalResult)) {
      const saveWarning = await saveExternalResult(client, externalResult, input.item);
      if (saveWarning) warnings.push(saveWarning);
    }

    return {
      ...externalResult,
      fallbackUsed: true,
      timings: { ...catalogResult.timings, ...externalResult.timings },
      warnings: warnings.length ? warnings : undefined,
      matchingMode: "catalog_first",
      catalogAttempted: true,
      externalAttempted: true,
      externalFallbackUsed: true,
      unresolvedReason:
        externalResult.matchLabel === "NO_MATCH"
          ? "No se encontró una coincidencia suficientemente fiable."
          : undefined,
    };
  }
}

/**
 * hybrid: consulta el catálogo y, salvo que este ya haya identificado el
 * producto por imagen idéntica (exact/perceptual hash sobre el umbral),
 * también el externo. El ranking final es común (ordenado por finalScore)
 * pero cada match CONSERVA su `source` — nunca se mezcla la procedencia.
 */
export class HybridMatchingProvider implements ProductMatchingProvider {
  constructor(private readonly deps: CompositeDeps) {}

  async search(input: ProductMatchingInput): Promise<ProductMatchingResult> {
    const { catalog, external, config } = this.deps;
    const catalogResult = await catalog.search(input);

    const bestCatalog = catalogResult.matches[0];
    const identityByHash =
      catalogResult.matchLabel === "CATALOG_MATCH" &&
      (bestCatalog?.matchStage === "exact_hash" ||
        bestCatalog?.matchStage === "perceptual_hash");

    // Justificación del segundo camino: si el catálogo ya encontró la imagen
    // idéntica, otra búsqueda externa de pago no aporta identidad.
    const externalResult = identityByHash
      ? noMatchResult({ timings: {} })
      : await external.search(input);

    const matches = dedupeAcrossSources([
      ...catalogResult.matches,
      ...externalResult.matches,
    ]);

    // El catálogo NO se favorece automáticamente ni se desfavorece: gana quien
    // tenga mejor score. Pero cuando el catálogo alcanza SU umbral, su match es
    // el fiable (es un producto nuestro, verificado e indexado).
    let matchLabel: MatchLabel = "NO_MATCH";
    if (catalogResult.matchLabel === "CATALOG_MATCH") matchLabel = "CATALOG_MATCH";
    else if (
      externalResult.matchLabel === "EXTERNAL_MATCH" &&
      (matches[0]?.scores.finalScore ?? 0) >= config.hybridMatchMinScore
    )
      matchLabel = "EXTERNAL_MATCH";
    else if (matches.length > 0) matchLabel = "SIMILAR";

    const providers = [
      catalogResult.providerUsed,
      externalResult.providerUsed,
    ].filter(Boolean);
    const warnings = [
      ...(catalogResult.warnings ?? []),
      ...(externalResult.warnings ?? []),
    ];

    if (
      config.catalogSaveExternalResults &&
      catalogResult.matchLabel !== "CATALOG_MATCH" &&
      isReliableExternal(externalResult)
    ) {
      const saveWarning = await saveExternalResult(
        this.deps.client,
        externalResult,
        input.item
      );
      if (saveWarning) warnings.push(saveWarning);
    }

    return {
      matches,
      matchLabel,
      providerUsed: providers.join("+") || null,
      fallbackUsed: catalogResult.fallbackUsed || externalResult.fallbackUsed,
      cached: catalogResult.cached && (identityByHash || externalResult.cached),
      timings: { ...catalogResult.timings, ...externalResult.timings },
      warnings: warnings.length ? warnings : undefined,
      matchingMode: "catalog_and_external",
      catalogAttempted: true,
      externalAttempted: !identityByHash,
      // En comparar, el externo NO es un fallback: se consulta por diseño.
      externalFallbackUsed: false,
      unresolvedReason:
        matchLabel === "NO_MATCH"
          ? "Ni el catálogo ni la búsqueda externa devolvieron candidatos."
          : undefined,
    };
  }
}
