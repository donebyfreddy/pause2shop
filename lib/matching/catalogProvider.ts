import { createHash } from "node:crypto";
import type { DetectedItem } from "@/lib/types";
import { getCatalogMatchCache, type TtlLruCache } from "./cache";
import {
  CatalogClient,
  getCatalogClient,
  type CatalogSearchMatch,
  type CatalogSearchResponse,
} from "./catalogClient";
import {
  catalogThresholdFor,
  getMatchingConfig,
  type MatchingConfig,
} from "./config";
import type {
  MatchLabel,
  NormalizedProductMatch,
  ProductMatchingInput,
  ProductMatchingProvider,
  ProductMatchingResult,
} from "./types";
import { classifyMatchType, noMatchResult } from "./types";

/**
 * Estrategia CATALOG: busca el crop en el catálogo propio (catalog-scraper)
 * vía POST /products/search/image.
 *
 * Reglas de evidencia (mismas que matchConfidence.ts): la marca SOLO se envía
 * como filtro si brand_status === "verified" — nunca se afirma una marca sin
 * evidencia visual (un brand_guess no restringe la búsqueda del catálogo).
 */

/**
 * Suelo de score que se pide al servicio: por debajo del umbral fiable pero
 * suficiente para recibir candidatos SIMILAR (la UI y el modo hybrid los
 * quieren aunque no sean fiables). El umbral fiable real
 * (CATALOG_MATCH_MIN_SCORE) se aplica aquí, en el cliente.
 */
const SIMILAR_FLOOR = 0.5;

/** Base64 sin el prefijo data: (el contrato lo exige así). */
export function dataUrlToBase64(dataUrl: string): string | null {
  const idx = dataUrl.indexOf("base64,");
  if (!dataUrl.startsWith("data:image/") || idx === -1) return null;
  return dataUrl.slice(idx + "base64,".length);
}

/** Marca a enviar al catálogo: solo con evidencia verificada. */
export function verifiedBrand(item: DetectedItem): string | null {
  if (item.brand_status !== "verified") return null;
  return item.visible_brand?.trim() || null;
}

function evidenceFor(m: CatalogSearchMatch, brandSent: string | null): string[] {
  const lines: string[] = [];
  if (m.matchStage === "exact_hash") lines.push("✓ Imagen idéntica en el catálogo (hash exacto)");
  if (m.matchStage === "perceptual_hash") lines.push("✓ Imagen casi idéntica en el catálogo (hash perceptual)");
  if (m.visualScore >= 0.85) lines.push("✓ Alta similitud visual con el producto del catálogo");
  if (
    brandSent &&
    m.brand &&
    m.brand.trim().toLowerCase() === brandSent.trim().toLowerCase()
  ) {
    lines.push("✓ La marca verificada coincide");
  }
  if (m.origin === "externally_discovered") lines.push("· Producto descubierto externamente e ingerido al catálogo");
  return lines;
}

export function toNormalizedMatch(
  m: CatalogSearchMatch,
  item: DetectedItem,
  brandSent: string | null,
  threshold: number
): NormalizedProductMatch {
  const brandMatches = Boolean(
    brandSent &&
      m.brand &&
      m.brand.trim().toLowerCase() === brandSent.trim().toLowerCase()
  );
  // Un hash exacto/perceptual ES identidad: la imagen indexada es la misma.
  const identity = m.matchStage === "exact_hash" || m.matchStage === "perceptual_hash";
  const matchType = identity
    ? "exact"
    : classifyMatchType(
        m.finalScore >= threshold ? "CATALOG_MATCH" : "SIMILAR",
        m.finalScore,
        "catalog"
      );
  return {
    source: "catalog",
    productId: m.productId,
    title: m.title,
    brand: m.brand ?? null,
    imageUrl: m.image ?? null,
    productUrl: m.productUrl,
    price: m.price ?? null,
    currency: m.currency ?? null,
    merchant: null,
    availability: m.availability ?? "unknown",
    matchStage: m.matchStage,
    provider: "catalog",
    // Categoría de la FICHA (el servicio la devuelve). Si no viene se deja en
    // null: nunca se rellena con los atributos detectados en el frame, que
    // describen el objeto del vídeo y no el producto indexado.
    category: m.category ?? null,
    catalogColor: m.color ?? null,
    isDemoProduct: m.isDemoProduct ?? m.origin === "dataset_demo",
    model: null,
    matchType,
    scores: {
      detectionScore: Number.isFinite(item.confidence) ? item.confidence : null,
      visualScore: m.visualScore ?? null,
      textScore: m.textScore ?? null,
      attributeScore: m.attributeScore ?? null,
      // Solo se afirma evidencia de marca si nosotros la enviamos verificada
      // y el catálogo la confirmó — nunca por el título del producto.
      brandEvidenceScore: brandMatches ? 1 : null,
      merchantScore: null,
      finalScore: m.finalScore,
    },
    evidence: evidenceFor(m, brandSent),
  };
}

