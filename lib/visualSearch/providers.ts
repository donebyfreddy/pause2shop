import type { VisualSearchConfig } from "./config";
import type { VisualCandidate, VisualCandidateSource } from "./types";

/**
 * Clientes de los motores de búsqueda visual/shopping. Todos vía fetch (sin
 * SDKs), todos normalizan a VisualCandidate y todos fallan en silencio
 * devolviendo [] (el engine decide fallbacks y registra warnings).
 *
 * Prioridad de reverse image search:
 *   1. SearchAPI.io Google Lens (SEARCHAPI_API_KEY)
 *   2. SerpAPI Google Lens (SERPAPI_API_KEY)
 * Shopping por texto:
 *   1. SerpAPI Google Shopping
 *   2. DataForSEO Google Shopping (live)
 */

const FETCH_TIMEOUT_MS = 12_000;

async function fetchJson(
  url: string,
  init: RequestInit = {}
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      console.warn(
        `[visualSearch] ${new URL(url).hostname} respondió ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`
      );
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.warn(`[visualSearch] fetch a ${new URL(url).hostname} falló:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function domainOf(link: string): string | null {
  try {
    return new URL(link).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function parsePrice(v: unknown): { price: number | null; currency: string | null } {
  if (typeof v === "number" && Number.isFinite(v)) return { price: v, currency: null };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const price =
      typeof o.extracted_value === "number"
        ? o.extracted_value
        : typeof o.value === "number"
          ? o.value
          : null;
    const currency = typeof o.currency === "string" ? o.currency : null;
    return { price, currency };
  }
  if (typeof v === "string") {
    const m = /([\d.,]+)/.exec(v);
    const price = m ? Number(m[1].replace(/\.(?=\d{3})/g, "").replace(",", ".")) : null;
    const currency = v.includes("€") ? "EUR" : v.includes("$") ? "USD" : null;
    return { price: Number.isFinite(price) ? price : null, currency };
  }
  return { price: null, currency: null };
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

type RawMatch = Record<string, unknown>;

function normalizeLensMatch(
  raw: RawMatch,
  source: VisualCandidateSource,
  idx: number,
  exact: boolean
): VisualCandidate | null {
  const title = asStr(raw.title);
  const link = asStr(raw.link) ?? asStr(raw.url);
  if (!title || !link) return null;
  const { price, currency } = parsePrice(raw.price);
  return {
    source,
    title,
    link,
    store: asStr(raw.source) ?? asStr(raw.merchant) ?? domainOf(link),
    domain: domainOf(link),
    imageUrl: asStr(raw.thumbnail) ?? asStr(raw.image) ?? null,
    price,
    currency: currency ?? asStr(raw.currency),
    brand: asStr(raw.brand),
    position: typeof raw.position === "number" ? raw.position : idx + 1,
    exactImageMatch: exact,
    queryUsed: null,
  };
}

/** SearchAPI.io — engine=google_lens (reverse image search real). */
export async function searchApiLens(
  imageUrl: string,
  config: VisualSearchConfig
): Promise<VisualCandidate[]> {
  if (!config.searchApiKey) return [];
  const params = new URLSearchParams({
    engine: "google_lens",
    search_type: "all",
    url: imageUrl,
    hl: config.language,
    country: config.country,
    api_key: config.searchApiKey,
  });
  const json = await fetchJson(`https://www.searchapi.io/api/v1/search?${params}`);
  if (!json) return [];
  const exact = Array.isArray(json.exact_matches) ? (json.exact_matches as RawMatch[]) : [];
  const visual = Array.isArray(json.visual_matches) ? (json.visual_matches as RawMatch[]) : [];
  return [
    ...exact.map((m, i) => normalizeLensMatch(m, "searchapi_google_lens", i, true)),
    ...visual.map((m, i) => normalizeLensMatch(m, "searchapi_google_lens", i, false)),
  ].filter((c): c is VisualCandidate => c !== null);
}

/** SerpAPI — engine=google_lens (reverse image search real). */
export async function serpApiLens(
  imageUrl: string,
  config: VisualSearchConfig
): Promise<VisualCandidate[]> {
  if (!config.serpApiKey) return [];
  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    hl: config.language,
    country: config.country,
    api_key: config.serpApiKey,
  });
  const json = await fetchJson(`https://serpapi.com/search.json?${params}`);
  if (!json) return [];
  const exact = Array.isArray(json.exact_matches) ? (json.exact_matches as RawMatch[]) : [];
  const visual = Array.isArray(json.visual_matches) ? (json.visual_matches as RawMatch[]) : [];
  return [
    ...exact.map((m, i) => normalizeLensMatch(m, "serpapi_google_lens", i, true)),
    ...visual.map((m, i) => normalizeLensMatch(m, "serpapi_google_lens", i, false)),
  ].filter((c): c is VisualCandidate => c !== null);
}

