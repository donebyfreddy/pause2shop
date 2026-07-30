import type { CheerioAPI } from "cheerio";
import { BaseConnector } from "../base/BaseConnector";
import type { FetchFn } from "../base/httpClient";
import type { ExtractionLayer } from "../../extraction/types";
import { extractBalancedJson } from "../../extraction/structured";
import { INDITEX_SOURCES } from "../sources/inditex";

const SPEC = INDITEX_SOURCES.find((s) => s.id === "zara")!;

/**
 * Conector Zara. La ficha de Zara es una SPA: el HTML plano trae poco y el
 * estado real viaja en `window.zara.viewPayload`. Este hook lo lee; si no está,
 * el pipeline sigue con JSON-LD → OG → selectores → navegador → IA.
 *
 * Verificado con fixtures (test/catalogIngestion/fixtures/zara/). El acceso live
 * es best-effort: zara.com protege parte del catálogo con anti-bot; si aparece
 * un challenge, el conector queda `blocked_or_challenged` SIN intentar eludirlo.
 */
export class ZaraConnector extends BaseConnector {
  constructor(fetchFn?: FetchFn) {
    super(SPEC, fetchFn);
  }

  /** Zara embebe el estado de la ficha en window.zara.viewPayload. */
  protected extractEmbeddedLayer(html: string, _$: CheerioAPI): ExtractionLayer | null {
    // Lectura con conteo de llaves: el payload tiene objetos anidados, y un
    // regex perezoso cortaría en la primera llave interior (precio a null).
    const raw =
      extractBalancedJson(html, /viewPayload\s*:\s*/i) ??
      extractBalancedJson(html, /viewPayload\s*=\s*/i);
    if (!raw) return null;
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
    const product = payload?.product ?? payload;
    if (!product?.name) return null;

    // La moneda puede venir dentro del payload o en el objeto `window.zara` que
    // lo envuelve, según la plantilla. Se buscan las dos ubicaciones antes de
    // rendirse: sin moneda, un precio no es utilizable.
    const outer = extractBalancedJson(html, /window\.zara\s*=\s*/i);
    let outerCurrency: string | null = null;
    if (outer) {
      try {
        outerCurrency = (JSON.parse(outer) as { currency?: string }).currency ?? null;
      } catch {
        // `window.zara` suele llevar funciones y no ser JSON válido: se intenta
        // leer solo la propiedad con un regex acotado.
        outerCurrency = /currency\s*:\s*["']([A-Z]{3})["']/i.exec(outer)?.[1] ?? null;
      }
    }
    const currency =
      payload?.currency ??
      product?.currency ??
      outerCurrency ??
      /"currency"\s*:\s*"([A-Z]{3})"/.exec(html)?.[1] ??
      null;

    // Zara publica el precio en CÉNTIMOS. Pasarlo a unidades es leer su unidad,
    // no "calcular" un precio: el importe sigue siendo el que muestra la tienda.
    const toAmount = (value: unknown): number | null =>
      typeof value === "number" ? value / 100 : null;

    const detail = product.detail ?? {};
    const colors: any[] = Array.isArray(detail.colors) ? detail.colors : [];
    const sizes = colors
      .flatMap((c) => (Array.isArray(c?.sizes) ? c.sizes : []))
      .map((s: any) => s?.name)
      .filter((s: unknown): s is string => typeof s === "string");

    return {
      kind: "embedded",
      fields: {
        productType: "product",
        title: product.name,
        sourceProductId: product.id != null ? String(product.id) : null,
        description: detail.description ?? null,
        price: toAmount(product.price),
        originalPrice: toAmount(product.oldPrice),
        currency,
        color: colors[0]?.name ?? null,
        secondaryColors: colors
          .slice(1)
          .map((c) => c?.name)
          .filter((n: unknown): n is string => typeof n === "string"),
        material: detail.composition?.[0]?.description ?? null,
        sizes: [...new Set(sizes)],
        imageUrls: colors
          .flatMap((c) => (Array.isArray(c?.xmedia) ? c.xmedia : []))
          .map((media: any) => (media?.url ? String(media.url).replace("{width}", "1024") : null))
          .filter((u: unknown): u is string => typeof u === "string"),
      },
      snippets: {
        title: "window.zara.viewPayload → product.name",
        price: "window.zara.viewPayload → product.price (céntimos)",
        color: "viewPayload → product.detail.colors[0].name",
        sizes: "viewPayload → colors[].sizes[].name",
      },
    };
  }
}