export class CatalogMatchingProvider implements ProductMatchingProvider {
  private readonly client: CatalogClient;
  private readonly config: MatchingConfig;
  private readonly cache: TtlLruCache<CatalogSearchResponse>;

  constructor(opts: {
    client?: CatalogClient;
    config?: MatchingConfig;
    cache?: TtlLruCache<CatalogSearchResponse>;
  } = {}) {
    this.config = opts.config ?? getMatchingConfig();
    this.client = opts.client ?? getCatalogClient();
    this.cache = opts.cache ?? getCatalogMatchCache<CatalogSearchResponse>();
  }

  /**
   * Key por hash del crop + TODO lo que cambia la respuesta: filtros enviados,
   * modelo de embeddings y versión del índice.
   *
   * El modelo y la versión están aquí porque son la parte que muerde: al pasar
   * de embeddings hash a CLIP, o tras un reindex, las respuestas cacheadas con
   * el índice anterior son simplemente incorrectas y no hay forma de detectarlo
   * desde el valor. Con ambos en la clave, las entradas viejas quedan
   * huérfanas en vez de servirse.
   */
  private cacheKey(base64: string, item: DetectedItem, brand: string | null): string {
    const hash = createHash("sha256").update(base64).digest("hex");
    return [
      "catalog:v2",
      hash,
      process.env.CATALOG_IMAGE_EMBEDDING_PROVIDER?.trim() || "default",
      process.env.CATALOG_INDEX_VERSION?.trim() || "1",
      (item.category ?? "").toLowerCase(),
      (item.color ?? "").toLowerCase(),
      (brand ?? "").toLowerCase(),
      (item.type || item.subcategory || "").toLowerCase(),
      (item.gender_fit ?? "").toLowerCase(),
      (item.material_guess ?? "").toLowerCase(),
      (item.pattern ?? "").toLowerCase(),
      this.config.catalogMatchTopK,
      this.config.catalogMatchMinScore,
    ].join(":");
  }

  async search(input: ProductMatchingInput): Promise<ProductMatchingResult> {
    const t0 = Date.now();
    const base64 = input.cropDataUrl ? dataUrlToBase64(input.cropDataUrl) : null;
    if (!base64) {
      return noMatchResult({
        providerUsed: null,
        warnings: ["Sin crop utilizable para la búsqueda por imagen en el catálogo."],
        timings: { catalogMs: 0 },
      });
    }

    const brand = verifiedBrand(input.item);
    const key = this.cacheKey(base64, input.item, brand);
    let data: CatalogSearchResponse | null = null;
    let cached = false;

    if (this.config.catalogCacheEnabled && !input.skipCache) {
      data = this.cache.get(key);
      cached = data != null;
    }

    if (!data) {
      const res = await this.client.searchByImage({
        imageBase64: base64,
        category: input.item.category || undefined,
        color: input.item.color || undefined,
        brand: brand ?? undefined,
        // Señales adicionales de la detección. `type` y `pattern`/`material`
        // solo re-rankean; `gender` puede excluir, pero únicamente cuando la
        // ficha declara un género incompatible (ver genderConflicts).
        type: input.item.type || input.item.subcategory || undefined,
        gender: input.item.gender_fit || undefined,
        material: input.item.material_guess || undefined,
        pattern: input.item.pattern || undefined,
        requireImage: true,
        topK: this.config.catalogMatchTopK,
        // Suelo laxo: los SIMILAR también interesan; el umbral fiable
        // (catalogMatchMinScore) se aplica abajo al etiquetar.
        minScore: Math.min(SIMILAR_FLOOR, this.config.catalogMatchMinScore),
      });
      if (!res.ok) {
        return noMatchResult({
          providerUsed: null,
          warnings: [`Catálogo no disponible (${res.error.code}): ${res.error.message}`],
          timings: { catalogMs: Date.now() - t0 },
        });
      }
      data = res.data;
      if (this.config.catalogCacheEnabled) {
        this.cache.set(key, data, this.config.catalogCacheTtlSeconds);
      }
    }

    const threshold = catalogThresholdFor(this.config, input.item.category);
    const matches = (data.matches ?? [])
      .map((m) => toNormalizedMatch(m, input.item, brand, threshold))
      .sort((a, b) => b.scores.finalScore - a.scores.finalScore);

    const best = matches[0];
    let matchLabel: MatchLabel = "NO_MATCH";
    if (best) {
      matchLabel =
        best.scores.finalScore >= threshold ? "CATALOG_MATCH" : "SIMILAR";
    }

    return {
      matches,
      matchLabel,
      providerUsed: "catalog",
      fallbackUsed: false,
      cached,
      timings: { catalogMs: Date.now() - t0 },
      catalogAttempted: true,
      externalAttempted: false,
      externalFallbackUsed: false,
      unresolvedReason:
        matchLabel === "NO_MATCH"
          ? "Sin coincidencia suficiente en el catálogo."
          : undefined,
    };
  }
}
