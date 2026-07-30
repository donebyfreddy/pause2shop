import { dedupeCandidates } from "../rank";
import {
  SearchApiGoogleLensProvider,
  SerpApiGoogleLensProvider,
} from "./providers";
import {
  evaluatePreliminaryResultQuality,
  type PreliminaryQuality,
} from "./resultQuality";
import type {
  NormalizedVisualResult,
  OrchestratorResult,
  ProviderCallLog,
  ReverseImageProvider,
  ReverseSearchMode,
} from "./types";

/**
 * ReverseImageOrchestrator: decide proveedor y estrategia, ejecuta con
 * cancelación por timeout, registra fallbacks y deduplica resultados.
 *
 * Estrategias ESCALONADAS (no siempre 3 llamadas):
 *  A (rápida): 1 llamada `all` con query → evaluar → `products` solo si faltan
 *    comprables → `visual_matches` solo si sigue débil.
 *  B (premium): exact_matches + products EN PARALELO → `visual_matches`
 *    únicamente si la evaluación preliminar sigue siendo débil.
 *
 * Fallback REAL: un proveedor "available" con cero resultados útiles NO
 * detiene la cadena — se evalúa la calidad preliminar
 * (evaluatePreliminaryResultQuality) y se pasa al siguiente proveedor,
 * conservando el mejor set visto por si todos son débiles.
 *
 * Circuit breaker: un proveedor que falla (401/429/timeout) queda fuera
 * durante BREAKER_MS y se pasa al siguiente registrando `fallbackUsed`.
 */

const BREAKER_MS = 60_000;
/** Tope de llamadas (modos) por item y proveedor. */
const MAX_SEARCHES_PER_ITEM = Number(process.env.MAX_REVERSE_SEARCHES_PER_ITEM) || 3;

type BreakerState = { until: number; reason: string };
const globalBreaker = globalThis as unknown as {
  __reverseBreaker?: Map<string, BreakerState>;
};
function breaker(): Map<string, BreakerState> {
  if (!globalBreaker.__reverseBreaker) globalBreaker.__reverseBreaker = new Map();
  return globalBreaker.__reverseBreaker;
}

function providerChain(): ReverseImageProvider[] {
  const searchapi = new SearchApiGoogleLensProvider();
  const serpapi = new SerpApiGoogleLensProvider();
  const primaryName =
    process.env.REVERSE_IMAGE_PRIMARY_PROVIDER === "serpapi_google_lens"
      ? "serpapi"
      : "google_lens"; // default → SearchAPI
  const chain =
    primaryName === "serpapi" ? [serpapi, searchapi] : [searchapi, serpapi];
  if (process.env.ENABLE_PROVIDER_FALLBACK === "false") return chain.slice(0, 1);
  return chain;
}

export type ReverseSearchRequest = {
  cropUrl: string;
  query?: string;
  category?: string;
  /** true → estrategia B (premium escalonada). */
  premium?: boolean;
  country?: string;
  language?: string;
};

/** Referencia corta del crop para logs: basename del fichero (hash), sin URL. */
function cropRefOf(cropUrl: string): string | null {
  const basename = cropUrl.split("/").pop() ?? "";
  const name = basename.split(".")[0];
  return /^[a-f0-9]{8,}$/i.test(name) ? name.slice(0, 12) : null;
}

async function callProvider(
  provider: ReverseImageProvider,
  req: ReverseSearchRequest,
  mode: ReverseSearchMode,
  /** Query de ESTA llamada: null = búsqueda puramente visual (solo el crop). */
  query: string | null,
  calls: ProviderCallLog[]
): Promise<NormalizedVisualResult[]> {
  const t0 = Date.now();
  const { results, health, queryUsed } = await provider.search({
    cropUrl: req.cropUrl,
    query: query ?? undefined,
    category: req.category,
    country: req.country ?? process.env.REVERSE_SEARCH_COUNTRY ?? "ES",
    language: req.language ?? process.env.REVERSE_SEARCH_LANGUAGE ?? "es",
    searchMode: mode,
  });
  calls.push({
    provider: provider.name,
    searchType: mode,
    queryUsed,
    cropRef: cropRefOf(req.cropUrl),
    durationMs: Date.now() - t0,
    resultCount: results.length,
    status: health.status,
    cached: false,
    estimatedCostUsd: health.status === "not_configured" ? 0 : provider.costPerSearchUsd(),
  });
  console.info("[visual-search] provider_response", {
    provider: provider.name,
    searchType: mode,
    queryUsed,
    status: health.status,
    resultCount: results.length,
    durationMs: Date.now() - t0,
  });
  if (
    health.status === "unauthorized" ||
    health.status === "quota_exhausted" ||
    health.status === "timeout"
  ) {
    breaker().set(provider.name, {
      until: Date.now() + BREAKER_MS,
      reason: health.status,
    });
  }
  return results;
}

/**
 * Estrategia VISUAL-FIRST para UN proveedor, con presupuesto de llamadas.
 *
 * PASO A — búsqueda PURAMENTE visual: exact_matches + visual_matches SIN
 * query. El único input discriminante es la URL pública del crop real — la
 * descripción textual de OpenAI no participa en la identidad.
 * PASO B — evaluación preliminar de los candidatos visuales.
 * PASO C — la query (refined/atributos) entra SOLO como fallback: `products`
 * con query si la señal visual es insuficiente. exact_matches nunca lleva q.
 */
