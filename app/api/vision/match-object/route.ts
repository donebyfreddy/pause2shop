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
import {
  catalogResultToVisualMatch,
  catalogSimilarCandidates,
} from "@/lib/matching/presentation";
import { getCatalogRepository } from "@/lib/catalog";
import { isHttpUrl, MAX_INLINE_CROP_BYTES } from "@/lib/catalog/images";
import type { RecommendationInput } from "@/lib/catalog/types";
import {
  CatalogMatchingProvider,
  ExternalVisualSearchProvider,
  getMatchingConfig,
  normalizeMatchingMode,
  resolveDetectionMatch,
  type DetectionMatchResult,
  type MatchingMode,
  type ProductMatchingResult,
} from "@/lib/matching";
import { recordDetectionResolution } from "@/lib/server/matchingMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vision/match-object — matching visual REAL por crop de objeto.
 *
 * El cliente detecta primero (analyze-frame pinta la UI) y después envía el
 * crop de cada objeto prioritario aquí.
 *
 * EL CATÁLOGO PROPIO ES LA FUENTE PRINCIPAL. El flujo es:
 *
 *   crop → embedding/hash → búsqueda en el catálogo → ranking → umbral
 *        → (solo si procede) pipeline externo → bloques SEPARADOS
 *
 * La decisión de gastar una llamada externa la toma `shouldCallExternal`
 * (lib/matching/resolveDetection.ts), según el modo:
 *
 *   catalog_only          → nunca sale fuera.
 *   catalog_first         → externo SOLO si el catálogo no alcanzó el umbral y
 *                           el fallback automático está activo, o si el usuario
 *                           pulsa "Buscar también en Internet" (forceExternal).
 *   catalog_and_external  → ambas fuentes por diseño.
 *   external_only         → solo el pipeline externo, sin catálogo.
 *
 * El pipeline externo (presupuesto → publicar crop → SearchAPI/SerpAPI Lens →
 * verificación visual → enriquecimiento DataForSEO) NO ha cambiado; lo que
 * cambia es cuándo se ejecuta y que su resultado ya no sobreescribe al del
 * catálogo: ambos vuelven en `detection.catalog` y `detection.external`.
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
  /**
   * Identidad estable de la detección. La fija el cliente (fingerprint) para
   * que la tarjeta y el bounding box hablen del mismo objeto entre frames.
   */
  detectionId?: string;
  /** Segundo del vídeo en que se capturó el frame (null en imagen). */
  timestampSeconds?: number | null;
  /**
   * El usuario pulsó "Buscar también en Internet". Es la ÚNICA forma de gastar
   * una llamada externa cuando el catálogo ya había resuelto.
   */
  forceExternal?: boolean;
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
      /**
       * CONTRATO PRINCIPAL para la UI: catálogo e Internet en bloques
       * separados, cada uno con su estado, su umbral y sus candidatos.
       *
       * Los campos `match` / `similarCandidates` de arriba son la forma
       * anterior (un único resultado sin procedencia explícita) y se conservan
       * para los consumidores que aún no leen `detection`.
       */
      detection?: DetectionMatchResult;
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
  const { req, crop, decoded, detected, videoKey, itemId, skipCache, t0 } = args;
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
  config: ReturnType<typeof getMatchingConfig>
): Promise<string | null> {
  if (!config.catalogSaveExternalResults) return null;
  if (!externalResult || externalResult.matchLabel !== "EXTERNAL_MATCH") return null;
  const best = externalResult.matches.find((m) => m.source === "external");
  if (!best || best.scores.finalScore < INGEST_EXTERNAL_MIN_SCORE) return null;

  const savable = new Set([
    "serpapi_google_lens",
    "searchapi_google_lens",
    "serpapi_google_shopping",
    "dataforseo_google_shopping",
  ]);
  if (!savable.has(best.provider)) return null;

  try {
    const { getCatalogClient } = await import("@/lib/matching/catalogClient");
    const res = await getCatalogClient().saveExternalProduct({
      provider: best.provider as
        | "serpapi_google_lens"
        | "searchapi_google_lens"
        | "serpapi_google_shopping"
        | "dataforseo_google_shopping",
      title: best.title,
      // La marca solo viaja con evidencia: un título que la contiene no basta.
      brand: best.scores.brandEvidenceScore != null ? best.brand : null,
      price: best.price,
      currency: best.currency,
      productUrl: best.productUrl,
      imageUrl: best.imageUrl,
      merchant: best.merchant,
      category: item.category ?? null,
      color: item.color ?? null,
      score: best.scores.finalScore,
      evidence: [
        ...best.evidence,
        "· Candidato externo pendiente de revisión (no publicado)",
      ],
    });
    return res.ok
      ? null
      : `No se pudo guardar el candidato externo (${res.error.code}).`;
  } catch {
    return "No se pudo guardar el candidato externo.";
  }
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

  // Modo efectivo: override por request (selector de la UI) → env → default
  // catalog_first. Un valor desconocido en el body se ignora en silencio.
  const matchingConfig = getMatchingConfig();
  const mode: MatchingMode =
    normalizeMatchingMode(body.matchingMode) ?? matchingConfig.mode;

  const pipelineArgs: ExternalPipelineArgs = {
    req, crop, decoded, detected, videoKey, itemId, skipCache, t0,
  };

  // El pipeline externo se envuelve como provider, pero NO se ejecuta al
  // construirlo: solo si `resolveDetectionMatch` decide que hace falta. Ese
  // closure es la única vía de gasto externo en este handler.
  let externalRun: ExternalPipelineRun | null = null;
  const externalProvider = new ExternalVisualSearchProvider(async () => {
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
    item: detected,
    detectionId: body.detectionId?.trim() || `${detected.name}:${itemId ?? "0"}`,
    timestampSeconds:
      typeof body.timestampSeconds === "number" ? body.timestampSeconds : null,
    cropDataUrl: crop,
    mode,
    config: matchingConfig,
    catalog: new CatalogMatchingProvider({ config: matchingConfig }),
    external: externalProvider,
    forceExternal: body.forceExternal === true,
    skipCache,
  });

  const { detection, catalogResult, externalResult } = resolved;
  // Cast necesario: TS no ve la asignación hecha dentro del closure del provider.
  const externalRan = (externalRun as ExternalPipelineRun | null)?.body ?? null;

  // Si el catálogo resolvió sin pipeline externo, el crop detectado se
  // persiste igualmente (modo degradado: data URL) para la tarjeta del ítem.
  if (!externalRan) {
    await persistDetectedCrop(itemId, null, crop, decoded.buffer.byteLength);
  }

  // Un resultado externo fiable se INGIERE COMO CANDIDATO a revisión, no como
  // producto validado del catálogo. Ver `ingestExternalCandidate`.
  const ingestWarning = await ingestExternalCandidate(
    externalResult,
    detected,
    matchingConfig
  );

  recordDetectionResolution({
    detection,
    category: detected.category,
    durationMs: Date.now() - t0,
    externalCalled: externalRan != null,
    externalFallback: detection.catalog.status !== "matched" && externalRan != null,
    externalManual: body.forceExternal === true,
    cacheHit: Boolean(catalogResult?.cached ?? externalResult?.cached),
    stages: {
      embeddingMs: catalogResult?.timings?.embeddingMs,
      vectorSearchMs: catalogResult?.timings?.vectorSearchMs,
      rankingMs: catalogResult?.timings?.rankingMs,
      candidateCount: catalogResult?.timings?.candidateCount,
    },
  });

  /* ---------------- forma anterior de la respuesta (compat) ---------------- */
  // `match` / `similarCandidates` siguen existiendo para los consumidores que
  // aún no leen `detection`. Se derivan de los bloques YA separados, así que no
  // pueden contradecirlos: el del catálogo gana cuando el catálogo resolvió.
  const catalogVisual = catalogResult
    ? catalogResultToVisualMatch(catalogResult, detected)
    : null;
  const match =
    detection.catalog.status === "matched"
      ? catalogVisual
      : externalRan?.match ?? catalogVisual;
  const similarCandidates = externalRan?.similarCandidates?.length
    ? externalRan.similarCandidates
    : catalogResult
      ? catalogSimilarCandidates(catalogResult)
      : [];

  const status = legacyStatus(detection, externalRan);
  const warnings = [
    ...(catalogResult?.warnings ?? []),
    ...(externalResult?.warnings ?? []),
    ...(ingestWarning ? [ingestWarning] : []),
  ];

  return respond({
    ok: true,
    status,
    cached: Boolean(catalogResult?.cached ?? externalResult?.cached),
    match,
    similarCandidates,
    providerUsed:
      detection.catalog.status === "matched"
        ? "catalog"
        : externalResult?.providerUsed ?? catalogResult?.providerUsed ?? null,
    fallbackUsed: Boolean(externalResult?.fallbackUsed),
    calls: externalRan?.calls ?? [],
    timings: { ...resolved.usage.timings, totalMs: Date.now() - t0 },
    budget: budgetSnapshot(),
    detail: warnings.join(" | ") || externalRan?.detail,
    matchingMode: mode,
    matching: catalogOrExternalResult(catalogResult, externalResult, detection),
    detection,
  });
}

