import { getVisualSearchConfig } from "@/lib/visualSearch/config";
import { decodeImageDataUrl, uploadFramePublic } from "@/lib/visualSearch/storage";
import { cacheGet, cacheSet, lensCropCacheKey } from "@/lib/visualSearch/cache";
import { rankCandidates } from "@/lib/visualSearch/rank";
import { buildSearchQueries } from "@/lib/visualSearch/queryBuilder";
import { dataForSeoShopping } from "@/lib/visualSearch/providers";
import {
  enrichCropDetailsCached,
  mergeCropDetails,
  shouldEnrichCrop,
  type CropDetails,
} from "@/lib/visualSearch/cropEnrichment";
import { runReverseImageSearch } from "@/lib/visualSearch/reverseImage/orchestrator";
import { buildVerifiedMatch } from "@/lib/visualSearch/verifiedRank";
import { verifyTopCandidates } from "@/lib/visualSearch/visualVerification";
import type { ProviderCallLog } from "@/lib/visualSearch/reverseImage/types";
import type {
  RankedCandidate,
  VisualCandidate,
  VisualMatch,
} from "@/lib/visualSearch/types";
import type { DetectedItem } from "@/lib/types";
import { budgetSnapshot, canSearch, recordSearch } from "@/lib/server/searchBudget";
import { publishCropLocally } from "@/lib/server/cropStore";
import {
  trackCacheHit,
  trackReverseSearch,
  trackShoppingSearch,
  trackVisionCall,
} from "@/lib/server/costTracker";
import { getCatalogRepository } from "@/lib/catalog";
import { isHttpUrl, MAX_INLINE_CROP_BYTES } from "@/lib/catalog/images";
import type { RecommendationInput } from "@/lib/catalog/types";
import { getExternalCandidateStore } from "@/lib/videoProcessing/candidateStore";
import { recordDetectionResolution } from "@/lib/server/matchingMetrics";
import { CatalogMatchingProvider } from "./catalogProvider";
import { getMatchingConfig } from "./config";
import { ExternalVisualSearchProvider } from "./externalProvider";
import { resolveDetectionMatch, type ResolveDetectionStage } from "./resolveDetection";
import type { DetectionMatchResult } from "./types";
import { normalizeMatchingMode } from "./types";
import type { MatchingMode, ProductMatchingResult } from "./types";

/**
 * PIPELINE DE RESOLUCIÓN DE UNA DETECCIÓN — catálogo primero, Internet aparte.
 *
 * Vivía dentro de `app/api/vision/match-object/route.ts`. Se ha extraído aquí
 * SIN cambios de comportamiento por un motivo concreto: el job de vídeo
 * preprocesado necesitaba resolver N productos y, al estar el pipeline dentro
 * de un route handler, la única forma de invocarlo era un `fetch` del servidor
 * a sí mismo. Ese self-fetch costaba una petición HTTP y una invocación de
 * función completas por producto, en serie, y su `AbortSignal.timeout` tiraba
 * el resultado del catálogo que YA estaba calculado. Ver
 * `docs/VIDEO_PIPELINE.md`.
 *
 * Ahora tanto el route como el motor de jobs llaman a `resolveDetectionRequest`
 * en proceso. El route pasa `req.nextUrl.origin`; el job, su propio origen.
 *
 * Lo único que necesitaba de `NextRequest` era el origen público, para poder
 * servir el crop desde `/api/crops/[hash]` cuando Storage no está disponible.
 */

/** Espera MÁXIMA por la 2ª pasada antes de lanzar Lens con la query inicial. */
const FAST_ENRICHMENT_WAIT_MS = Number(process.env.FAST_ENRICHMENT_WAIT_MS) || 2500;

/** Categorías que justifican la estrategia B (máxima precisión). */
const PREMIUM_CATEGORIES = [
  "reloj", "watch", "bolso", "bag", "zapat", "sneaker", "calzado", "shoe",
  "gafas", "glasses", "auricular", "headphone", "móvil", "phone", "portátil",
  "laptop", "cámara", "camera", "joyer", "jewel", "pulsera", "coche", "car",
];

