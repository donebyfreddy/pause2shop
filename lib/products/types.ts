import type { CatalogItem, RecommendationInput } from "@/lib/catalog/types";

/**
 * Contrato de un proveedor de productos. Hoy solo hay un mock; mañana se añaden
 * Amazon (Product Advertising API), tiendas verificadas, catálogo propio, etc.
 * sin tocar el resto del sistema.
 *
 *   interface ProductProvider {
 *     name: string;
 *     search(query, item): Promise<ProductRecommendation[]>;
 *   }
 *
 * Devuelve RecommendationInput (sin id ni detectedItemId): la capa de catálogo
 * se encarga de persistirlas y asignar ids.
 */
export interface ProductProvider {
  /** Nombre legible del proveedor (se guarda en cada recomendación). */
  readonly name: string;
  /** ¿Está configurado/activo? (p.ej. mock tras ENABLE_MOCK_PRODUCTS). */
  isEnabled(): boolean;
  /** Busca productos para una query + el item detectado. */
  search(query: string, item: CatalogItem): Promise<RecommendationInput[]>;
}
