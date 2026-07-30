import type { CheerioAPI } from "cheerio";
import { BaseConnector } from "../base/BaseConnector";
import type { FetchFn } from "../base/httpClient";
import type { ExtractionLayer } from "../../extraction/types";
import { extractBalancedJson } from "../../extraction/structured";
import { HM_GROUP_SOURCES } from "../sources/hmGroup";

const SPEC = HM_GROUP_SOURCES.find((s) => s.id === "hm")!;

/**
 * Conector H&M. H&M publica JSON-LD correcto en la mayoría de fichas (el
 * pipeline lo coge solo); este hook añade `productArticleDetails`, que trae
 * composición y etiqueta de color con más detalle que el JSON-LD.
 *
 * Verificado con fixtures (test/catalogIngestion/fixtures/hm/).
 */
export class HmConnector extends BaseConnector {
  constructor(fetchFn?: FetchFn) {
    super(SPEC, fetchFn);
  }

  /** H&M embebe los detalles de artículo en productArticleDetails. */
  protected extractEmbeddedLayer(html: string, _$: CheerioAPI): ExtractionLayer | null {
    const raw = extractBalancedJson(html, /productArticleDetails\s*=\s*/i);
    if (!raw) return null;
    let data: any;
    try {
      // El objeto usa a veces comillas simples y funciones: si no es JSON
      // estricto desistimos — el JSON-LD ya cubre el caso normal.
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    const articleKey = Object.keys(data).find((k) => /^\d+$/.test(k));
    const article = articleKey ? data[articleKey] : data;
    if (!article?.name) return null;

    const images = (Array.isArray(article.images) ? article.images : [])
      .map((img: any) => img?.zoomImage ?? img?.image ?? img?.fullscreen ?? null)
      .filter((u: unknown): u is string => typeof u === "string")
      .map((u: string) => (u.startsWith("//") ? `https:${u}` : u));

    return {
      kind: "embedded",
      fields: {
        productType: "product",
        title: article.name,
        sourceProductId: articleKey ?? null,
        // `whitePriceValue` es el precio normal y `redPriceValue` el rebajado:
        // si hay rebaja, el vigente es el rojo y el tachado el blanco.
        price: article.redPriceValue ?? article.whitePriceValue ?? null,
        originalPrice: article.redPriceValue ? (article.whitePriceValue ?? null) : null,
        color: article.colorLabel ?? article.name ?? null,
        material: Array.isArray(article.compositions)
          ? article.compositions.join(", ")
          : (article.compositions ?? null),
        sku: article.articleCode ?? null,
        imageUrls: images,
      },
      snippets: {
        title: "productArticleDetails → name",
        price: "productArticleDetails → redPriceValue/whitePriceValue",
        color: "productArticleDetails → colorLabel",
        material: "productArticleDetails → compositions",
      },
    };
  }
}
