-- Identidad estable del vídeo, reutilización del pipeline VOD y candidatos
-- externos revisables. Internet nunca publica directamente en el catálogo.

alter table media_contents
  add column if not exists file_hash text,
  add column if not exists catalog_version text not null default 'catalog:v1',
  add column if not exists analysis_version text not null default 'video-pipeline:v2',
  add column if not exists processed_at timestamptz;

create index if not exists idx_media_contents_reusable_hash
  on media_contents (file_hash, catalog_version, analysis_version)
  where file_hash is not null;

alter table analysis_jobs
  add column if not exists job_type text not null default 'video_preprocess',
  add column if not exists retry_count integer not null default 0;

create table if not exists video_processing_jobs (
  id                uuid primary key default gen_random_uuid(),
  analysis_job_id   uuid references analysis_jobs(id) on delete cascade,
  job_type          text not null check (job_type in (
                      'video_preprocess','catalog_match','external_product_search',
                      'catalog_candidate_review','catalog_product_enrichment')),
  status            text not null default 'queued' check (status in (
                      'queued','running','completed','failed','cancelled')),
  idempotency_key   text not null unique,
  checkpoint        jsonb not null default '{}'::jsonb,
  logs              jsonb not null default '[]'::jsonb,
  retry_count       integer not null default 0,
  max_retries       integer not null default 3,
  error             text,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now()
);

create index if not exists idx_video_processing_jobs_analysis
  on video_processing_jobs (analysis_job_id, created_at);
create index if not exists idx_video_processing_jobs_status
  on video_processing_jobs (status, job_type, created_at);

create table if not exists external_product_candidates (
  id                  uuid primary key default gen_random_uuid(),
  candidate_key       text not null unique,
  analysis_job_id     uuid references analysis_jobs(id) on delete set null,
  media_content_id    uuid references media_contents(id) on delete set null,
  detected_item_id    uuid references detected_items(id) on delete set null,
  global_product_id   text,
  title               text not null,
  brand               text,
  image_url           text not null,
  merchant            text,
  price               double precision,
  currency            text,
  product_url         text not null,
  category            text,
  visual_score        double precision not null default 0,
  commercial_score    double precision not null default 0,
  final_score         double precision not null default 0,
  provider            text not null,
  status              text not null default 'external_candidate' check (status in (
                        'external_candidate','review_required','approved','rejected','published')),
  source_page         text,
  original_image_url  text,
  origin_crop_url     text,
  evidence            jsonb not null default '[]'::jsonb,
  attributes          jsonb not null default '{}'::jsonb,
  raw_result          jsonb not null default '{}'::jsonb,
  queried_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  reviewed_by         text,
  catalog_product_id  uuid references catalog_products(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_external_candidates_review
  on external_product_candidates (status, final_score desc, created_at desc);
create index if not exists idx_external_candidates_video
  on external_product_candidates (media_content_id, global_product_id);

create table if not exists video_product_occurrences (
  id                    bigserial primary key,
  media_content_id      uuid not null references media_contents(id) on delete cascade,
  analysis_job_id       uuid not null references analysis_jobs(id) on delete cascade,
  global_product_id     text not null,
  first_seen_at         double precision not null,
  last_seen_at          double precision not null,
  timestamps            jsonb not null default '[]'::jsonb,
  scene_ids             jsonb not null default '[]'::jsonb,
  best_frame_id         text,
  best_crop_id          text,
  catalog_product_id    uuid references catalog_products(id) on delete set null,
  external_candidate_id uuid references external_product_candidates(id) on delete set null,
  confidence            double precision not null default 0,
  created_at            timestamptz not null default now(),
  unique (analysis_job_id, global_product_id)
);

create index if not exists idx_video_occurrences_timestamp
  on video_product_occurrences (media_content_id, first_seen_at, last_seen_at);

create table if not exists unresolved_video_products (
  id                  uuid primary key default gen_random_uuid(),
  media_content_id    uuid not null references media_contents(id) on delete cascade,
  analysis_job_id     uuid not null references analysis_jobs(id) on delete cascade,
  global_product_id   text not null,
  canonical_label     text not null,
  category            text not null,
  attributes          jsonb not null default '{}'::jsonb,
  best_crop_url       text,
  embedding           jsonb,
  external_candidates jsonb not null default '[]'::jsonb,
  status              text not null default 'unresolved' check (status in (
                        'unresolved','candidate_found','review_required')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (analysis_job_id, global_product_id)
);