function isPremiumItem(item: DetectedItem): boolean {
  const cat = `${item.category} ${item.subcategory ?? ""}`.toLowerCase();
  if (PREMIUM_CATEGORIES.some((k) => cat.includes(k))) return true;
  // Prendas con estampado distintivo o texto OCR también son premium: el
  // patrón/texto es el discriminador para encontrar el producto exacto.
  const distinctivePattern = Boolean(
    item.pattern && !/^(liso|plain|solid)$/i.test(item.pattern)
  );
  return Boolean(
    item.visible_brand ||
      (item.logo_visible && item.confidence >= 0.6) ||
      item.visible_text ||
      distinctivePattern ||
      (item.purchase_relevance ?? 0) >= 0.85
  );
}

/** Espera acotada: devuelve el resultado del promise o null si tarda más. */
function raceWithNull<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** Candidato similar ligero para la UI (siempre se devuelven los mejores). */
export type SimilarCandidate = {
  title: string;
  link: string;
  imageUrl: string | null;
  store: string | null;
  price: number | null;
  currency: string | null;
};

/**
 * Cuerpo que produce el pipeline EXTERNO. El route lo envuelve para responder;
 * el motor de jobs solo lee `match`, `providerUsed` y `timings`.
 */
export type OkBody = {
  ok: true;
  status:
    | "matched"
    | "similar_only"
    | "no_match"
    | "budget_exhausted"
    | "provider_error"
    | "storage_unavailable";
  cached: boolean;
  match: VisualMatch | null;
  /** Los MÁS SIMILARES visualmente, aunque no haya match fiable. */
  similarCandidates: SimilarCandidate[];
  providerUsed: string | null;
  fallbackUsed: boolean;
  calls: ProviderCallLog[];
  timings: Record<string, number>;
  budget: ReturnType<typeof budgetSnapshot>;
  detail?: string;
};

/** Top candidatos con imagen para la UI de "más similares". */
function toSimilarCandidates(ranked: { title: string; link: string; imageUrl: string | null; store: string | null; price: number | null; currency: string | null }[]): SimilarCandidate[] {
  return ranked
    .filter((c) => Boolean(c.imageUrl))
    .slice(0, 6)
    .map((c) => ({
      title: c.title,
      link: c.link,
      imageUrl: c.imageUrl,
      store: c.store,
      price: c.price,
      currency: c.currency,
    }));
}

async function persistRecommendations(
  itemId: string | undefined,
  match: VisualMatch | null
): Promise<void> {
  if (!itemId || !match) return;
  const recs: RecommendationInput[] = match.ranked_candidates
    .filter((c) => c.score > 0)
    .slice(0, 6)
    .map((c) => ({
      provider: c.source,
      title: c.title,
      productUrl: c.link,
      imageUrl: c.imageUrl,
      price: c.price,
      currency: c.currency ?? (c.price != null ? "EUR" : null),
      brand: c.brand,
      similarityScore: Math.min(c.score / 150, 1),
      matchType: c.matchType,
      reason: `${c.matchType} match (${Math.round(c.score)} pts, ${c.source})`,
    }));
  if (!recs.length) return;
  try {
    await getCatalogRepository().replaceRecommendations(itemId, recs);
  } catch {
    // Best-effort: la persistencia nunca rompe el matching.
  }
}

/**
 * Persiste las OFERTAS de shopping (DataForSEO) SEPARADAS de la identidad:
 * la identidad visual (candidatos Lens verificados) va primero e intacta;
 * las ofertas se añaden detrás como recomendaciones sin matchType ni score
 * de similitud — precio/tienda, no identidad. Una oferta nunca se convierte
 * en match exacto por sí sola.
 */
