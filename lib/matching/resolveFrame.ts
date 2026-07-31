import type { DetectedItem } from "@/lib/types";
import { cropFromFrameServer } from "@/lib/server/serverCrop";
import { CatalogMatchingProvider } from "./catalogProvider";
import { getMatchingConfig, type MatchingConfig } from "./config";
import { catalogResultToVisualMatch } from "./presentation";
import type {
  MatchingMode,
  MatchingUsage,
  ProductMatchingProvider,
  ProductMatchingResult,
} from "./types";
import { emptyUsage } from "./types";

/**
 * Resolución de TODAS las detecciones de un frame contra el CATÁLOGO propio.
 *
 * Por qué existe además de los providers: el pipeline externo trabaja sobre el
 * frame entero (Lens sube una imagen y devuelve candidatos), mientras que el
 * catálogo busca por producto. Este módulo hace ese puente — recorta cada
 * objeto en el servidor y lo busca en el índice — para que los modos
 * catalog_only / catalog_first / hybrid cambien de verdad lo que ocurre en el
 * backend del análisis de imagen, y no solo la etiqueta de la respuesta.
 */

export type CatalogPassResult = {
  /** Items con `visual_match` del catálogo cuando lo hubo. */
  items: DetectedItem[];
  /** Resultado por índice de item (para decidir el fallback externo). */
  byIndex: Map<number, ProductMatchingResult>;
  /** Índices que NO quedaron resueltos por el catálogo. */
  unresolved: number[];
  usage: MatchingUsage;
};

export type CatalogPassDeps = {
  provider?: ProductMatchingProvider;
  config?: MatchingConfig;
  /** Inyectable en tests: por defecto recorta con sharp. */
  crop?: (frameDataUrl: string, box: DetectedItem["bounding_box"]) => Promise<string | null>;
};

/**
 * ¿Este modo debe consultar el catálogo antes que nada?
 * external_only es el único que NO lo hace.
 */
export function usesCatalog(mode: MatchingMode): boolean {
  return mode !== "external_only";
}

/** ¿Puede este modo gastar una llamada al proveedor externo? */
export function allowsExternal(mode: MatchingMode): boolean {
  return mode !== "catalog_only";
}

/**
 * Fracción del encuadre a partir de la cual recortar deja de tener sentido.
 * Por debajo de esto el recorte SÍ aísla el producto de su entorno; por encima,
 * recortar solo reencoda la misma imagen (y con el proveedor de embeddings por
 * hash, eso rompe la identidad exacta que el catálogo sabe reconocer).
 */
const FULL_FRAME_AREA_RATIO = 0.7;

export function coversMostOfFrame(box: DetectedItem["bounding_box"]): boolean {
  if (!box) return false;
  return box.width * box.height >= FULL_FRAME_AREA_RATIO;
}

/**
 * Ejecuta la pasada de catálogo sobre los items de un frame.
 * Nunca lanza: un fallo del catálogo deja los items intactos y lo reporta en
 * `usage`, para que el modo que corresponda pueda seguir con el externo.
 */
export async function resolveFrameAgainstCatalog(
  frameDataUrl: string,
  items: DetectedItem[],
  deps: CatalogPassDeps = {}
): Promise<CatalogPassResult> {
  const config = deps.config ?? getMatchingConfig();
  const provider = deps.provider ?? new CatalogMatchingProvider({ config });
  const crop = deps.crop ?? cropFromFrameServer;

  const usage = emptyUsage();
  usage.detections = items.length;
  const byIndex = new Map<number, ProductMatchingResult>();
  const unresolved: number[] = [];
  const out = [...items];
  const t0 = Date.now();

  for (const [index, item] of items.entries()) {
    if (!item.bounding_box) {
      // Sin caja no hay recorte posible: lo resuelve el camino externo.
      unresolved.push(index);
      continue;
    }

    // Cuando el objeto ocupa casi todo el encuadre (una foto de producto), el
    // recorte no aísla nada: solo vuelve a comprimir la MISMA imagen y destruye
    // la identidad por hash que el catálogo usa para reconocerla. En ese caso
    // se busca el frame original tal cual.
    const cropDataUrl = coversMostOfFrame(item.bounding_box)
      ? frameDataUrl
      : await crop(frameDataUrl, item.bounding_box);
    if (!cropDataUrl) {
      unresolved.push(index);
      continue;
    }

    const result = await provider.search({ item, cropDataUrl });
    usage.catalogQueries += 1;
    if (result.cached) usage.cacheHits += 1;
    byIndex.set(index, result);

    if (result.matchLabel === "CATALOG_MATCH") {
      const visual = catalogResultToVisualMatch(result, item);
      if (visual) {
        out[index] = { ...item, visual_match: visual };
        usage.resolvedInternally += 1;
        continue;
      }
    }
    unresolved.push(index);
  }

  usage.unresolved = unresolved.length;
  usage.timings.catalogMs = Date.now() - t0;
  return { items: out, byIndex, unresolved, usage };
}

/** Une los contadores de dos pasadas (catálogo + externo). */
export function mergeUsage(a: MatchingUsage, b: Partial<MatchingUsage>): MatchingUsage {
  return {
    detections: Math.max(a.detections, b.detections ?? 0),
    catalogQueries: a.catalogQueries + (b.catalogQueries ?? 0),
    externalCalls: a.externalCalls + (b.externalCalls ?? 0),
    cacheHits: a.cacheHits + (b.cacheHits ?? 0),
    fallbacks: a.fallbacks + (b.fallbacks ?? 0),
    resolvedInternally: a.resolvedInternally + (b.resolvedInternally ?? 0),
    resolvedExternally: a.resolvedExternally + (b.resolvedExternally ?? 0),
    unresolved: b.unresolved ?? a.unresolved,
    estimatedExternalCostUsd:
      a.estimatedExternalCostUsd + (b.estimatedExternalCostUsd ?? 0),
    timings: { ...a.timings, ...(b.timings ?? {}) },
  };
}

/** Línea de log legible del coste de un análisis (admin / consola). */
export function usageSummary(mode: MatchingMode, usage: MatchingUsage): string {
  const parts = [
    `modo=${mode}`,
    `${usage.detections} objetos detectados`,
    `${usage.catalogQueries} búsquedas en catálogo`,
    `${usage.externalCalls} llamadas externas`,
    `${usage.resolvedInternally} resueltos internamente`,
    `${usage.resolvedExternally} resueltos con búsqueda externa`,
    `${usage.unresolved} sin resolver`,
    `${usage.cacheHits} aciertos de caché`,
  ];
  if (usage.estimatedExternalCostUsd > 0) {
    parts.push(
      `coste externo estimado: ${usage.estimatedExternalCostUsd.toFixed(4)} USD`
    );
  }
  return parts.join(" · ");
}
