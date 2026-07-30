import { domainOf } from "../providers";
import type {
  NormalizedVisualResult,
  ProviderHealth,
  ProviderSearchResult,
  ReverseImageProvider,
  ReverseImageSearchInput,
  ReverseSearchMode,
} from "./types";

/**
 * Providers de Google Lens — implementación ÚNICA (las funciones legacy de
 * lib/visualSearch/providers.ts delegan aquí). SearchAPI.io es el principal;
 * SerpAPI es el fallback con el mismo modelo de salida. Ambos exigen URL
 * pública de la imagen.
 *
 * Matriz de capacidades: cada proveedor declara en qué search modes admite
 * query `q`. NUNCA se envían parámetros no soportados, y `queryUsed` refleja
 * exclusivamente lo que se envió de verdad.
 */

const PROVIDER_TIMEOUT_MS = Number(process.env.VIDEO_MATCHING_TIMEOUT_MS) || 15_000;

/** SearchAPI google_lens: `q` documentada para estos search_type. */
const SEARCHAPI_Q_SUPPORTED_MODES: ReadonlySet<ReverseSearchMode> = new Set([
  "all",
  "products",
  "visual_matches",
]);

type RawJson = Record<string, unknown>;

async function fetchWithHealth(
  url: string
): Promise<{ json: RawJson | null; health: ProviderHealth }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      return { json: null, health: { status: "unauthorized", detail: `HTTP ${res.status}` } };
    }
    if (res.status === 429 || res.status === 402) {
      return { json: null, health: { status: "quota_exhausted", detail: `HTTP ${res.status}` } };
    }
    if (!res.ok) {
      return { json: null, health: { status: "error", detail: `HTTP ${res.status}` } };
    }
    return { json: (await res.json()) as RawJson, health: { status: "available" } };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      json: null,
      health: aborted
        ? { status: "timeout", detail: `> ${PROVIDER_TIMEOUT_MS}ms` }
        : { status: "error", detail: err instanceof Error ? err.message : "fetch failed" },
    };
  } finally {
    clearTimeout(timer);
  }
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseRawPrice(v: unknown): { price: number | null; currency: string | null } {
  if (typeof v === "number" && Number.isFinite(v)) return { price: v, currency: null };
  if (v && typeof v === "object") {
    const o = v as RawJson;
    const price =
      typeof o.extracted_value === "number"
        ? o.extracted_value
        : typeof o.value === "number"
          ? o.value
          : null;
    return { price, currency: asStr(o.currency) };
  }
  if (typeof v === "string") {
    const m = /([\d.,]+)/.exec(v);
    const n = m ? Number(m[1].replace(/\.(?=\d{3})/g, "").replace(",", ".")) : NaN;
    let currency: string | null = null;
    if (v.includes("€")) currency = "EUR";
    else if (v.includes("$")) currency = "USD";
    return { price: Number.isFinite(n) ? n : null, currency };
  }
  return { price: null, currency: null };
}

/**
 * URL de imagen del candidato, tolerando los schemas reales: `thumbnail`
 * string, `image` string, `image` OBJETO ({link|url|src, width, height}) o
 * `image_url`. Antes `r.image` objeto se descartaba y el candidato quedaba
 * sin imagen (imposible de verificar visualmente).
 */
export function parseImageUrl(raw: RawJson): string | null {
  const thumbnail = asStr(raw.thumbnail);
  if (thumbnail) return thumbnail;
  if (typeof raw.image === "string") return asStr(raw.image);
  if (raw.image && typeof raw.image === "object") {
    const image = raw.image as RawJson;
    return asStr(image.link) ?? asStr(image.url) ?? asStr(image.src) ?? null;
  }
  return asStr(raw.image_url);
}

/**
 * Normaliza una sección de resultados tolerando los alias de schema reales de
 * SearchAPI/SerpAPI (link|url|product_link|source_url, thumbnail|image|
 * image_url, source|merchant|seller, price|extracted_price…). No inventa
 * valores: si tras los alias faltan title o link, el resultado se descarta y
 * se contabiliza el motivo. Conserva el MODO de la petición (requestMode)
 * además de la sección de la respuesta.
 */
export function normalizeSection(
  raws: unknown,
  source: NormalizedVisualResult["source"],
  responseSection: NormalizedVisualResult["responseSection"],
  queryUsed: string | null,
  requestMode: NormalizedVisualResult["requestMode"] = "all",
  metrics?: { received: number; discardedNoTitle: number; discardedNoLink: number }
): NormalizedVisualResult[] {
  if (!Array.isArray(raws)) return [];
  const out: NormalizedVisualResult[] = [];
  raws.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as RawJson;
    if (metrics) metrics.received++;
    const title = asStr(r.title) ?? asStr(r.name);
    const link =
      asStr(r.link) ?? asStr(r.url) ?? asStr(r.product_link) ?? asStr(r.source_url);
    if (!title) {
      if (metrics) metrics.discardedNoTitle++;
      return;
    }
    if (!link) {
      if (metrics) metrics.discardedNoLink++;
      return;
    }
    const { price, currency } = parseRawPrice(r.extracted_price ?? r.price);
    const merchant = r.merchant as RawJson | undefined;
    out.push({
      source,
      sourceType: responseSection,
      responseSection,
      requestMode,
      title,
      link,
      store:
        asStr(r.source) ??
        asStr(typeof r.merchant === "string" ? r.merchant : merchant?.name) ??
        asStr(r.seller) ??
        domainOf(link),
      domain: domainOf(link),
      imageUrl: parseImageUrl(r),
      price,
      currency: currency ?? asStr(r.currency),
      brand: asStr(r.brand),
      position: typeof r.position === "number" ? r.position : idx + 1,
      exactImageMatch: responseSection === "exact_matches",
      queryUsed,
    });
  });
  return out;
}

