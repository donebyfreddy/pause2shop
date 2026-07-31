import { NextResponse } from "next/server";
import { getMatchingConfig } from "@/lib/matching/config";
import { catalogThresholdFor } from "@/lib/matching/config";
import { getMatchingMetrics } from "@/lib/server/matchingMetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/matching/metrics — cuánto resuelve el CATÁLOGO y cuánto se gasta
 * fuera.
 *
 * La pregunta que responde es la que decide si el catálogo merece la pena: de
 * cada 100 objetos detectados, cuántos se resuelven en casa, cuántos hay que
 * pagar fuera, y qué categorías se quedan sin resolver (que es la lista de lo
 * que hay que indexar a continuación).
 *
 * Contadores en memoria por proceso, igual que el tracker de costes: sirven
 * para observar una sesión de trabajo, no como contabilidad histórica.
 */
export async function GET() {
  const config = getMatchingConfig();
  const metrics = getMatchingMetrics();

  return NextResponse.json({
    ok: true,
    metrics,
    config: {
      mode: config.mode,
      catalogThreshold: config.catalogMatchMinScore,
      externalThreshold: config.externalMatchMinScore,
      catalogTopK: config.catalogMatchTopK,
      catalogMaxVisible: config.catalogMatchMaxVisible,
      externalSearchEnabled: config.externalSearchEnabled,
      automaticFallback: config.catalogExternalFallback,
      saveExternalResults: config.catalogSaveExternalResults,
      cacheEnabled: config.catalogCacheEnabled,
      cacheTtlSeconds: config.catalogCacheTtlSeconds,
      // Umbrales afinados por categoría: se exponen resueltos para que el admin
      // vea el valor efectivo y no tenga que recomponerlo desde las env.
      thresholdsByCategory: Object.fromEntries(
        Object.keys(config.catalogThresholdByCategory).map((category) => [
          category,
          catalogThresholdFor(config, category),
        ])
      ),
    },
  });
}