/**
 * Estado plano equivalente al de antes, derivado de los dos bloques.
 * `matched` exige un match fiable en ALGUNA fuente; los estados de error del
 * pipeline externo (presupuesto, storage) se conservan porque explican el
 * porqué mejor que un "no_match" genérico.
 */
function legacyStatus(
  detection: DetectionMatchResult,
  externalRan: OkBody | null
): OkBody["status"] {
  if (
    detection.catalog.status === "matched" ||
    detection.external.status === "matched"
  ) {
    return "matched";
  }
  if (
    detection.catalog.candidates.length > 0 ||
    detection.external.candidates.length > 0
  ) {
    return "similar_only";
  }
  if (
    externalRan &&
    (externalRan.status === "budget_exhausted" ||
      externalRan.status === "provider_error" ||
      externalRan.status === "storage_unavailable")
  ) {
    return externalRan.status;
  }
  return "no_match";
}

/**
 * `matching` legado: el resultado de la fuente que RESOLVIÓ. Si ninguna
 * resolvió, el del catálogo (es la fuente principal y sus candidatos son los
 * que la UI antigua debe preferir).
 */
function catalogOrExternalResult(
  catalogResult: ProductMatchingResult | null,
  externalResult: ProductMatchingResult | null,
  detection: DetectionMatchResult
): ProductMatchingResult | undefined {
  const chosen =
    detection.catalog.status === "matched"
      ? catalogResult
      : detection.external.status === "matched"
        ? externalResult
        : catalogResult ?? externalResult;
  if (!chosen) return undefined;
  return {
    ...chosen,
    matchingMode: detection.matchingMode,
    catalogAttempted: catalogResult != null,
    externalAttempted: externalResult != null,
    externalFallbackUsed:
      externalResult != null && detection.catalog.status !== "matched",
  };
}