/** SerpAPI — engine=google_shopping (búsqueda por texto con productos reales). */
export async function serpApiShopping(
  query: string,
  config: VisualSearchConfig
): Promise<VisualCandidate[]> {
  if (!config.serpApiKey) return [];
  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    hl: config.language,
    gl: config.country,
    location: "Spain",
    api_key: config.serpApiKey,
  });
  const json = await fetchJson(`https://serpapi.com/search.json?${params}`);
  if (!json) return [];
  const results = Array.isArray(json.shopping_results)
    ? (json.shopping_results as RawMatch[])
    : [];
  return results
    .map((raw, idx): VisualCandidate | null => {
      const title = asStr(raw.title);
      const link = asStr(raw.product_link) ?? asStr(raw.link);
      if (!title || !link) return null;
      const { price, currency } = parsePrice(raw.extracted_price ?? raw.price);
      return {
        source: "serpapi_google_shopping",
        title,
        link,
        store: asStr(raw.source) ?? domainOf(link),
        domain: domainOf(link),
        imageUrl: asStr(raw.thumbnail),
        price,
        currency: currency ?? "EUR",
        brand: asStr(raw.brand),
        position: typeof raw.position === "number" ? raw.position : idx + 1,
        exactImageMatch: false,
        queryUsed: query,
      };
    })
    .filter((c): c is VisualCandidate => c !== null);
}

/** DataForSEO — Google Shopping live (price + product mapping). */
export async function dataForSeoShopping(
  query: string,
  config: VisualSearchConfig
): Promise<VisualCandidate[]> {
  if (!config.dataForSeo) return [];
  const auth = Buffer.from(
    `${config.dataForSeo.username}:${config.dataForSeo.password}`
  ).toString("base64");
  const json = await fetchJson(
    "https://api.dataforseo.com/v3/merchant/google/products/live/advanced",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keyword: query,
          location_code: Number(process.env.DATAFORSEO_LOCATION_CODE) || 2724, // España
          language_code: process.env.DATAFORSEO_LANGUAGE_CODE || "es",
          depth: Number(process.env.DATAFORSEO_MAX_RESULTS) || 20,
        },
      ]),
    }
  );
  if (!json) return [];

  type DfsTask = {
    status_code?: number;
    result?: Array<{ items?: RawMatch[] }>;
  };
  const task = (json.tasks as DfsTask[] | undefined)?.[0];
  if (!task || (task.status_code && task.status_code >= 40000)) {
    console.warn(`[visualSearch] DataForSEO status ${task?.status_code}`);
    return [];
  }
  const items = task.result?.[0]?.items ?? [];
  return items
    .map((raw, idx): VisualCandidate | null => {
      const title = asStr(raw.title);
      const link = asStr(raw.url) ?? asStr(raw.shopping_url);
      if (!title || !link) return null;
      const price =
        typeof raw.price === "number"
          ? raw.price
          : parsePrice(raw.price).price;
      return {
        source: "dataforseo_google_shopping",
        title,
        link,
        store: asStr(raw.seller) ?? domainOf(link),
        domain: domainOf(link),
        imageUrl: asStr(raw.image_url),
        price,
        currency: asStr(raw.currency) ?? "EUR",
        brand: null,
        position: typeof raw.rank_absolute === "number" ? raw.rank_absolute : idx + 1,
        exactImageMatch: false,
        queryUsed: query,
      };
    })
    .filter((c): c is VisualCandidate => c !== null);
}
