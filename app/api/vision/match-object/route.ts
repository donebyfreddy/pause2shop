import { NextRequest, NextResponse } from "next/server";
import { decodeImageDataUrl } from "@/lib/visualSearch/storage";
import { budgetSnapshot } from "@/lib/server/searchBudget";
import type { DetectedItem } from "@/lib/types";
import {
  catalogResultToVisualMatch,
  catalogSimilarCandidates,
} from "@/lib/matching/presentation";
import {
  resolveDetectionRequest,
  type OkBody,
  type SimilarCandidate,
} from "@/lib/matching/detectionPipeline";
import type {
  DetectionMatchResult,
  MatchingMode,
  ProductMatchingResult,
} from "@/lib/matching";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vision/match-object — matching visual REAL por crop de objeto.
 *
 * EL CATÁLOGO PROPIO ES LA FUENTE PRINCIPAL:
 *
 *   crop → embedding/hash → búsqueda en el catálogo → ranking → umbral
 *        → (solo si procede) pipeline externo → bloques SEPARADOS
 *
 * Este handler es ya SOLO la capa HTTP: parsea, delega en
 * `resolveDetectionRequest` (lib/matching/detectionPipeline.ts) y da forma a la
 * respuesta. La lógica se movió a lib porque el job de vídeo preprocesado
 * necesita el mismo pipeline en proceso y estaba obligado a hacer self-fetch.
 */

const MAX_CROP_BYTES = 4 * 1024 * 1024;

export type { SimilarCandidate };

export type MatchObjectResponse =
  | (OkBody & {
      /** Modo de matching efectivo de esta petición. */
      matchingMode?: MatchingMode;
      /** Resultado normalizado con procedencia (source) y scores separados. */
      matching?: ProductMatchingResult;
      /**
       * CONTRATO PRINCIPAL para la UI: catálogo e Internet en bloques
       * separados, cada uno con su estado, su umbral y sus candidatos.
       */
      detection?: DetectionMatchResult;
    })
  | { ok: false; error: string };

type MatchObjectBody = {
  crop?: string;
  item?: Partial<DetectedItem> & { name: string };
  videoKey?: string;
  itemId?: string;
  /** Debug: fuerza búsqueda fresca ignorando la caché de candidatos. */
  skipCache?: boolean;
  /** Override del modo de matching para esta petición (selector de la demo). */
  matchingMode?: string;
  /**
   * Identidad estable de la detección. La fija el cliente (fingerprint) para
   * que la tarjeta y el bounding box hablen del mismo objeto entre frames.
   */
  detectionId?: string;
  /** Segundo del vídeo en que se capturó el frame (null en imagen). */
  timestampSeconds?: number | null;
  /**
   * El usuario pulsó "Buscar también en Internet". Es la ÚNICA forma de gastar
   * una llamada externa cuando el catálogo ya había resuelto.
   */
  forceExternal?: boolean;
  analysisJobId?: string;
  mediaContentId?: string;
  globalProductId?: string;
  frameId?: string;
  frameHash?: string;
  analysisSessionId?: string;
  mediaTime?: number | null;
};