async function persistShoppingOffers(
  itemId: string | undefined,
  match: VisualMatch,
  offers: VisualCandidate[]
): Promise<void> {
  if (!itemId) return;
  const identityRecs: RecommendationInput[] = match.ranked_candidates
    .filter((c) => c.score > 0)
    .slice(0, 5)
    .map((c) => ({
      provider: c.source,
      title: c.title,
      productUrl: c.link,
      imageUrl: c.imageUrl,
      price: c.price,
      currency: c.currency ?? (c.price != null ? "EUR" : null),
      brand: c.brand,
      similarityScore: Math.min(c.score / 150, 1),
      matchType: c.matchType,
      reason: `${c.matchType} match (${Math.round(c.score)} pts, ${c.source})`,
    }));
  const offerRecs: RecommendationInput[] = offers.slice(0, 3).map((o) => ({
    provider: o.source,
    title: o.title,
    productUrl: o.link,
    imageUrl: o.imageUrl,
    price: o.price,
    currency: o.currency ?? "EUR",
    brand: o.brand,
    similarityScore: null,
    matchType: null,
    reason: "oferta shopping — solo precio/tienda, no identidad visual",
  }));
  try {
    await getCatalogRepository().replaceRecommendations(itemId, [
      ...identityRecs,
      ...offerRecs,
    ]);
  } catch {
    // Best-effort.
  }
}

/**
 * Persiste el crop REAL detectado como imagen del item del catálogo.
 * Preferencia: URL pública de Storage; si Storage no está disponible, se
 * guarda el data URL del crop (modo degradado: la imagen sigue visible en el
 * catálogo aunque no haya bucket). Nunca sustituye una URL http ya guardada
 * por un data URL. Best-effort: jamás rompe el matching.
 */
async function persistDetectedCrop(
  itemId: string | undefined,
  uploadedUrl: string | null,
  cropDataUrl: string,
  cropBytes: number
): Promise<void> {
  if (!itemId) return;
  const candidate =
    uploadedUrl ?? (cropBytes <= MAX_INLINE_CROP_BYTES ? cropDataUrl : null);
  if (!candidate) return;
  try {
    const repo = getCatalogRepository();
    const existing = await repo.getItem(itemId);
    if (!existing) return;
    if (isHttpUrl(existing.imageCropUrl) && !isHttpUrl(candidate)) return;
    await repo.updateItem(itemId, { imageCropUrl: candidate });
  } catch {
    // Best-effort.
  }
}

type ExternalPipelineArgs = {
  /** Origen público para publicar el crop si Storage no está disponible. */
  origin: string;
  crop: string;
  decoded: NonNullable<ReturnType<typeof decodeImageDataUrl>>;
  detected: DetectedItem;
  videoKey?: string;
  itemId?: string;
  skipCache?: boolean;
  t0: number;
};

/**
 * Lo que devuelve el pipeline externo: el cuerpo de respuesta y, aparte, los
 * candidatos rankeados. Los candidatos NO viajan en el cuerpo HTTP (son
 * pesados) pero sí hacen falta para construir el bloque de Internet cuando no
 * hay un match verificado — sin ellos ese bloque saldría vacío teniendo
 * resultados que enseñar como "producto similar".
 */
type ExternalPipelineRun = { body: OkBody; ranked: RankedCandidate[] };

/**
 * Pipeline EXTERNO existente (presupuesto + upload + reverse image +
 * verificación + shopping), extraído tal cual del handler para poder
 * invocarlo desde cualquier modo. Comportamiento sin cambios.
 */
