import { NextResponse } from "next/server";
import { getCatalogClient, getMatchingConfig } from "@/lib/matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/catalog — ¿está vivo el servicio de catálogo
 * (catalog-scraper)? Reexpone su GET /health y añade la configuración de
 * matching efectiva (sin secretos) para diagnosticar los modos catalog-*.
 */
export async function GET() {
  const config = getMatchingConfig();
  const health = await getCatalogClient().health();

  return NextResponse.json({
    ok: health.ok,
    mode: config.mode,
    serviceUrl: config.catalogServiceUrl,
    apiKeyConfigured: Boolean(config.catalogServiceApiKey),
    minScore: config.catalogMatchMinScore,
    externalFallback: config.catalogExternalFallback,
    saveExternalResults: config.catalogSaveExternalResults,
    ...(health.ok
      ? { catalog: health.data }
      : {
          error: {
            code: health.error.code,
            message: health.error.message,
            status: health.error.status,
          },
        }),
  });
}
