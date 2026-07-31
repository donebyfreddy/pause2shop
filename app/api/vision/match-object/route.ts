import { NextRequest, NextResponse } from "next/server";
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
import type { VisualCandidate, VisualMatch } from "@/lib/visualSearch/types";
import type { DetectedItem } from "@/lib/types";
import { budgetSnapshot, canSearch, recordSearch } from "@/lib/server/searchBudget";
import { publishCropLocally } from "@/lib/server/cropStore";
import {
  trackCacheHit,
  trackReverseSearch,
  trackShoppingSearch,
  trackVisionCall,
} from "@/lib/server/costTracker";
import {
  catalogResultToVisualMatch,
  catalogSimilarCandidates,
} from "@/lib/matching/presentation";
import { getCatalogRepository } from "@/lib/catalog";
import { isHttpUrl, MAX_INLINE_CROP_BYTES } from "@/lib/catalog/images";
import type { RecommendationInput } from "@/lib/catalog/types";
import {
  externalOutcomeToResult,
  getMatchingConfig,
  getMatchingProvider,
  normalizeMatchingMode,
  type MatchingMode,
  type ProductMatchingResult,
} from "@/lib/matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vision/match-object — matching visual REAL por crop de objeto.
 *
 * El cliente detecta primero (analyze-frame pinta la UI) y después envía el
 * crop de cada objeto prioritario aquí. La ESTRATEGIA es intercambiable
 * (PRODUCT_MATCHING_MODE, con override `matchingMode` en el body):
 *
 *   external-only  → pipeline externo actual INTACTO (default sin env):
 *     1. hash del crop → cache (cero coste)
 *     2. publicar crop en Storage (Google Lens exige URL pública)
 *     3. ReverseImageOrchestrator (SearchAPI Lens → fallback SerpAPI)
 *     4. enriquecimiento shopping (DataForSEO) sin bloquear si falla
 *     5. re-rank contra la evidencia del objeto → exact / near_exact / similar
 *     6. persistencia best-effort de recomendaciones
 *   catalog-only   → solo el servicio de catálogo (lib/matching).
 *   catalog-first  → catálogo y, si no resuelve, el pipeline externo de arriba.
 *   hybrid         → ambos, ranking común sin mezclar procedencia.
 */

const MAX_CROP_BYTES = 4 * 1024 * 1024;

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

type MatchObjectBody = {
  crop?: string;
  item?: Partial<DetectedItem> & { name: string };
  videoKey?: string;
  itemId?: string;
  /** Debug: fuerza búsqueda fresca ignorando la caché de candidatos. */
  skipCache?: boolean;
  /** Override del modo de matching para esta petición (selector de la demo). */
  matchingMode?: string;
};

/** Candidato similar ligero para la UI (siempre se devuelven los mejores). */
export type SimilarCandidate = {
  title: string;
  link: string;
  imageUrl: string | null;
  store: string | null;
  price: number | null;
  currency: string | null;
};

export type MatchObjectResponse =
  | {
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
      /** Modo de matching efectivo de esta petición. */
      matchingMode?: MatchingMode;
      /** Resultado normalizado con procedencia (source) y scores separados. */
      matching?: ProductMatchingResult;
    }
  | { ok: false; error: string };

type OkBody = Extract<MatchObjectResponse, { ok: true }>;

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

function respond(body: MatchObjectResponse, status = 200) {
  return NextResponse.json(body, { status });
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
  req: NextRequest;
  crop: string;
  decoded: NonNullable<ReturnType<typeof decodeImageDataUrl>>;
  detected: DetectedItem;
  videoKey?: string;
  itemId?: string;
  skipCache?: boolean;
  t0: number;
};

/**
 * Pipeline EXTERNO existente (presupuesto + upload + reverse image +
 * verificación + shopping), extraído tal cual del handler para poder
 * invocarlo desde cualquier modo. Comportamiento sin cambios: solo devuelve
 * el cuerpo de la respuesta en vez de la respuesta HTTP.
 */