async function runExternalPipeline(
  args: ExternalPipelineArgs
): Promise<ExternalPipelineRun> {
  const { origin, crop, decoded, detected, videoKey, itemId, skipCache, t0 } = args;
  const timings: Record<string, number> = {};
  const config = getVisualSearchConfig();

  // 1) Presupuesto: si está agotado, la detección sigue pero sin búsqueda externa.
  const budget = canSearch(videoKey ?? null);
  if (!budget.allowed) {
    return { ranked: [], body: {
      ok: true,
      status: "budget_exhausted",
      cached: false,
      match: null,
      similarCandidates: [],
      providerUsed: null,
      fallbackUsed: false,
      calls: [],
      timings: { totalMs: Date.now() - t0 },
      budget: budgetSnapshot(),
      detail: budget.reason ?? undefined,
    } };
  }

  // 2) Upload y 2ª pasada arrancan EN PARALELO, pero solo se espera al
  // upload: el enrichment NO bloquea el arranque de Lens. Tras el upload se
  // le concede una ventana corta (FAST_ENRICHMENT_WAIT_MS) — si no llega,
  // Lens sale con la query de la primera pasada y el enrichment termina en
  // background (memoizado por hash: un crop repetido no vuelve a pagar).
  const premium = isPremiumItem(detected);
  const enrich = shouldEnrichCrop(detected, premium);
  const enrichPromise: Promise<CropDetails | null> = enrich
    ? enrichCropDetailsCached(crop, decoded.hash, { itemId })
    : Promise.resolve(null);
  const tUpload = Date.now();
  let cropUrl = await uploadFramePublic(decoded, config, "crops");
  // Proveedor `local` del adaptador: la propia app sirve el crop (GET /api/crops/[hash])
  // si su origen es alcanzable desde Internet (deploy/PUBLIC_MEDIA_BASE_URL).
  // Así el reverse image search no depende de Storage externo.
  if (!cropUrl) {
    cropUrl = publishCropLocally(
      decoded.hash,
      decoded.buffer,
      decoded.mime,
      origin
    );
    if (cropUrl) {
      console.info("[visual-search] crop_published_locally", {
        cropHash: decoded.hash.slice(0, 12),
      });
    }
  }
  timings.uploadMs = Date.now() - tUpload;

  // Persistencia del crop detectado: URL pública si la subida funcionó, data
  // URL si Storage está caído (la tarjeta del catálogo muestra el crop igual).
  await persistDetectedCrop(
    itemId,
    cropUrl?.includes("/api/crops/") ? null : cropUrl,
    crop,
    decoded.buffer.byteLength
  );
  if (!cropUrl) {
    return { ranked: [], body: {
      ok: true,
      status: "storage_unavailable",
      cached: false,
      match: null,
      similarCandidates: [],
      providerUsed: null,
      fallbackUsed: false,
      calls: [],
      timings: { ...timings, totalMs: Date.now() - t0 },
      budget: budgetSnapshot(),
      detail:
        "No hay forma de publicar el crop para la búsqueda inversa (Storage caído y origen no público — en localhost los proveedores no pueden descargar la imagen).",
    } };
  }

  const tEnrich = Date.now();
  const cropDetails = await raceWithNull(enrichPromise, FAST_ENRICHMENT_WAIT_MS);
  timings.cropEnrichWaitMs = Date.now() - tEnrich;
  if (cropDetails) trackVisionCall(false);
  else if (enrich) {
    // El enrichment sigue en background: sus atributos se persisten al llegar
    // (best-effort) y quedan memoizados para el siguiente intento/crop igual.
    void enrichPromise.then(async (late) => {
      if (!late || !itemId) return;
      console.info("[crop-enrichment] enrichment_completed_late", {
        itemId,
        cropHash: decoded.hash.slice(0, 12),
        refinedQuery: late.refined_query,
      });
      try {
        await getCatalogRepository().updateItem(itemId, {
          ...(late.visible_brand ? { visibleBrand: late.visible_brand } : {}),
          ...(late.pattern ? { pattern: late.pattern } : {}),
          ...(late.product_subtype ? { subcategory: late.product_subtype } : {}),
        });
      } catch {
        // Best-effort.
      }
    });
  }
  const enriched = mergeCropDetails(detected, cropDetails);

  // 3) Query guiada con la evidencia visual (marca+OCR+color+categoría+rasgos),
  // afinada con la segunda pasada del crop si llegó a tiempo.
  const refined = cropDetails?.refined_query ?? null;
  const queries = buildSearchQueries(enriched, 2);
  const features = (enriched.distinctive_features ?? []).slice(0, 2).join(" ");
  const query =
    refined ??
    ([queries[0], features].filter(Boolean).join(" ").trim() || undefined);

  // 4) Cache VERSIONADA de candidatos crudos: incluye query, estrategia,
  // país/idioma y versiones de ranking/enrichment. Las entradas antiguas
  // (lenscrop:v1, solo hash) quedan huérfanas: no se reutilizan resultados
  // buscados con otra query.
  const cacheKey = lensCropCacheKey({
    cropHash: decoded.hash,
    query: query ?? null,
    strategy: "visual_first",
    country: process.env.REVERSE_SEARCH_COUNTRY ?? "ES",
    language: process.env.REVERSE_SEARCH_LANGUAGE ?? "es",
  });
  const cachedCandidates = skipCache ? null : await cacheGet(cacheKey);
  if (cachedCandidates) {
    trackCacheHit();
    const ranked = rankCandidates(cachedCandidates, enriched);
    // La verificación visual está memoizada por (crop, imagen candidata):
    // un cache hit de candidatos no paga verificaciones repetidas.
    const verifications = await verifyTopCandidates(crop, decoded.hash, ranked, { itemId });
    const match = buildVerifiedMatch(enriched, ranked, verifications);
    await persistRecommendations(itemId, match);
    timings.totalMs = Date.now() - t0;
    return { ranked, body: {
      ok: true,
      status: match ? (match.match_type === "similar" ? "similar_only" : "matched") : "no_match",
      cached: true,
      match,
      similarCandidates: toSimilarCandidates(ranked),
      providerUsed: "cache",
      fallbackUsed: false,
      calls: [],
      timings,
      budget: budgetSnapshot(),
    } };
  }

  // 5) Reverse image search real con fallback de proveedor.
  // Log estructurado ANTES de la llamada: demuestra qué query y qué crop
  // recibe realmente el proveedor (sin secretos ni data URLs).
  console.info("[visual-search] reverse_search_started", {
    itemId: itemId ?? null,
    cropHash: decoded.hash.slice(0, 12),
    query: query ?? null,
    refinedQueryUsed: Boolean(refined),
    premium,
    category: enriched.category,
  });
  const tSearch = Date.now();
  const result = await runReverseImageSearch({
    cropUrl,
    query,
    category: enriched.category,
    premium,
    country: process.env.REVERSE_SEARCH_COUNTRY ?? "ES",
    language: process.env.REVERSE_SEARCH_LANGUAGE ?? "es",
  });
  timings.lensMs = Date.now() - tSearch;
  console.info("[visual-search] reverse_search_completed", {
    itemId: itemId ?? null,
    cropHash: decoded.hash.slice(0, 12),
    providerUsed: result.providerUsed,
    fallbackUsed: result.fallbackUsed,
    resultCount: result.candidates.length,
    durationMs: timings.lensMs,
    calls: result.calls.map((c) => ({
      provider: c.provider,
      searchType: c.searchType,
      status: c.status,
      results: c.resultCount,
      ms: c.durationMs,
    })),
  });

  // Contabilidad de las llamadas reales efectuadas.
  for (const call of result.calls) {
    if (call.estimatedCostUsd > 0) {
      trackReverseSearch(call.provider, call.estimatedCostUsd, {
        fallback: result.fallbackUsed && call.provider !== "searchapi_google_lens",
      });
      recordSearch(videoKey ?? null, call.estimatedCostUsd * 0.92); // USD→EUR aprox
    }
  }

  const candidates: VisualCandidate[] = result.candidates;

  // 6) Cache + rank + VERIFICACIÓN VISUAL + persistencia. El primer resultado
  // se devuelve ya: DataForSEO nunca está en el camino crítico.
  if (candidates.length > 0) {
    await cacheSet(cacheKey, result.providerUsed ?? "mixed", candidates, config.cacheTtlDays);
  }
  // Etapa 1: ranking barato con la evidencia enriquecida (marca/OCR).
  const ranked = rankCandidates(candidates, enriched);
  // Etapa 2: comparación real crop ↔ imagen candidata (top N, memoizada).
  const tVerify = Date.now();
  const verifications = await verifyTopCandidates(crop, decoded.hash, ranked, { itemId });
  timings.verifyMs = Date.now() - tVerify;
  const match = buildVerifiedMatch(enriched, ranked, verifications);
  await persistRecommendations(itemId, match);

  // 7) DataForSEO SOLO ENRIQUECE (background): busca el producto canónico ya
  // identificado por Lens y añade precio/merchant/ofertas. Sus resultados son
  // ShoppingOffers — NUNCA compiten en la identidad visual ni re-rankean.
  if (config.dataForSeo && match) {
    const canonicalQuery = [match.brand, match.product_name]
      .filter(Boolean)
      .join(" ")
      .slice(0, 120);
    console.info("[visual-search] shopping_enrichment_started", {
      itemId: itemId ?? null,
      canonicalQuery,
    });
    void (async () => {
      const tShop = Date.now();
      try {
        const offers = await dataForSeoShopping(canonicalQuery, config);
        if (!offers.length) return;
        trackShoppingSearch(Number(process.env.DATAFORSEO_SERP_LIVE_COST_USD) || 0.002);
        recordSearch(videoKey ?? null, 0.002);
        await persistShoppingOffers(itemId, match, offers);
        console.info("[visual-search] shopping_enrichment_completed", {
          itemId: itemId ?? null,
          offers: offers.length,
          durationMs: Date.now() - tShop,
        });
      } catch (err) {
        console.warn("[visual-search] shopping_enrichment_failed", {
          itemId: itemId ?? null,
          durationMs: Date.now() - tShop,
          error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        });
      }
    })();
  }

  timings.totalMs = Date.now() - t0;

  let status: OkBody["status"];
  if (match) {
    status = match.match_type === "similar" ? "similar_only" : "matched";
  } else if (result.skippedReason || result.providerUsed === null) {
    status = "provider_error";
  } else {
    status = "no_match";
  }

  return { ranked, body: {
    ok: true,
    status,
    cached: false,
    match,
    similarCandidates: toSimilarCandidates(ranked),
    providerUsed: result.providerUsed,
    fallbackUsed: result.fallbackUsed,
    calls: result.calls,
    timings,
    budget: budgetSnapshot(),
    detail: result.skippedReason ?? undefined,
  } };
}

