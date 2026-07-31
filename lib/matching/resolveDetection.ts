import type { DetectedItem } from "@/lib/types";
import { catalogThresholdFor, type MatchingConfig } from "./config";
import type {
  DetectionMatchResult,
  ExternalBlockStatus,
  MatchingMode,
  MatchingUsage,
  NormalizedProductMatch,
  ProductCandidate,
  ProductMatchingInput,
  ProductMatchingProvider,
  ProductMatchingResult,
} from "./types";
import { emptyUsage } from "./types";

/**
 * Resolución de UNA detección con el catálogo propio como fuente PRINCIPAL y
 * la búsqueda externa como fuente secundaria, en bloques separados.
 *
 * Por qué existe este módulo y no basta con los providers compuestos:
 * `CatalogFirstMatchingProvider` devuelve UN `ProductMatchingResult`, así que
 * cuando cae al externo el resultado del catálogo se pierde por el camino
 * (`return { ...externalResult }`). Eso hacía imposible pintar "esto es lo que
 * hay en tu catálogo" y "esto es lo que hay en Internet" a la vez, y es la
 * razón de fondo por la que la UI acababa mostrando el resultado externo como
 * si fuera el único. Aquí las dos consultas se conservan enteras y por
 * separado; nadie sobreescribe a nadie.
 *
 * Los providers compuestos siguen existiendo intactos: los usan el análisis por
 * job (`resolveFrame`) y la ingesta. Este resolver es el que consume `/studio`.
 */

/** Coste estimado de una llamada al pipeline externo, en USD. */
const EXTERNAL_CALL_COST_USD =
  Number(process.env.EXTERNAL_SEARCH_ESTIMATED_COST_USD) || 0.006;

export type ResolveDetectionInput = {
  item: DetectedItem;
  /** Identidad estable de la detección; la fija quien llama (fingerprint). */
  detectionId: string;
  /** Segundo del vídeo, o null en análisis de imagen. */
  timestampSeconds?: number | null;
  cropDataUrl?: string;
  mode: MatchingMode;
  config: MatchingConfig;
  catalog: ProductMatchingProvider;
  /**
   * Pipeline externo. Ausente = no hay motor externo utilizable (sin
   * credenciales): el bloque externo queda `disabled`, nunca `error`.
   */
  external?: ProductMatchingProvider;
  /**
   * El usuario pulsó "Buscar también en Internet" para esta detección. Fuerza
   * la consulta externa aunque el catálogo haya resuelto — pero NO en
   * `catalog_only`, donde el operador ha decidido que no se sale fuera.
   */
  forceExternal?: boolean;
  skipCache?: boolean;
};

export type ResolveDetectionOutput = {
  detection: DetectionMatchResult;
  /** Resultados crudos por fuente (telemetría, persistencia, debug). */
  catalogResult: ProductMatchingResult | null;
  externalResult: ProductMatchingResult | null;
  usage: MatchingUsage;
};

/* --------------------------- normalización a UI --------------------------- */

/** Id estable de un candidato: el del producto, o su URL, o su título. */
function candidateId(m: NormalizedProductMatch, index: number): string {
  if (m.productId) return `${m.source}:${m.productId}`;
  if (m.productUrl) return `${m.source}:${m.productUrl}`;
  return `${m.source}:${index}:${m.title.slice(0, 60)}`;
}

/**
 * `NormalizedProductMatch` → `ProductCandidate`.
 *
 * `matchType` se recalcula aquí, y hacen falta DOS condiciones para que sea
 * más que "similar": que el candidato llegue al umbral de su fuente Y que la
 * fuente haya emitido un veredicto de coincidencia (`sourceVerified`).
 *
 * Sin la segunda, un candidato de 0.86 con umbral 0.72 se etiquetaba
 * "Coincidencia probable" aunque la verificación visual hubiera dictaminado que
 * no era el mismo producto — la tarjeta afirmaba una cosa y su bloque decía la
 * contraria.
 */
export function toProductCandidate(
  m: NormalizedProductMatch,
  index: number,
  threshold: number,
  item: DetectedItem,
  sourceVerified = true
): ProductCandidate {
  const reliable = sourceVerified && m.scores.finalScore >= threshold;
  const identityByHash =
    m.source === "catalog" &&
    (m.matchStage === "exact_hash" || m.matchStage === "perceptual_hash");
  // "Coincidencia exacta" es una afirmación de IDENTIDAD y solo se sostiene con
  // evidencia de identidad: la misma imagen (hash exacto/perceptual en el
  // catálogo, imagen idéntica en el motor externo). Un coseno de 0,90 entre
  // embeddings NO es identidad — es una camiseta azul muy parecida, y llamarla
  // "exacta" es justo el tipo de sobreafirmación que hace desconfiar del resto.
  const externalIdentity = m.source === "external" && m.matchType === "exact";
  let matchType: ProductCandidate["matchType"];
  if (!reliable) {
    matchType = "similar";
  } else if (identityByHash || externalIdentity) {
    matchType = "exact";
  } else {
    // Sin identidad, el techo es "probable" por mucho score que haya.
    matchType = "probable";
  }
  return {
    id: candidateId(m, index),
    title: m.title,
    brand: m.brand,
    imageUrl: m.imageUrl,
    price: m.price,
    currency: m.currency,
    productUrl: m.productUrl || null,
    category: m.category,
    // El color del CATÁLOGO cuando la fuente lo da; si no, el detectado, que
    // es lo único que consta (y sigue siendo cierto: es el color del objeto).
    color: m.catalogColor ?? item.color ?? null,
    score: m.scores.finalScore,
    source: m.source,
    matchType,
    isDemoProduct: m.isDemoProduct,
    merchant: m.merchant,
    evidence: m.evidence,
  };
}

