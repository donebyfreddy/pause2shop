import type { CheerioAPI } from "cheerio";
import { BaseConnector } from "../base/BaseConnector";
import type { FetchFn } from "../base/httpClient";
import type { ExtractionLayer } from "../../extraction/types";
import { SPAIN_SOURCES } from "../sources/spain";

const SPEC = SPAIN_SOURCES.find((s) => s.id === "mango")!;

/**
 * Conector Mango. La tienda es una app Next.js, así que el estado de la ficha
 * viaja en `__NEXT_DATA__`; es más completo y estable que raspar el DOM.
 *
 * Verificado con fixtures (test/catalogIngestion/fixtures/mango/).
 */
export class MangoConnector extends BaseConnector {
  constructor(fetchFn?: FetchFn) {
    super(SPEC, fetchFn);
  }

  /** Mango (Next.js) embebe el estado en __NEXT_DATA__. */
  protected extractEmbeddedLayer(_html: string, $: CheerioAPI): ExtractionLayer | null {
    const raw = $("script#__NEXT_DATA__").contents().text().trim();
    if (!raw) return null;
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    const pageProps = data?.props?.pageProps ?? {};
    const product = pageProps.productDetail ?? pageProps.product ?? pageProps.initialProduct;
    if (!product?.name) return null;

    const colors: any[] = Array.isArray(product.colors) ? product.colors : [];
    const sizes: string[] = (Array.isArray(product.sizes) ? product.sizes : [])
      .map((s: any) => s?.label ?? s?.name ?? s?.value)
      .filter((s: unknown): s is string => typeof s === "string");

    return {
      kind: "embedded",
      fields: {
        productType: "product",
        title: product.name,
        sourceProductId: product.id != null ? String(product.id) : null,
        description: product.description ?? product.longDescription ?? null,
        price: product.price?.sale ?? product.price?.value ?? product.price?.current ?? null,
        originalPrice: product.price?.original ?? product.price?.previous ?? null,
        currency: product.price?.currency ?? null,
        color: product.color?.name ?? product.colorName ?? colors[0]?.name ?? null,
        secondaryColors: colors
          .slice(1)
          .map((c) => c?.name)
          .filter((n: unknown): n is string => typeof n === "string"),
        material: product.composition ?? null,
        sku: product.sku ?? product.reference ?? null,
        sizes: [...new Set(sizes)],
        imageUrls: (Array.isArray(product.images) ? product.images : [])
          .map((img: any) => img?.url ?? img?.src ?? (typeof img === "string" ? img : null))
          .filter((u: unknown): u is string => typeof u === "string"),
      },
      snippets: {
        title: "__NEXT_DATA__ → pageProps.productDetail.name",
        price: "__NEXT_DATA__ → productDetail.price.sale",
        color: "__NEXT_DATA__ → productDetail.color.name",
        sizes: "__NEXT_DATA__ → productDetail.sizes[].label",
      },
    };
  }
}