/**
 * Umbral de fiabilidad para GUARDAR un resultado externo como candidato.
 * Más laxo que el umbral de presentación: guardar un candidato a revisión es
 * barato y reversible; presentarlo como coincidencia, no.
 */
const INGEST_EXTERNAL_MIN_SCORE = 0.6;

/**
 * Ingesta de un resultado externo COMO CANDIDATO A REVISIÓN.
 *
 * La diferencia con el comportamiento anterior es deliberada: antes un
 * resultado externo fiable se escribía en el catálogo y desde ese momento era
 * indistinguible de un producto propio verificado. Ahora entra marcado y a la
 * espera de que una persona lo apruebe — un resultado de Internet no se
 * publica solo.
 *
 * Best-effort: nunca rompe el matching, devuelve un warning si falla.
 */
async function ingestExternalCandidate(
  externalResult: ProductMatchingResult | null,
  item: DetectedItem,
  config: ReturnType<typeof getMatchingConfig>,
  context: {
    analysisJobId?: string;
    mediaContentId?: string;
    detectedItemId?: string;
    globalProductId?: string;
    originCropUrl?: string;
  }
): Promise<string | null> {
  if (!config.catalogSaveExternalResults) return null;
  if (!externalResult || externalResult.matchLabel !== "EXTERNAL_MATCH") return null;
  const candidates = externalResult.matches.filter(
    (match) =>
      match.source === "external" &&
      match.scores.finalScore >= INGEST_EXTERNAL_MIN_SCORE &&
      Boolean(match.imageUrl) &&
      Boolean(match.productUrl)
  );
  if (!candidates.length) return null;

  const savable = new Set([
    "serpapi_google_lens",
    "searchapi_google_lens",
    "serpapi_google_shopping",
    "dataforseo_google_shopping",
  ]);
  try {
    const store = getExternalCandidateStore();
    let saved = 0;
    for (const candidate of candidates) {
      if (!savable.has(candidate.provider)) continue;
      const commercialSignals = [
        candidate.merchant,
        candidate.price != null,
        candidate.productUrl.startsWith("http"),
        candidate.imageUrl,
      ].filter(Boolean).length;
      await store.save({
        id: candidate.productId ?? candidate.productUrl,
        title: candidate.title,
        ...(candidate.scores.brandEvidenceScore != null && candidate.brand
          ? { brand: candidate.brand }
          : {}),
        imageUrl: candidate.imageUrl!,
        ...(candidate.merchant ? { merchant: candidate.merchant } : {}),
        ...(candidate.price != null ? { price: candidate.price } : {}),
        ...(candidate.currency ? { currency: candidate.currency } : {}),
        productUrl: candidate.productUrl,
        category: candidate.category ?? item.category,
        visualScore: candidate.scores.visualScore ?? candidate.scores.finalScore,
        commercialScore: commercialSignals / 4,
        finalScore: candidate.scores.finalScore,
        provider: candidate.provider,
        ...context,
        sourcePage: candidate.productUrl,
        originalImageUrl: candidate.imageUrl!,
        evidence: [
          ...candidate.evidence,
          "Candidato externo pendiente de revisión; no es producto de catálogo.",
        ],
        attributes: {
          color: item.color ?? null,
          style: item.style ?? null,
          category: item.category,
          visibleBrand: item.visible_brand ?? null,
        },
        rawResult: candidate as unknown as Record<string, unknown>,
      });
      saved++;
    }
    if (saved > 0 && context.detectedItemId) {
      await getCatalogRepository()
        .updateItem(context.detectedItemId, { status: "review_required" })
        .catch(() => null);
    }
    return null;
  } catch {
    return "No se pudo guardar el candidato externo.";
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada único: resolución de UNA detección
// ---------------------------------------------------------------------------

export type ResolveDetectionRequestArgs = {
  /** Crop del objeto como data URL. Obligatorio. */
  crop: string;
  item: DetectedItem;
  /** Origen público (para publicar el crop si Storage está caído). */
  origin: string;
  mode?: string | null;
  videoKey?: string;
  itemId?: string;
  skipCache?: boolean;
  detectionId?: string;
  timestampSeconds?: number | null;
  forceExternal?: boolean;
  analysisJobId?: string;
  mediaContentId?: string;
  globalProductId?: string;
  /**
   * Señal de cancelación. Se comprueba ANTES de gastar: un job cancelado no
   * debe pagar búsquedas externas. No aborta trabajo ya en vuelo — abortar a
   * mitad es justamente lo que hacía perder resultados ya calculados.
   */
  signal?: AbortSignal;
  /** Progreso en vivo, opcional — ver `ResolveDetectionStage`. */
  onStage?: (stage: ResolveDetectionStage) => void;
};

export type ResolveDetectionRequestResult = {
  detection: DetectionMatchResult;
  catalogResult: ProductMatchingResult | null;
  externalResult: ProductMatchingResult | null;
  /** Cuerpo del pipeline externo, si llegó a ejecutarse. */
  externalRan: OkBody | null;
  mode: MatchingMode;
  usageTimings: Record<string, number>;
  warnings: string[];
  totalMs: number;
};

/**
 * Resuelve una detección: catálogo primero y, solo si procede, Internet.
 *
 * Es el cuerpo que antes vivía en el handler POST. Lo llaman DOS sitios:
 *   - `app/api/vision/match-object/route.ts` (una detección, interactivo);
 *   - el motor de jobs (N productos únicos, en proceso y con concurrencia).
 *
 * No lanza por timeout: quien llama decide su propio presupuesto de tiempo y
 * el resultado parcial (p. ej. catálogo resuelto pero Internet sin terminar)
 * sigue siendo un resultado válido.
 */
export async function resolveDetectionRequest(
  args: ResolveDetectionRequestArgs
): Promise<ResolveDetectionRequestResult> {
  const t0 = Date.now();
  const { crop, item, origin, videoKey, itemId, skipCache } = args;

  const decoded = decodeImageDataUrl(crop);
  if (!decoded) throw new Error("crop_invalid");

  const matchingConfig = getMatchingConfig();
  const mode: MatchingMode =
    normalizeMatchingMode(args.mode ?? undefined) ?? matchingConfig.mode;

  const pipelineArgs: ExternalPipelineArgs = {
    origin, crop, decoded, detected: item, videoKey, itemId, skipCache, t0,
  };

  let externalRun: ExternalPipelineRun | null = null;
  const externalProvider = new ExternalVisualSearchProvider(async () => {
    // Cancelación: se comprueba justo antes de gastar, no a mitad.
    if (args.signal?.aborted) throw new Error("cancelled");
    externalRun = await runExternalPipeline(pipelineArgs);
    return {
      match: externalRun.body.match,
      providerUsed: externalRun.body.providerUsed,
      fallbackUsed: externalRun.body.fallbackUsed,
      cached: externalRun.body.cached,
      timings: externalRun.body.timings,
      rankedCandidates: externalRun.ranked,
    };
  }, matchingConfig.externalMatchMinScore);

  const resolved = await resolveDetectionMatch({
    item,
    detectionId: args.detectionId?.trim() || `${item.name}:${itemId ?? "0"}`,
    timestampSeconds:
      typeof args.timestampSeconds === "number" ? args.timestampSeconds : null,
    cropDataUrl: crop,
    mode,
    config: matchingConfig,
    catalog: new CatalogMatchingProvider({ config: matchingConfig }),
    external: externalProvider,
    forceExternal: args.forceExternal === true,
    skipCache,
    onStage: args.onStage,
  });

  const { detection, catalogResult, externalResult } = resolved;
  // Cast necesario: TS no ve la asignación hecha dentro del closure del provider.
  const externalRan = (externalRun as ExternalPipelineRun | null)?.body ?? null;

  if (!externalRan) {
    await persistDetectedCrop(itemId, null, crop, decoded.buffer.byteLength);
  }
  if (itemId && detection.catalog.status === "matched") {
    await getCatalogRepository()
      .updateItem(itemId, { status: "catalog_matched" })
      .catch(() => null);
  }

  const ingestWarning = await ingestExternalCandidate(
    externalResult,
    item,
    matchingConfig,
    {
      analysisJobId: args.analysisJobId,
      mediaContentId: args.mediaContentId,
      detectedItemId: itemId,
      globalProductId: args.globalProductId,
      originCropUrl: crop,
    }
  );

  recordDetectionResolution({
    detection,
    category: item.category,
    durationMs: Date.now() - t0,
    externalCalled: externalRan != null,
    externalFallback: detection.catalog.status !== "matched" && externalRan != null,
    externalManual: args.forceExternal === true,
    cacheHit: Boolean(catalogResult?.cached ?? externalResult?.cached),
    stages: {
      embeddingMs: catalogResult?.timings?.embeddingMs,
      vectorSearchMs: catalogResult?.timings?.vectorSearchMs,
      rankingMs: catalogResult?.timings?.rankingMs,
      candidateCount: catalogResult?.timings?.candidateCount,
    },
  });

  return {
    detection,
    catalogResult,
    externalResult,
    externalRan,
    mode,
    usageTimings: resolved.usage.timings,
    warnings: [
      ...(catalogResult?.warnings ?? []),
      ...(externalResult?.warnings ?? []),
      ...(ingestWarning ? [ingestWarning] : []),
    ],
    totalMs: Date.now() - t0,
  };
}