function candidatesFrom(
  result: ProductMatchingResult,
  source: "catalog" | "external",
  threshold: number,
  item: DetectedItem,
  maxVisible: number
): ProductCandidate[] {
  // El veredicto de la fuente gobierna qué se puede AFIRMAR de sus candidatos:
  // sin etiqueta de coincidencia, todos quedan como "producto similar".
  const verified =
    result.matchLabel === (source === "catalog" ? "CATALOG_MATCH" : "EXTERNAL_MATCH");
  return result.matches
    .filter((m) => m.source === source)
    .sort((a, b) => b.scores.finalScore - a.scores.finalScore)
    .slice(0, maxVisible)
    .map((m, i) => toProductCandidate(m, i, threshold, item, verified));
}

/* ------------------------------ bloque catálogo ---------------------------- */

/** ¿Falló la consulta al catálogo (servicio caído) en vez de no encontrar nada? */
function catalogErrored(result: ProductMatchingResult): boolean {
  return (
    result.providerUsed == null &&
    Boolean(result.warnings?.some((w) => /no disponible|catálogo/i.test(w)))
  );
}

export function buildCatalogBlock(
  result: ProductMatchingResult | null,
  item: DetectedItem,
  config: MatchingConfig,
  opts: { requested: boolean }
): DetectionMatchResult["catalog"] {
  const threshold = catalogThresholdFor(config, item.category);
  if (!opts.requested || !result) {
    return { status: "not_requested", candidates: [], threshold };
  }

  const candidates = candidatesFrom(
    result,
    "catalog",
    threshold,
    item,
    // Se guardan hasta topK para poder ofrecer alternativas; el recorte de
    // presentación (maxVisible) lo aplica la UI sobre las ALTERNATIVAS.
    Math.max(config.catalogMatchTopK, config.catalogMatchMaxVisible + 1)
  );

  if (catalogErrored(result)) {
    return {
      status: "error",
      candidates,
      threshold,
      unresolvedReason:
        result.warnings?.[0] ?? "No se pudo consultar el catálogo.",
    };
  }

  // Doble puerta: la ETIQUETA del provider (que ya aplicó el umbral por
  // categoría) y el score del candidato. Con solo el score, un candidato podría
  // promocionarse a "seleccionado" en un caso que el provider había descartado.
  const selected =
    result.matchLabel === "CATALOG_MATCH"
      ? candidates.find((c) => c.score >= threshold)
      : undefined;
  if (selected) {
    return { status: "matched", selected, candidates, threshold };
  }

  // Ni un candidato por encima del suelo laxo: el catálogo no tiene nada
  // comparable indexado para esta categoría (distinto de "no llega al umbral").
  if (candidates.length === 0) {
    return {
      status: "empty",
      candidates,
      threshold,
      unresolvedReason:
        result.unresolvedReason ??
        "El catálogo no contiene productos indexados para esta categoría.",
    };
  }

  return {
    status: "unresolved",
    candidates,
    threshold,
    unresolvedReason:
      "No se encontró una coincidencia suficientemente fiable en el catálogo.",
  };
}

/* ------------------------------ bloque externo ---------------------------- */

export function buildExternalBlock(
  result: ProductMatchingResult | null,
  item: DetectedItem,
  config: MatchingConfig,
  opts: { status: ExternalBlockStatus }
): DetectionMatchResult["external"] {
  const threshold = config.externalMatchMinScore;
  if (!result) {
    return { status: opts.status, candidates: [], threshold };
  }

  const candidates = candidatesFrom(
    result,
    "external",
    threshold,
    item,
    config.catalogMatchTopK
  );
  const provider = result.providerUsed ?? undefined;

  // La verificación visual del pipeline externo tiene la última palabra: si
  // dijo que no es el mismo producto, un score alto no lo asciende a match.
  const selected =
    result.matchLabel === "EXTERNAL_MATCH"
      ? candidates.find((c) => c.score >= threshold)
      : undefined;

  if (selected) {
    return { status: "matched", selected, candidates, threshold, provider };
  }
  return {
    status: candidates.length > 0 || result.providerUsed ? "unresolved" : "error",
    candidates,
    threshold,
    provider,
    unresolvedReason:
      result.unresolvedReason ??
      (result.warnings?.length
        ? result.warnings[0]
        : "La búsqueda en Internet no devolvió una coincidencia fiable."),
  };
}

