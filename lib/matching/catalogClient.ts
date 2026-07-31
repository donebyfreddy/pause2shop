import type { MatchingConfig } from "./config";
import { getMatchingConfig } from "./config";

/**
 * Cliente HTTP tipado del servicio de catálogo (CATALOG_API_CONTRACT.md).
 *
 * Reglas:
 *  - NUNCA lanza hacia arriba: todo método devuelve { ok: true, data } o
 *    { ok: false, error } tipado — el matching nunca se rompe por el catálogo.
 *  - Timeout con AbortController (CATALOG_REQUEST_TIMEOUT_MS): el catálogo
 *    caído no puede colgar el análisis.
 *  - fetch inyectable para tests (sin red real).
 */

export type CatalogError = {
  /** "timeout" | "network" | "unauthorized" | "http_<status>" | "invalid_response" */
  code: string;
  message: string;
  status: number | null;
};

export type CatalogResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CatalogError };

/** Match del contrato POST /products/search/image (NO cambiar campos). */
export type CatalogSearchMatch = {
  productId: string;
  title: string;
  brand: string | null;
  image: string | null;
  productUrl: string;
  price: number | null;
  currency: string | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  visualScore: number;
  textScore: number;
  attributeScore: number;
  finalScore: number;
  source: "catalog";
  matchStage: "exact_hash" | "perceptual_hash" | "embedding";
  origin: "scraped" | "externally_discovered" | "dataset_demo";
  /**
   * Ficha de dataset de investigación: sirve para el matching pero no tiene
   * precio ni URL de compra. La UI no puede ofrecer "Comprar" sobre ella.
   */
  isDemoProduct?: boolean;
  /** Taxonomía de la ficha (≠ atributos detectados en el frame). */
  category?: string | null;
  subcategory?: string | null;
  color?: string | null;
};

export type CatalogSearchResponse = {
  queryId: string;
  matches: CatalogSearchMatch[];
};

export type CatalogImageSearchRequest = {
  /** Base64 SIN prefijo data: (lo exige el contrato). */
  imageBase64?: string;
  imageUrl?: string;
  category?: string;
  brand?: string;
  color?: string;
  /** Tipo de artículo detectado; señal de ranking, no filtro duro. */
  type?: string;
  /** Género; solo excluye si la ficha declara uno incompatible. */
  gender?: string;
  material?: string;
  pattern?: string;
  /** Exigir imagen presentable en la ficha (default true en el servicio). */
  requireImage?: boolean;
  topK?: number;
  minScore?: number;
};

export type CatalogHealth = {
  status: "ok" | "degraded";
  db: "postgres" | "file" | "unavailable";
  embeddings: { provider: "local" | "hash"; model: string; dimension: number };
  products: number;
  uptimeSeconds: number;
};

/** Body de POST /products/external (ingesta de resultado externo fiable). */
export type ExternalProductInput = {
  provider:
    | "serpapi_google_lens"
    | "searchapi_google_lens"
    | "serpapi_google_shopping"
    | "dataforseo_google_shopping";
  title: string;
  brand?: string | null;
  price?: number | null;
  currency?: string | null;
  productUrl: string;
  imageUrl?: string | null;
  merchant?: string | null;
  category?: string | null;
  color?: string | null;
  score: number;
  evidence?: string[];
  rawResult?: object;
};

export type ExternalProductResponse = {
  productId: string;
  deduplicated: boolean;
};

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export class CatalogClient {
  private readonly config: MatchingConfig;
  private readonly fetchImpl: FetchLike;
  private readonly useInjectedFetch: boolean;
  private readonly useInternalService: boolean;

  constructor(config?: MatchingConfig, fetchImpl?: FetchLike) {
    this.config = config ?? getMatchingConfig();
    // Bind: pasar fetch suelto pierde `this` en algunos runtimes.
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.useInjectedFetch = Boolean(fetchImpl);
    // Runtime callers use the embedded engine. Supplying config explicitly is
    // still a supported seam for HTTP contract tests and transitional clients.
    this.useInternalService = config == null && fetchImpl == null;
  }

  /**
   * Petición base con timeout y auth. Todos los errores (red, timeout, HTTP,
   * JSON inválido) se convierten en CatalogError — nunca se propaga excepción.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<CatalogResult<T>> {
    if (this.useInternalService) {
      try {
        const { invokeCatalogService } = await import("@/lib/catalogIngestion/service");
        const result = await invokeCatalogService(path, { method, body });
        if (result.status < 200 || result.status >= 300) {
          const error = (result.body as { error?: { code?: string; message?: string } } | null)?.error;
          return {
            ok: false,
            error: {
              code: error?.code ?? `http_${result.status}`,
              message: error?.message ?? `El catálogo respondió ${result.status}`,
              status: result.status,
            },
          };
        }
        return { ok: true, data: result.body as T };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: error instanceof Error ? error.message : "Catálogo integrado no disponible",
            status: null,
          },
        };
      }
    }

    const url = `${this.config.catalogServiceUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.catalogRequestTimeoutMs
    );
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // /health es el único endpoint sin auth; mandar la key siempre no daña.
      if (this.config.catalogServiceApiKey) {
        headers["x-api-key"] = this.config.catalogServiceApiKey;
      }
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        // Cuerpo no-JSON: solo es fatal si el status era OK.
      }

      if (!res.ok) {
        const errBody = json as { error?: { code?: string; message?: string } } | null;
        return {
          ok: false,
          error: {
            code:
              res.status === 401 || res.status === 403
                ? "unauthorized"
                : errBody?.error?.code ?? `http_${res.status}`,
            message:
              errBody?.error?.message ?? `El catálogo respondió ${res.status}`,
            status: res.status,
          },
        };
      }
      if (json == null) {
        return {
          ok: false,
          error: {
            code: "invalid_response",
            message: "El catálogo devolvió un cuerpo no-JSON.",
            status: res.status,
          },
        };
      }
      return { ok: true, data: json as T };
    } catch (err) {
      const aborted =
        err instanceof Error &&
        (err.name === "AbortError" || /abort/i.test(err.message));
      return {
        ok: false,
        error: {
          code: aborted ? "timeout" : "network",
          message: aborted
            ? `Timeout de ${this.config.catalogRequestTimeoutMs}ms llamando al catálogo`
            : err instanceof Error
              ? err.message
              : "Error de red desconocido",
          status: null,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /health (sin auth). */
  health(): Promise<CatalogResult<CatalogHealth>> {
    return this.request<CatalogHealth>("GET", "/health");
  }

  /** POST /products/search/image. */
  searchByImage(
    body: CatalogImageSearchRequest
  ): Promise<CatalogResult<CatalogSearchResponse>> {
    return this.request<CatalogSearchResponse>(
      "POST",
      "/products/search/image",
      body
    );
  }

  /** POST /products/external — ingesta best-effort de un resultado externo. */
  saveExternalProduct(
    body: ExternalProductInput
  ): Promise<CatalogResult<ExternalProductResponse>> {
    return this.request<ExternalProductResponse>(
      "POST",
      "/products/external",
      body
    );
  }
}

// Singleton por proceso (mismo patrón que el pool de pg): el cliente es
// stateless salvo config, así que compartirlo es seguro.
const globalForClient = globalThis as unknown as {
  __catalogClient?: CatalogClient;
};

export function getCatalogClient(): CatalogClient {
  if (!globalForClient.__catalogClient) {
    globalForClient.__catalogClient = new CatalogClient();
  }
  return globalForClient.__catalogClient;
}
