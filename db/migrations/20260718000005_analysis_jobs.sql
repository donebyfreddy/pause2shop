-- Jobs de análisis asíncrono de vídeo subido (Parte 3).
--
-- Dos niveles de persistencia:
--   * analysis_jobs.runtime_state (jsonb): verdad operativa del motor
--     (tracker serializado, escenas, apariciones) — lo que un worker lee para
--     REANUDAR un job desde su checkpoint. El estado nunca vive en memoria
--     del route handler, lo que permite múltiples workers en el futuro.
--   * Tablas normalizadas (media_scenes, item_tracks, item_appearances,
--     product_matches, external_search_results): nivel analítico, escrito al
--     finalizar el job. media_frames guarda SOLO metadata (nunca data URLs).

-- Vídeo subido (metadata declarada por el cliente; el binario no viaja al servidor).
create table if not exists media_contents (
  id               uuid primary key default gen_random_uuid(),
  file_name        text not null default '',
  mime_type        text not null default '',
  size_bytes       bigint not null default 0,
  duration_seconds double precision not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists analysis_jobs (
  id               uuid primary key default gen_random_uuid(),
  media_content_id uuid not null references media_contents(id) on delete cascade,
  status           text not null default 'queued'
                   check (status in ('queued','running','partially_completed','completed','failed','cancelled')),
  matching_mode    text not null default 'external-only',
  analysis_config  jsonb not null default '{}'::jsonb,
  checkpoint       jsonb not null default '{}'::jsonb,
  counters         jsonb not null default '{}'::jsonb,
  timings          jsonb not null default '{}'::jsonb,
  warnings         jsonb not null default '[]'::jsonb,
  error            text,
  runtime_state    jsonb,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

create index if not exists idx_analysis_jobs_media
  on analysis_jobs (media_content_id, created_at desc);
create index if not exists idx_analysis_jobs_status
  on analysis_jobs (status, created_at desc);

-- Metadata de frames recibidos (checkpoint auditable; sin píxeles).
create table if not exists media_frames (
  id                bigserial primary key,
  job_id            uuid not null references analysis_jobs(id) on delete cascade,
  timestamp_seconds double precision not null,
  analyzed          boolean not null default false,
  scene_id          integer,
  created_at        timestamptz not null default now()
);

-- Índice contentId+timestamp (vía job → media) para timeline y reanudación.
create index if not exists idx_media_frames_job_ts
  on media_frames (job_id, timestamp_seconds);
create index if not exists idx_media_frames_scene
  on media_frames (job_id, scene_id);

create table if not exists media_scenes (
  id            bigserial primary key,
  job_id        uuid not null references analysis_jobs(id) on delete cascade,
  scene_id      integer not null,
  start_seconds double precision not null,
  end_seconds   double precision not null,
  frame_count   integer not null default 0,
  unique (job_id, scene_id)
);

create index if not exists idx_media_scenes_job
  on media_scenes (job_id, start_seconds);

create table if not exists item_tracks (
  id                  bigserial primary key,
  job_id              uuid not null references analysis_jobs(id) on delete cascade,
  track_id            text not null,
  category            text not null default '',
  name                text not null default '',
  color               text,
  first_seen_seconds  double precision not null,
  last_seen_seconds   double precision not null,
  seen_frame_count    integer not null default 0,
  confidence          double precision not null default 0,
  best_crop           jsonb not null default '{}'::jsonb,
  representative_item jsonb not null default '{}'::jsonb,
  unique (job_id, track_id)
);

create index if not exists idx_item_tracks_job
  on item_tracks (job_id, track_id);

create table if not exists item_appearances (
  id                bigserial primary key,
  job_id            uuid not null references analysis_jobs(id) on delete cascade,
  track_id          text not null,
  timestamp_seconds double precision not null,
  scene_id          integer,
  box               jsonb,
  confidence        double precision not null default 0
);

create index if not exists idx_item_appearances_job_ts
  on item_appearances (job_id, timestamp_seconds);
create index if not exists idx_item_appearances_track
  on item_appearances (job_id, track_id);
create index if not exists idx_item_appearances_scene
  on item_appearances (job_id, scene_id);

-- Productos ÚNICOS tras dedup global + su resultado de matching.
create table if not exists product_matches (
  id                      bigserial primary key,
  job_id                  uuid not null references analysis_jobs(id) on delete cascade,
  product_id              text not null,
  track_ids               jsonb not null default '[]'::jsonb,
  item                    jsonb not null default '{}'::jsonb,
  best_crop               jsonb not null default '{}'::jsonb,
  segments                jsonb not null default '[]'::jsonb,
  matching                jsonb,
  external_searches_used  integer not null default 0,
  skipped_reason          text,
  created_at              timestamptz not null default now(),
  unique (job_id, product_id)
);

create index if not exists idx_product_matches_job
  on product_matches (job_id);

-- Resultados de búsqueda externa por producto (auditoría de coste).
create table if not exists external_search_results (
  id         bigserial primary key,
  job_id     uuid not null references analysis_jobs(id) on delete cascade,
  product_id text not null,
  provider   text not null default '',
  result     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_external_search_results_job
  on external_search_results (job_id, product_id);