/* -------------------------------- decisión -------------------------------- */

/**
 * ¿Se consulta el catálogo en este modo? Solo `external_only` no lo hace.
 * (Duplicado a propósito de `capabilities.usesCatalog`: aquí es la decisión de
 * ejecución, allí la de disponibilidad de la UI.)
 */
function modeUsesCatalog(mode: MatchingMode): boolean {
  return mode !== "external_only";
}

/**
 * ¿Se llama al pipeline externo?
 *
 * Es la decisión que gobierna el coste, así que está aislada y es pura:
 *  - sin motor externo o con `EXTERNAL_SEARCH_ENABLED=false` → jamás;
 *  - `catalog_only` → jamás, ni siquiera a petición del usuario;
 *  - `external_only` / `catalog_and_external` → siempre (por diseño del modo);
 *  - `catalog_first` → solo si el catálogo NO resolvió y el fallback
 *    automático está activo, o si el usuario lo ha pedido explícitamente.
 */
export function shouldCallExternal(args: {
  mode: MatchingMode;
  config: MatchingConfig;
  hasExternalProvider: boolean;
  catalogMatched: boolean;
  forceExternal: boolean;
}): { call: boolean; status: ExternalBlockStatus; isFallback: boolean } {
  const { mode, config, hasExternalProvider, catalogMatched, forceExternal } = args;

  if (!config.externalSearchEnabled || !hasExternalProvider) {
    return { call: false, status: "disabled", isFallback: false };
  }
  if (mode === "catalog_only") {
    return { call: false, status: "disabled", isFallback: false };
  }
  if (mode === "external_only" || mode === "catalog_and_external") {
    return { call: true, status: "loading", isFallback: false };
  }
  // catalog_first
  if (forceExternal) {
    return { call: true, status: "loading", isFallback: !catalogMatched };
  }
  if (catalogMatched) {
    // El catálogo resolvió: coste externo CERO. Es el punto del modo.
    return { call: false, status: "not_requested", isFallback: false };
  }
  if (!config.catalogExternalFallback) {
    // Sin fallback automático: el bloque queda a la espera del usuario.
    return { call: false, status: "not_requested", isFallback: false };
  }
  return { call: true, status: "loading", isFallback: true };
}

/* ------------------------------ orquestación ------------------------------ */

export async function resolveDetectionMatch(
  input: ResolveDetectionInput
): Promise<ResolveDetectionOutput> {
  const {
    item,
    detectionId,
    timestampSeconds = null,
    cropDataUrl,
    mode,
    config,
    catalog,
    external,
    forceExternal = false,
    skipCache,
  } = input;

  const usage = emptyUsage();
  usage.detections = 1;
  const searchInput: ProductMatchingInput = { item, cropDataUrl, skipCache };

  // 1) CATÁLOGO PRIMERO. Siempre, salvo en external_only.
  const useCatalog = modeUsesCatalog(mode);
  let catalogResult: ProductMatchingResult | null = null;
  if (useCatalog) {
    catalogResult = await catalog.search(searchInput);
    usage.catalogQueries = 1;
    if (catalogResult.cached) usage.cacheHits += 1;
    Object.assign(usage.timings, catalogResult.timings);
  }

  const catalogBlock = buildCatalogBlock(catalogResult, item, config, {
    requested: useCatalog,
  });
  const catalogMatched = catalogBlock.status === "matched";

  // 2) EXTERNO, solo si procede. `decision` es la única puerta al gasto.
  const decision = shouldCallExternal({
    mode,
    config,
    hasExternalProvider: Boolean(external),
    catalogMatched,
    forceExternal,
  });

  let externalResult: ProductMatchingResult | null = null;
  let externalBlock: DetectionMatchResult["external"];
  if (decision.call && external) {
    externalResult = await external.search(searchInput);
    usage.externalCalls = 1;
    if (externalResult.cached) usage.cacheHits += 1;
    else usage.estimatedExternalCostUsd += EXTERNAL_CALL_COST_USD;
    if (decision.isFallback) usage.fallbacks = 1;
    Object.assign(usage.timings, externalResult.timings);
    externalBlock = buildExternalBlock(externalResult, item, config, {
      status: "loading",
    });
  } else {
    externalBlock = buildExternalBlock(null, item, config, {
      status: decision.status,
    });
  }

  if (catalogMatched) usage.resolvedInternally = 1;
  else if (externalBlock.status === "matched") usage.resolvedExternally = 1;
  else usage.unresolved = 1;

  return {
    detection: {
      detectionId,
      label: item.name,
      confidence: Number.isFinite(item.confidence) ? item.confidence : 0,
      boundingBox: item.bounding_box ?? null,
      timestampSeconds,
      catalog: catalogBlock,
      external: externalBlock,
      matchingMode: mode,
    },
    catalogResult,
    externalResult,
    usage,
  };
}
