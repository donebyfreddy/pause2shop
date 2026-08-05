import { isDatabaseConfigured, query } from "@/lib/db/pool";

/**
 * CATÁLOGO POR VÍDEO Y TIMESTAMP.
 *
 * "¿Qué productos están activos en el segundo 47 de este vídeo?" es la
 * consulta que justifica todo el pipeline: es la que responde una pausa.
 *
 * Se resuelve contra `video_product_occurrences`, que guarda una fila por
 * PRODUCTO ÚNICO con su rango de aparición. La alternativa —recorrer las
 * apariciones y agrupar— exigiría leer el estado de runtime completo del job
 * (que incluye el tracker serializado y todas las apariciones) para contestar
 * una pregunta puntual.
 *
 * El rango [first_seen_at, last_seen_at] usa el índice
 * `idx_video_occurrences_timestamp`. Es un rango CONTINUO: un producto que
 * aparece, desaparece y vuelve cuenta como presente en el hueco. Para
 * distinguirlo hace falta mirar `timestamps`, que se devuelve para que quien
 * llame pueda afinar si lo necesita.
 */

export type ProductAtTimestamp = {
  globalProductId: string;
  analysisJobId: string;
  canonicalLabel: string;
  canonicalCategory: string;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  timestampsMs: number[];
  sceneIds: string[];
  seenCount: number;
  matchStatus: string;
  editorialStatus: string;
  catalogProductId: string | null;
  externalCandidateId: string | null;
  confidence: number;
  /** El timestamp consultado cae en una aparición REAL, no solo en el rango. */
  exactAppearance: boolean;
};

type Row = {
  global_product_id: string;
  analysis_job_id: string;
  canonical_label: string;
  canonical_category: string;
  first_seen_at: number;
  last_seen_at: number;
  timestamps: number[] | null;
  scene_ids: string[] | null;
  seen_count: number;
  match_status: string;
  editorial_status: string;
  catalog_product_id: string | null;
  external_candidate_id: string | null;
  confidence: number;
};

/** Tolerancia por defecto: media ventana de muestreo a 5 fps. */
const DEFAULT_TOLERANCE_SECONDS = 0.25;

export async function findProductsAtTimestamp(args: {
  /** SHA-256 del vídeo. Identifica el contenido, no una ejecución concreta. */
  videoHash: string;
  timestampMs: number;
  toleranceSeconds?: number;
  /** Solo lo publicable. Por defecto se devuelve todo con su estado. */
  editorialStatus?: string;
}): Promise<ProductAtTimestamp[]> {
  if (!isDatabaseConfigured()) return [];
  const seconds = args.timestampMs / 1000;
  const tolerance = args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  const res = await query<Row>(
    `select o.global_product_id, o.analysis_job_id, o.canonical_label,
            o.canonical_category, o.first_seen_at, o.last_seen_at, o.timestamps,
            o.scene_ids, o.seen_count, o.match_status, o.editorial_status,
            o.catalog_product_id::text as catalog_product_id,
            o.external_candidate_id::text as external_candidate_id, o.confidence
       from video_product_occurrences o
       join media_contents m on m.id = o.media_content_id
      where m.file_hash = $1
        and o.first_seen_at <= $2
        and o.last_seen_at >= $3
        and ($4::text is null or o.editorial_status = $4)
      order by o.first_seen_at`,
    [
      args.videoHash,
      seconds + tolerance,
      seconds - tolerance,
      args.editorialStatus ?? null,
    ]
  );

  return res.rows.map((r) => {
    const timestamps = (r.timestamps ?? []).map((t) => Math.round(t * 1000));
    return {
      globalProductId: r.global_product_id,
      analysisJobId: r.analysis_job_id,
      canonicalLabel: r.canonical_label,
      canonicalCategory: r.canonical_category,
      firstSeenAtMs: Math.round(r.first_seen_at * 1000),
      lastSeenAtMs: Math.round(r.last_seen_at * 1000),
      timestampsMs: timestamps,
      sceneIds: r.scene_ids ?? [],
      seenCount: r.seen_count,
      matchStatus: r.match_status,
      editorialStatus: r.editorial_status,
      catalogProductId: r.catalog_product_id,
      externalCandidateId: r.external_candidate_id,
      confidence: r.confidence,
      exactAppearance: timestamps.some(
        (t) => Math.abs(t - args.timestampMs) <= tolerance * 1000
      ),
    };
  });
}