async function runProviderStrategy(
  provider: ReverseImageProvider,
  req: ReverseSearchRequest,
  calls: ProviderCallLog[]
): Promise<NormalizedVisualResult[]> {
  let budget = MAX_SEARCHES_PER_ITEM;
  const run = async (
    mode: ReverseSearchMode,
    query: string | null
  ): Promise<NormalizedVisualResult[]> => {
    if (budget <= 0) return [];
    budget--;
    return callProvider(provider, req, mode, query, calls).catch(() => []);
  };

  let results: NormalizedVisualResult[];

  if (provider.name === "serpapi_google_lens") {
    // SerpAPI no separa search_type: una llamada devuelve todas las secciones.
    // PASO A: sin query (visual puro); fallback: repetir con query guiada.
    results = await run("all", null);
    const quality = evaluatePreliminaryResultQuality(results);
    if (quality.shouldFallback && req.query && budget > 0) {
      console.info("[visual-search] guided_fallback", {
        provider: provider.name,
        reason: quality.fallbackReason,
      });
      results = [...results, ...(await run("all", req.query))];
    }
    return results;
  }

  // PASO A — visual puro en paralelo, sin query.
  const [exact, visual] = await Promise.all([
    run("exact_matches", null),
    run("visual_matches", null),
  ]);
  results = [...exact, ...visual];

  // PASO B — evaluación. PASO C — query textual SOLO como fallback comercial.
  const quality = evaluatePreliminaryResultQuality(results);
  const needsCommercial = quality.commercialCount === 0 && quality.exactCount === 0;
  if ((quality.shouldFallback || needsCommercial) && req.query && budget > 0) {
    console.info("[visual-search] guided_fallback", {
      provider: provider.name,
      to: "products",
      reason: quality.fallbackReason ?? "no_commercial_results",
    });
    results = [...results, ...(await run("products", req.query))];
  }

  return results;
}

/**
 * Ejecuta la búsqueda inversa para un crop. Nunca lanza: los fallos se
 * reflejan en `calls` y se degrada al siguiente proveedor.
 */
export async function runReverseImageSearch(
  req: ReverseSearchRequest
): Promise<OrchestratorResult> {
  const calls: ProviderCallLog[] = [];
  const chain = providerChain();
  const configured = chain.filter((p) => p.isConfigured());

  if (configured.length === 0) {
    return {
      candidates: [],
      providerUsed: null,
      fallbackUsed: false,
      cached: false,
      calls,
      skippedReason:
        "Ningún proveedor de reverse image search configurado (SEARCHAPI_API_KEY / SERPAPI_API_KEY)",
    };
  }

  let fallbackUsed = false;
  // Mejor set visto hasta ahora: si TODOS los proveedores devuelven señal
  // débil, se devuelve el menos malo en vez de nada.
  let bestSoFar: {
    results: NormalizedVisualResult[];
    provider: string;
    quality: PreliminaryQuality;
    viaFallback: boolean;
  } | null = null;

  for (let i = 0; i < configured.length; i++) {
    const provider = configured[i];
    const broken = breaker().get(provider.name);
    if (broken && broken.until > Date.now()) {
      calls.push({
        provider: provider.name,
        searchType: "all",
        queryUsed: null,
        cropRef: cropRefOf(req.cropUrl),
        durationMs: 0,
        resultCount: 0,
        status: broken.reason as ProviderCallLog["status"],
        cached: false,
        estimatedCostUsd: 0,
      });
      fallbackUsed = i + 1 < configured.length;
      continue;
    }

    const results = await runProviderStrategy(provider, req, calls);
    const quality = evaluatePreliminaryResultQuality(results);

    if (!quality.shouldFallback) {
      // Señal suficiente: aceptar este proveedor.
      return {
        candidates: dedupeCandidates(results) as NormalizedVisualResult[],
        providerUsed: provider.name,
        fallbackUsed: fallbackUsed || i > 0,
        cached: false,
        calls,
        skippedReason: null,
      };
    }

    // available + cero/débil ≠ éxito: conservar lo mejor y probar el siguiente.
    if (
      results.length > 0 &&
      (!bestSoFar || quality.qualityScore > bestSoFar.quality.qualityScore)
    ) {
      bestSoFar = { results, provider: provider.name, quality, viaFallback: i > 0 };
    }
    console.info("[visual-search] fallback_triggered", {
      from: provider.name,
      reason: quality.fallbackReason,
      usefulCount: quality.usefulCount,
      nextProvider: configured[i + 1]?.name ?? null,
    });
    fallbackUsed = true;
  }

  if (bestSoFar) {
    return {
      candidates: dedupeCandidates(bestSoFar.results) as NormalizedVisualResult[],
      providerUsed: bestSoFar.provider,
      fallbackUsed: true,
      cached: false,
      calls,
      skippedReason: null,
    };
  }

  return {
    candidates: [],
    providerUsed: null,
    fallbackUsed,
    cached: false,
    calls,
    skippedReason: "Todos los proveedores fallaron o devolvieron resultados sin señal útil",
  };
}