/** Extrae todas las secciones útiles de una respuesta Google Lens. */
export function normalizeLensResponse(
  json: RawJson,
  source: NormalizedVisualResult["source"],
  queryUsed: string | null,
  requestMode: NormalizedVisualResult["requestMode"] = "all"
): NormalizedVisualResult[] {
  const metrics = { received: 0, discardedNoTitle: 0, discardedNoLink: 0 };
  const results = [
    ...normalizeSection(json.exact_matches, source, "exact_matches", queryUsed, requestMode, metrics),
    ...normalizeSection(json.products, source, "products", queryUsed, requestMode, metrics),
    ...normalizeSection(json.visual_matches, source, "visual_matches", queryUsed, requestMode, metrics),
    ...normalizeSection(json.shopping_results, source, "shopping", queryUsed, requestMode, metrics),
  ];
  const discarded = metrics.discardedNoTitle + metrics.discardedNoLink;
  if (discarded > 0) {
    console.info("[visual-search] provider_results_normalized", {
      provider: source,
      received: metrics.received,
      normalized: results.length,
      discarded,
      discardReasons: {
        noTitle: metrics.discardedNoTitle,
        noLink: metrics.discardedNoLink,
      },
    });
  }
  return results;
}

export class SearchApiGoogleLensProvider implements ReverseImageProvider {
  readonly name = "searchapi_google_lens";

  isConfigured(): boolean {
    return Boolean(process.env.SEARCHAPI_API_KEY?.trim());
  }

  costPerSearchUsd(): number {
    return Number(process.env.SEARCHAPI_COST_PER_SEARCH_USD) || 0.01;
  }

  async search(input: ReverseImageSearchInput): Promise<ProviderSearchResult> {
    const key = process.env.SEARCHAPI_API_KEY?.trim();
    if (!key) return { results: [], health: { status: "not_configured" }, queryUsed: null };
    const params = new URLSearchParams({
      engine: "google_lens",
      search_type: input.searchMode,
      url: input.cropUrl,
      hl: input.language,
      country: input.country.toLowerCase(),
      api_key: key,
    });
    // Matriz de capacidades: q solo en los modos que la soportan. La query
    // registrada es EXACTAMENTE la enviada (null si no se envió).
    const sendQuery = Boolean(
      input.query && SEARCHAPI_Q_SUPPORTED_MODES.has(input.searchMode)
    );
    if (sendQuery) params.set("q", input.query!);
    const queryUsed = sendQuery ? input.query! : null;

    const { json, health } = await fetchWithHealth(
      `https://www.searchapi.io/api/v1/search?${params}`
    );
    if (!json) return { results: [], health, queryUsed };
    return {
      results: normalizeLensResponse(
        json,
        "searchapi_google_lens",
        queryUsed,
        input.searchMode
      ),
      health,
      queryUsed,
    };
  }
}

export class SerpApiGoogleLensProvider implements ReverseImageProvider {
  readonly name = "serpapi_google_lens";

  isConfigured(): boolean {
    return Boolean((process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY)?.trim());
  }

  costPerSearchUsd(): number {
    return Number(process.env.SERPAPI_COST_PER_SEARCH_USD) || 0.01;
  }

  async search(input: ReverseImageSearchInput): Promise<ProviderSearchResult> {
    const key = (process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY)?.trim();
    if (!key) return { results: [], health: { status: "not_configured" }, queryUsed: null };
    const params = new URLSearchParams({
      engine: "google_lens",
      url: input.cropUrl,
      hl: input.language,
      country: input.country.toLowerCase(),
      api_key: key,
    });
    // SerpAPI no soporta search_type: una sola llamada con q y se filtra
    // tras normalizar. q sí está soportada en la llamada única.
    const queryUsed = input.query ?? null;
    if (queryUsed) params.set("q", queryUsed);
    const { json, health } = await fetchWithHealth(
      `https://serpapi.com/search.json?${params}`
    );
    if (!json) return { results: [], health, queryUsed };
    let results = normalizeLensResponse(
      json,
      "serpapi_google_lens",
      queryUsed,
      input.searchMode
    );
    if (input.searchMode !== "all") {
      results = results.filter((r) => r.responseSection === input.searchMode);
    }
    return { results, health, queryUsed };
  }
}
