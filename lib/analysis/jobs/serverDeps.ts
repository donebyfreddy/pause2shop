import { getObjectDetector } from "@/lib/detection";
import { resolveDetectionRequest } from "@/lib/matching/detectionPipeline";
import { decodeImageDataUrl } from "@/lib/visualSearch/storage";
import { noMatchResult } from "@/lib/matching/types";
import { getVideoAnalysisJobConfig } from "./config";
import { getAnalysisJobStore } from "./store";
import type { EmbedCropFn, JobEngineDeps, MatchProductFn } from "./engine";

/**
 * Wiring REAL del motor de jobs para los route handlers.
 *
 * CAMBIO IMPORTANTE respecto a la versión anterior: el matching por producto
 * ya NO se hace con `fetch(origin + "/api/vision/match-object")`.
 *
 * Aquel self-fetch parecía inocente —"reutilizo el endpoint tal cual"— y
 * costaba caro:
 *   - una petición HTTP y una invocación de función completas por producto,
 *     en serie: diez productos eran diez viajes encadenados;
 *   - un `AbortSignal.timeout` sobre la petición ENTERA, de modo que al saltar
 *     se tiraba también el resultado del catálogo que ya estaba calculado. Eso
 *     es lo que producía "0 catalog hits" con productos marcados
 *     `matching omitido: The operation was aborted due to timeout`;
 *   - y el servidor seguía trabajando después del abort, así que la búsqueda
 *     externa se pagaba igual sin que nadie la contabilizara.
 *
 * Ahora se llama a `resolveDetectionRequest` en proceso. Los presupuestos de
 * tiempo viven dentro del resolver y son POR FUENTE, así que agotar el del
 * catálogo ya no impide que Internet responda, ni al revés.
 */

/** Origen público del propio despliegue, para publicar crops si Storage cae. */
function selfOrigin(fallback: string): string {
  return (
    process.env.PUBLIC_MEDIA_BASE_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    fallback
  );
}

function buildMatchProduct(origin: string): MatchProductFn {
  return async ({
    jobId,
    mediaContentId,
    globalProductId,
    item,
    cropDataUrl,
    frameDataUrl,
    mode,
  }) => {
    // Sin crop del cliente se degrada al mejor FRAME completo (el pipeline
    // sigue funcionando, con menos precisión). Sin ninguno: NO_MATCH.
    const crop = cropDataUrl ?? frameDataUrl;
    if (!crop) {
      return {
        result: noMatchResult({
          warnings: ["Producto sin crop ni frame utilizable: matching omitido."],
        }),
        detection: null,
      };
    }

    const resolved = await resolveDetectionRequest({
      crop,
      item,
      origin,
      mode,
      videoKey: "analysis-job",
      analysisJobId: jobId,
      mediaContentId,
      globalProductId,
      detectionId: globalProductId,
    });

    // El resultado que se guarda es el de la fuente que resolvió; si ninguna
    // lo hizo, el del catálogo (que siempre se consulta salvo external_only).
    const result =
      resolved.detection.catalog.status === "matched"
        ? resolved.catalogResult
        : (resolved.externalResult ?? resolved.catalogResult);

    return {
      result:
        result ??
        noMatchResult({
          warnings: resolved.warnings.length ? resolved.warnings : undefined,
        }),
      detection: resolved.detection,
    };
  };
}

/**
 * Embedding del crop para el dedup global. Carga perezosa: el módulo de
 * embeddings arrastra CLIP y no debe entrar en el bundle de un route que no lo
 * use. Devuelve null en vez de lanzar — sin embedding el dedup degrada al hash
 * perceptual, que es peor pero no rompe.
 */
const embedCrop: EmbedCropFn = async (dataUrl) => {
  try {
    const decoded = decodeImageDataUrl(dataUrl);
    if (!decoded) return null;
    const { getEmbeddingProvider } = await import(
      "@/lib/catalogIngestion/embeddings"
    );
    const provider = await getEmbeddingProvider();
    // El provider `hash` produce vectores de 64 dimensiones derivados de los
    // píxeles. Sirven para detectar la MISMA imagen, no para decidir si dos
    // encuadres distintos son el mismo objeto — que es justo lo que se le
    // pediría aquí. Devolver null hace que el dedup use el hash perceptual
    // conscientemente, en vez de fiarse de un coseno que no significa nada.
    if (provider.name !== "local") return null;
    return await provider.embedImage(decoded.buffer);
  } catch (err) {
    console.warn("[analysis-job] crop_embedding_failed", {
      error: err instanceof Error ? err.message.slice(0, 160) : "unknown",
    });
    return null;
  }
};

/** Dependencias reales del motor para los route handlers. */
export function buildJobEngineDeps(origin: string): JobEngineDeps {
  const publicOrigin = selfOrigin(origin);
  return {
    store: getAnalysisJobStore(),
    detector: getObjectDetector(),
    matchProduct: buildMatchProduct(publicOrigin),
    embedCrop,
    config: getVideoAnalysisJobConfig(),
  };
}
