import { NextResponse } from "next/server";
import { getVisualSearchConfig } from "@/lib/visualSearch/config";
import { isDatabaseConfigured } from "@/lib/db/pool";
import { isPubliclyReachableBase } from "@/lib/mediaStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Availability = "available" | "unavailable";

/**
 * GET /api/health/visual-search — preflight que resume si el sistema puede
 * hacer reverse image search REAL antes de empezar un análisis. Devuelve causas
 * concretas (nunca secretos) para sustituir el "Búsqueda visual no disponible"
 * sin explicación.
 */
export async function GET() {
  const cfg = getVisualSearchConfig();
  const reasons: string[] = [];

  const openai = Boolean(process.env.OPENAI_API_KEY?.trim());
  if (!openai) reasons.push("OPENAI_API_KEY ausente: sin detección.");

  const searchApi = Boolean(cfg.searchApiKey);
  const serpApi = Boolean(cfg.serpApiKey);
  if (!searchApi && !serpApi)
    reasons.push(
      "Reverse image sin proveedor: configura SEARCHAPI_API_KEY (primario) o SERPAPI_API_KEY (fallback).",
    );

  // Storage público: sin él, un crop solo existe localmente y Lens no lo ve.
  let storageOk = false;
  if (!cfg.storage) {
    reasons.push(
      `El proveedor de storage configurado no está implementado: ver STORAGE_PROVIDER (lib/mediaStorage).`,
    );
  } else if (!cfg.storage.publicBaseUrl) {
    // No es un fallo duro: en un deploy público se usa el origen de la
    // petición. Solo revienta en localhost, y eso lo dirá /api/health/storage.
    storageOk = true;
    reasons.push(
      "Sin PUBLIC_MEDIA_BASE_URL: se publicará en el origen de cada petición. En localhost Lens no podrá descargar el crop.",
    );
  } else if (!isPubliclyReachableBase(cfg.storage.publicBaseUrl)) {
    reasons.push(
      `PUBLIC_MEDIA_BASE_URL ("${cfg.storage.publicBaseUrl}") es localhost o red privada: Lens no puede descargar de ahí.`,
    );
  } else {
    storageOk = true;
  }

  const dataForSeo = Boolean(cfg.dataForSeo);
  const database = isDatabaseConfigured();

  const reverseImage: Availability =
    (searchApi || serpApi) && storageOk ? "available" : "unavailable";

  const primary =
    process.env.REVERSE_IMAGE_PRIMARY_PROVIDER === "serpapi_google_lens"
      ? "serpapi_google_lens"
      : "searchapi_google_lens";

  return NextResponse.json({
    ok: reverseImage === "available",
    detection: openai ? "available" : "unavailable",
    publicStorage: storageOk ? "available" : "unavailable",
    reverseImageSearch: reverseImage,
    catalog: database ? "persistent" : "memory",
    shoppingEnrichment: dataForSeo ? "available" : "unavailable",
    providers: {
      primary,
      searchApi: searchApi ? "configured" : "missing",
      serpApi: serpApi ? "configured" : "missing",
      dataForSeo: dataForSeo ? "configured" : "missing",
    },
    reasons,
  });
}