function respond(body: MatchObjectResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const t0 = Date.now();

  let body: MatchObjectBody;
  try {
    body = (await req.json()) as MatchObjectBody;
  } catch {
    return respond({ ok: false, error: "Cuerpo inválido." }, 400);
  }

  const { crop, item, videoKey, itemId, skipCache } = body;
  if (!crop?.startsWith("data:image/") || !item?.name) {
    return respond({ ok: false, error: "Faltan crop (data URL) o item." }, 400);
  }

  const decoded = decodeImageDataUrl(crop);
  if (!decoded || decoded.buffer.byteLength > MAX_CROP_BYTES) {
    return respond({ ok: false, error: "Crop inválido o demasiado grande." }, 400);
  }

  const detected = item as DetectedItem;
  const resolved = await resolveDetectionRequest({
    crop,
    item: detected,
    origin: req.nextUrl.origin,
    mode: body.matchingMode,
    videoKey,
    itemId,
    skipCache,
    detectionId: body.detectionId,
    timestampSeconds: body.timestampSeconds,
    forceExternal: body.forceExternal === true,
    analysisJobId: body.analysisJobId,
    mediaContentId: body.mediaContentId,
    globalProductId: body.globalProductId,
  });

  const { detection, catalogResult, externalResult, externalRan, mode } = resolved;

  /* ---------------- forma anterior de la respuesta (compat) ---------------- */
  // `match` / `similarCandidates` siguen existiendo para los consumidores que
  // aún no leen `detection`. Se derivan de los bloques YA separados, así que no
  // pueden contradecirlos: el del catálogo gana cuando el catálogo resolvió.
  const catalogVisual = catalogResult
    ? catalogResultToVisualMatch(catalogResult, detected)
    : null;
  const match =
    detection.catalog.status === "matched"
      ? catalogVisual
      : externalRan?.match ?? catalogVisual;
  const similarCandidates = externalRan?.similarCandidates?.length
    ? externalRan.similarCandidates
    : catalogResult
      ? catalogSimilarCandidates(catalogResult)
      : [];

  return respond({
    ok: true,
    status: legacyStatus(detection, externalRan),
    cached: Boolean(catalogResult?.cached ?? externalResult?.cached),
    match,
    similarCandidates,
    providerUsed:
      detection.catalog.status === "matched"
        ? "catalog"
        : externalResult?.providerUsed ?? catalogResult?.providerUsed ?? null,
    fallbackUsed: Boolean(externalResult?.fallbackUsed),
    calls: externalRan?.calls ?? [],
    timings: { ...resolved.usageTimings, totalMs: Date.now() - t0 },
    budget: budgetSnapshot(),
    detail: resolved.warnings.join(" | ") || externalRan?.detail,
    matchingMode: mode,
    matching: catalogOrExternalResult(catalogResult, externalResult, detection),
    detection,
  });
}

/**
 * Estado plano equivalente al de antes, derivado de los dos bloques.
 * `matched` exige un match fiable en ALGUNA fuente; los estados de error del
 * pipeline externo (presupuesto, storage) se conservan porque explican el
 * porqué mejor que un "no_match" genérico.
 */
function legacyStatus(
  detection: DetectionMatchResult,
  externalRan: OkBody | null
): OkBody["status"] {
  if (
    detection.catalog.status === "matched" ||
    detection.external.status === "matched"
  ) {
    return "matched";
  }
  if (
    detection.catalog.candidates.length > 0 ||
    detection.external.candidates.length > 0
  ) {
    return "similar_only";
  }
  if (
    externalRan &&
    (externalRan.status === "budget_exhausted" ||
      externalRan.status === "provider_error" ||
      externalRan.status === "storage_unavailable")
  ) {
    return externalRan.status;
  }
  return "no_match";
}

/**
 * `matching` legado: el resultado de la fuente que RESOLVIÓ. Si ninguna
 * resolvió, el del catálogo (es la fuente principal y sus candidatos son los
 * que la UI antigua debe preferir).
 */
function catalogOrExternalResult(
  catalogResult: ProductMatchingResult | null,
  externalResult: ProductMatchingResult | null,
  detection: DetectionMatchResult
): ProductMatchingResult | undefined {
  const chosen =
    detection.catalog.status === "matched"
      ? catalogResult
      : detection.external.status === "matched"
        ? externalResult
        : catalogResult ?? externalResult;
  if (!chosen) return undefined;
  return {
    ...chosen,
    matchingMode: detection.matchingMode,
    catalogAttempted: catalogResult != null,
    externalAttempted: externalResult != null,
    externalFallbackUsed:
      externalResult != null && detection.catalog.status !== "matched",
  };
}
