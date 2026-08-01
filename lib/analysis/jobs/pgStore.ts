import { query, withTransaction } from "@/lib/db/pool";
import type { AnalysisJobStore, FrameMetaRow } from "./store";
import type {
  AnalysisJobRecord,
  AnalysisJobStatus,
  JobRuntimeState,
  UniqueProductRecord,
} from "./types";

/**
 * Store de jobs sobre Postgres (migración 20260718000005_analysis_jobs.sql).
 *
 * Modelo de persistencia en dos niveles:
 *  - Nivel operativo (verdad del motor): la fila de analysis_jobs con
 *    checkpoint/counters/timings + runtime_state jsonb (tracker serializado,
 *    escenas, apariciones). Es lo que un worker lee para REANUDAR.
 *  - Nivel analítico (consultas/BI/UI futura): filas normalizadas en
 *    media_scenes, item_tracks, item_appearances, product_matches y
 *    external_search_results, escritas al finalizar (best-effort). Los data
 *    URLs de frames NO se guardan (media_frames solo lleva metadata).
 */
export class PostgresAnalysisJobStore implements AnalysisJobStore {
  readonly kind = "postgres" as const;

  async createJob(job: AnalysisJobRecord, state: JobRuntimeState): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `insert into media_contents
           (id, file_name, mime_type, size_bytes, duration_seconds, file_hash,
            catalog_version, analysis_version, processed_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, null, to_timestamp($9 / 1000.0))
         on conflict (id) do nothing`,
        [
          job.media.id,
          job.media.fileName,
          job.media.mimeType,
          job.media.sizeBytes,
          job.media.durationSeconds,
          job.media.fileHash,
          job.media.catalogVersion,
          job.media.analysisVersion,
          job.media.createdAt,
        ]
      );
      await client.query(
        `insert into analysis_jobs
           (id, media_content_id, status, matching_mode, analysis_config,
            checkpoint, counters, timings, warnings, error, runtime_state,
            created_at, started_at, finished_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 to_timestamp($12 / 1000.0), null, null)`,
        [
          job.id,
          job.media.id,
          job.status,
          job.matchingMode,
          JSON.stringify(job.analysisConfig),
          JSON.stringify(job.checkpoint),
          JSON.stringify(job.counters),
          JSON.stringify(job.timings),
          JSON.stringify(job.warnings),
          job.error,
          JSON.stringify(state),
          job.createdAt,
        ]
      );
      const jobTypes = [
        "video_preprocess",
        "catalog_match",
        "external_product_search",
        "catalog_candidate_review",
        "catalog_product_enrichment",
      ];
      for (const jobType of jobTypes) {
        await client.query(
          `insert into video_processing_jobs
             (analysis_job_id, job_type, idempotency_key, checkpoint)
           values ($1, $2, $3, '{}'::jsonb)
           on conflict (idempotency_key) do nothing`,
          [job.id, jobType, `${job.id}:${jobType}`]
        );
      }
    });
  }

  async getJob(id: string): Promise<AnalysisJobRecord | null> {
    const res = await query<{
      id: string;
      status: AnalysisJobStatus;
      matching_mode: string;
      analysis_config: AnalysisJobRecord["analysisConfig"];
      checkpoint: AnalysisJobRecord["checkpoint"];
      counters: AnalysisJobRecord["counters"];
      timings: AnalysisJobRecord["timings"];
      warnings: string[];
      error: string | null;
      created_at: Date;
      started_at: Date | null;
      finished_at: Date | null;
      media_id: string;
      file_name: string;
      mime_type: string;
      size_bytes: string | number;
      duration_seconds: number;
      media_created_at: Date;
      file_hash: string | null;
      catalog_version: string;
      analysis_version: string;
      processed_at: Date | null;
    }>(
      `select j.*, m.id as media_id, m.file_name, m.mime_type, m.size_bytes,
              m.duration_seconds, m.file_hash, m.catalog_version,
              m.analysis_version, m.processed_at,
              m.created_at as media_created_at
         from analysis_jobs j
         join media_contents m on m.id = j.media_content_id
        where j.id = $1`,
      [id]
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      status: r.status,
      matchingMode: r.matching_mode as AnalysisJobRecord["matchingMode"],
      analysisConfig: r.analysis_config,
      checkpoint: r.checkpoint,
      counters: r.counters,
      timings: r.timings,
      warnings: r.warnings ?? [],
      error: r.error,
      createdAt: r.created_at.getTime(),
      startedAt: r.started_at ? r.started_at.getTime() : null,
      finishedAt: r.finished_at ? r.finished_at.getTime() : null,
      media: {
        id: r.media_id,
        fileName: r.file_name,
        mimeType: r.mime_type,
        sizeBytes: Number(r.size_bytes),
        durationSeconds: r.duration_seconds,
        fileHash: r.file_hash,
        catalogVersion: r.catalog_version,
        analysisVersion: r.analysis_version,
        processedAt: r.processed_at ? r.processed_at.getTime() : null,
        createdAt: r.media_created_at.getTime(),
      },
    };
  }

  async updateJob(job: AnalysisJobRecord): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
      `update analysis_jobs
          set status = $2, checkpoint = $3, counters = $4, timings = $5,
              warnings = $6, error = $7,
              started_at = case when $8::bigint is null then null else to_timestamp($8::bigint / 1000.0) end,
              finished_at = case when $9::bigint is null then null else to_timestamp($9::bigint / 1000.0) end
        where id = $1`,
      [
        job.id,
        job.status,
        JSON.stringify(job.checkpoint),
        JSON.stringify(job.counters),
        JSON.stringify(job.timings),
        JSON.stringify(job.warnings),
        job.error,
        job.startedAt,
        job.finishedAt,
      ]
      );
      await client.query(
        `update media_contents
            set processed_at = case when $2::bigint is null then null
                                    else to_timestamp($2::bigint / 1000.0) end
          where id = $1`,
        [job.media.id, job.media.processedAt]
      );
      await client.query(
        `update video_processing_jobs
            set status = case
              when $2 in ('completed','partially_completed') then 'completed'
              when $2 = 'cancelled' then 'cancelled'
              when $2 = 'failed' then 'failed'
              when $2 = 'running' then 'running'
              else status end,
              started_at = case when $2 = 'running' then coalesce(started_at, now()) else started_at end,
              finished_at = case when $2 in ('completed','partially_completed','cancelled','failed') then now() else finished_at end,
              checkpoint = $3, updated_at = now()
          where analysis_job_id = $1 and job_type = 'video_preprocess'`,
        [job.id, job.status, JSON.stringify(job.checkpoint)]
      );
    });
  }

  async getRuntimeState(id: string): Promise<JobRuntimeState | null> {
    const res = await query<{ runtime_state: JobRuntimeState | null }>(
      "select runtime_state from analysis_jobs where id = $1",
      [id]
    );
    return res.rows[0]?.runtime_state ?? null;
  }

  async saveRuntimeState(id: string, state: JobRuntimeState): Promise<void> {
    await query("update analysis_jobs set runtime_state = $2 where id = $1", [
      id,
      JSON.stringify(state),
    ]);
  }

  async recordFrames(id: string, rows: FrameMetaRow[]): Promise<void> {
    if (!rows.length) return;
    // Insert multi-values en una sola query (lotes pequeños, ≤ ~25 frames).
    const values: unknown[] = [id];
    const tuples = rows.map((row, i) => {
      const base = i * 3 + 2;
      values.push(row.timestampSeconds, row.analyzed, row.sceneId);
      return `($1, $${base}, $${base + 1}, $${base + 2})`;
    });
    await query(
      `insert into media_frames (job_id, timestamp_seconds, analyzed, scene_id)
       values ${tuples.join(", ")}`,
      values
    );
  }

  async saveProducts(id: string, products: UniqueProductRecord[]): Promise<void> {
    const state = await this.getRuntimeState(id);
    await withTransaction(async (client) => {
      // Reemplazo idempotente: finalize puede reintentarse tras un fallo.
      await client.query("delete from product_matches where job_id = $1", [id]);
      await client.query("delete from external_search_results where job_id = $1", [id]);
      await client.query("delete from video_product_occurrences where analysis_job_id = $1", [id]);
      await client.query("delete from unresolved_video_products where analysis_job_id = $1", [id]);
      await client.query("delete from media_scenes where job_id = $1", [id]);
      await client.query("delete from item_appearances where job_id = $1", [id]);
      await client.query("delete from item_tracks where job_id = $1", [id]);

      for (const scene of state?.scenes ?? []) {
        await client.query(
          `insert into media_scenes (job_id, scene_id, start_seconds, end_seconds, frame_count)
           values ($1, $2, $3, $4, $5)`,
          [id, scene.sceneId, scene.startSeconds, scene.endSeconds, scene.frameCount]
        );
      }
      for (const track of Object.values(state?.tracks ?? {})) {
        await client.query(
          `insert into item_tracks
             (job_id, track_id, category, name, color, first_seen_seconds,
              last_seen_seconds, seen_frame_count, confidence, best_crop, representative_item)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            track.trackId,
            track.category,
            track.name,
            track.color,
            track.firstSeenSeconds,
            track.lastSeenSeconds,
            track.seenFrameCount,
            track.confidence,
            // El data URL del mejor frame puede pesar cientos de KB: en las
            // filas analíticas se guarda la metadata del crop SIN los data URLs.
            JSON.stringify({ ...track.bestCrop, frameDataUrl: null, cropDataUrl: null }),
            JSON.stringify(track.representativeItem),
          ]
        );
      }
      for (const app of state?.appearances ?? []) {
        await client.query(
          `insert into item_appearances (job_id, track_id, timestamp_seconds, scene_id, box, confidence)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            app.trackId,
            app.timestampSeconds,
            app.sceneId,
            app.box ? JSON.stringify(app.box) : null,
            app.confidence,
          ]
        );
      }
      for (const p of products) {
        await client.query(
          `insert into product_matches
             (job_id, product_id, track_ids, item, best_crop, segments,
              matching, external_searches_used, skipped_reason)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            p.productId,
            JSON.stringify(p.trackIds),
            JSON.stringify(p.item),
            JSON.stringify({ ...p.bestCrop, frameDataUrl: null, cropDataUrl: null }),
            JSON.stringify(p.segments),
            p.matching ? JSON.stringify(p.matching) : null,
            p.externalSearchesUsed,
            p.matchingSkippedReason,
          ]
        );
        for (const match of p.matching?.matches ?? []) {
          if (match.source !== "external") continue;
          await client.query(
            `insert into external_search_results (job_id, product_id, provider, result)
             values ($1, $2, $3, $4)`,
            [id, p.productId, match.provider, JSON.stringify(match)]
          );
        }

        const appearances = (state?.appearances ?? []).filter((appearance) =>
          p.trackIds.includes(appearance.trackId)
        );
        const timestamps = [...new Set(appearances.map((appearance) => appearance.timestampSeconds))]
          .sort((a, b) => a - b);
        const sceneIds = [...new Set(appearances.map((appearance) => appearance.sceneId))]
          .sort((a, b) => a - b);
        const catalogProductId =
          p.matching?.matches.find((match) => match.source === "catalog")?.productId ?? null;
        await client.query(
          `insert into video_product_occurrences
             (media_content_id, analysis_job_id, global_product_id, first_seen_at,
              last_seen_at, timestamps, scene_ids, best_frame_id, best_crop_id,
              catalog_product_id, external_candidate_id, confidence)
           select j.media_content_id, $1, $2, $3, $4, $5, $6, $7, $8, $9,
                  (select c.id from external_product_candidates c
                    where c.analysis_job_id = $1 and c.global_product_id = $2
                    order by c.final_score desc limit 1),
                  $10
             from analysis_jobs j where j.id = $1`,
          [
            id,
            p.productId,
            timestamps[0] ?? p.segments[0]?.startSeconds ?? p.bestCrop.timestampSeconds,
            timestamps.at(-1) ?? p.segments.at(-1)?.endSeconds ?? p.bestCrop.timestampSeconds,
            JSON.stringify(timestamps),
            JSON.stringify(sceneIds.map(String)),
            `${p.bestCrop.timestampSeconds.toFixed(3)}`,
            p.bestCrop.signatureHash ?? `${p.productId}:crop`,
            catalogProductId,
            p.item.confidence,
          ]
        );

        if (!catalogProductId) {
          const externalCandidates = (p.matching?.matches ?? [])
            .filter((match) => match.source === "external")
            .map((match) => ({
              title: match.title,
              imageUrl: match.imageUrl,
              productUrl: match.productUrl,
              provider: match.provider,
              finalScore: match.scores.finalScore,
            }));
          await client.query(
            `insert into unresolved_video_products
               (media_content_id, analysis_job_id, global_product_id,
                canonical_label, category, attributes, best_crop_url,
                external_candidates, status)
             select j.media_content_id, $1, $2, $3, $4, $5, $6, $7, $8
               from analysis_jobs j where j.id = $1`,
            [
              id,
              p.productId,
              p.item.name,
              p.item.category,
              JSON.stringify({
                color: p.item.color ?? null,
                style: p.item.style ?? null,
                subcategory: p.item.subcategory ?? null,
                visibleBrand: p.item.visible_brand ?? null,
              }),
              p.bestCrop.cropDataUrl,
              JSON.stringify(externalCandidates),
              externalCandidates.length > 0 ? "review_required" : "unresolved",
            ]
          );
        }
      }
      const hasExternal = products.some((product) => product.externalSearchesUsed > 0);
      const hasCandidates = products.some((product) =>
        product.matching?.matches.some((match) => match.source === "external")
      );
      await client.query(
        `update video_processing_jobs
            set status = case
              when job_type = 'catalog_match' then 'completed'
              when job_type = 'external_product_search' and $2 then 'completed'
              when job_type = 'external_product_search' then 'cancelled'
              when job_type = 'catalog_candidate_review' and $3 then 'queued'
              when job_type = 'catalog_candidate_review' then 'cancelled'
              when job_type = 'catalog_product_enrichment' then 'queued'
              else status end,
              finished_at = case
                when job_type in ('catalog_match','external_product_search') then now()
                else finished_at end,
              updated_at = now()
          where analysis_job_id = $1 and job_type <> 'video_preprocess'`,
        [id, hasExternal, hasCandidates]
      );
    });
  }

  async getProducts(id: string): Promise<UniqueProductRecord[]> {
    const res = await query<{
      product_id: string;
      track_ids: string[];
      item: UniqueProductRecord["item"];
      best_crop: UniqueProductRecord["bestCrop"];
      segments: UniqueProductRecord["segments"];
      matching: UniqueProductRecord["matching"];
      external_searches_used: number;
      skipped_reason: string | null;
    }>(
      `select product_id, track_ids, item, best_crop, segments, matching,
              external_searches_used, skipped_reason
         from product_matches where job_id = $1 order by product_id`,
      [id]
    );
    return res.rows.map((r) => ({
      productId: r.product_id,
      trackIds: r.track_ids,
      item: r.item,
      bestCrop: r.best_crop,
      segments: r.segments,
      matching: r.matching,
      externalSearchesUsed: r.external_searches_used,
      matchingSkippedReason: r.skipped_reason,
    }));
  }

  async findReusableJob(
    fileHash: string,
    catalogVersion: string,
    analysisVersion: string
  ): Promise<AnalysisJobRecord | null> {
    const result = await query<{ id: string }>(
      `select j.id
         from analysis_jobs j
         join media_contents m on m.id = j.media_content_id
        where m.file_hash = $1 and m.catalog_version = $2 and m.analysis_version = $3
          and j.status in ('completed', 'partially_completed')
        order by j.finished_at desc nulls last limit 1`,
      [fileHash, catalogVersion, analysisVersion]
    );
    return result.rows[0] ? this.getJob(result.rows[0].id) : null;
  }

  async listJobs(limit = 100): Promise<AnalysisJobRecord[]> {
    const result = await query<{ id: string }>(
      "select id from analysis_jobs order by created_at desc limit $1",
      [Math.min(limit, 500)]
    );
    const jobs = await Promise.all(result.rows.map((row) => this.getJob(row.id)));
    return jobs.filter((job): job is AnalysisJobRecord => job != null);
  }
}