async function runExternalPipeline(args: ExternalPipelineArgs): Promise<OkBody> {
  const { req, crop, decoded, detected, videoKey, itemId, skipCache, t0 } = args;
  const timings: Record<string, number> = {};
  const config = getVisualSearchConfig();

  // 1) Presupuesto: si está agotado, la detección sigue pero sin búsqueda externa.
  const budget = canSearch(videoKey ?? null);
  if (!budget.allowed) {
    return {
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
    };
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
      req.nextUrl.origin
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
    return {
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
    };
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
    return {
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
    };
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

  return {
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
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();

  let body: MatchObjectBody;
  try {
    body = (await req.json()) as MatchObjectBody;
  } catch {
    return respond({ ok: false, error: "Cuerpo inválido." }, 400);
  }

  const { crop, item, videoKey, itemId, skipCache } = body;
  if (!crop?.startsWith("data:image/") || !item?.name) {
    return respond({ ok: false, error: "Faltan crop (data URL) o item." }, 400);
  }

  const decoded = decodeImageDataUrl(crop);
  if (!decoded || decoded.buffer.byteLength > MAX_CROP_BYTES) {
    return respond({ ok: false, error: "Crop inválido o demasiado grande." }, 400);
  }

  const detected = item as DetectedItem;

  // Modo efectivo: override por request (selector de la demo) → env → default
  // external-only. Un valor desconocido en el body se ignora en silencio.
  const matchingConfig = getMatchingConfig();
  const mode: MatchingMode =
    normalizeMatchingMode(body.matchingMode) ?? matchingConfig.mode;

  const pipelineArgs: ExternalPipelineArgs = {
    req, crop, decoded, detected, videoKey, itemId, skipCache, t0,
  };

  // external-only: el flujo actual intacto, más los metadatos normalizados.
  if (mode === "external_only") {
    const external = await runExternalPipeline(pipelineArgs);
    const matching = externalOutcomeToResult(
      {
        match: external.match,
        providerUsed: external.providerUsed,
        fallbackUsed: external.fallbackUsed,
        cached: external.cached,
        timings: external.timings,
      },
      detected
    );
    return respond({ ...external, matchingMode: mode, matching });
  }

  // Modos con catálogo: el orquestador decide; el pipeline externo entra como
  // DELEGADO (solo se ejecuta si la estrategia lo pide) y su cuerpo completo
  // se conserva para la respuesta (calls, budget, similares…).
  let externalBody: OkBody | null = null;
  const provider = getMatchingProvider(mode, {
    config: matchingConfig,
    externalSearch: async () => {
      externalBody = await runExternalPipeline(pipelineArgs);
      return {
        match: externalBody.match,
        providerUsed: externalBody.providerUsed,
        fallbackUsed: externalBody.fallbackUsed,
        cached: externalBody.cached,
        timings: externalBody.timings,
      };
    },
  });

  const matching = await provider.search({
    item: detected,
    cropDataUrl: crop,
    skipCache,
  });
  // Cast necesario: TS no ve la asignación hecha dentro del closure del
  // delegado y estrecha externalBody a null.
  const externalRan = externalBody as OkBody | null;

  // Si el catálogo resolvió sin pipeline externo, el crop detectado se
  // persiste igualmente (modo degradado: data URL) para la tarjeta del ítem.
  if (!externalRan) {
    await persistDetectedCrop(itemId, null, crop, decoded.buffer.byteLength);
  }

  const catalogVisual = catalogResultToVisualMatch(matching, detected);
  // Presentación: si el resultado final es del catálogo, el match visible es
  // el del catálogo; si vino del externo, el suyo (procedencia siempre en
  // `matching.matches[].source`).
  const match =
    matching.matchLabel === "CATALOG_MATCH"
      ? catalogVisual
      : externalRan?.match ?? catalogVisual;
  const similarCandidates = externalRan?.similarCandidates?.length
    ? externalRan.similarCandidates
    : catalogSimilarCandidates(matching);

  let status: OkBody["status"];
  if (matching.matchLabel === "CATALOG_MATCH" || matching.matchLabel === "EXTERNAL_MATCH") {
    status = "matched";
  } else if (matching.matchLabel === "SIMILAR") {
    status = "similar_only";
  } else if (
    externalRan &&
    (externalRan.status === "budget_exhausted" ||
      externalRan.status === "provider_error" ||
      externalRan.status === "storage_unavailable")
  ) {
    // Ambos caminos sin match: el estado del externo explica el porqué.
    status = externalRan.status;
  } else {
    status = "no_match";
  }

  return respond({
    ok: true,
    status,
    cached: matching.cached,
    match,
    similarCandidates,
    providerUsed: matching.providerUsed,
    fallbackUsed: matching.fallbackUsed,
    calls: externalRan?.calls ?? [],
    timings: { ...matching.timings, totalMs: Date.now() - t0 },
    budget: budgetSnapshot(),
    detail: matching.warnings?.join(" | ") || externalRan?.detail,
    matchingMode: mode,
    matching,
  });
}
