-- Pause2Shop — catálogo interno de elementos detectados.
-- Compatible con Supabase (supabase db push) y con cualquier Postgres
-- (npm run db:migrate). Idempotente: se puede aplicar varias veces.
--
-- Diseño:
--   video_sources  1───*  analyzed_frames
--   video_sources  1───*  detected_items  *───1  analyzed_frames
--   detected_items 1───*  product_recommendations
--   detected_items 1───*  item_feedback   *───0..1 product_recommendations
--
-- Deduplicación: detected_items.fingerprint es UNIQUE. El fingerprint incluye
-- video + categoría + color + estilo + marca + bucket de timestamp, de modo que
-- el mismo objeto en timestamps cercanos colapsa en una sola fila (ON CONFLICT).

create extension if not exists pgcrypto;

-- Función reutilizable para mantener updated_at.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- video_sources
-- ---------------------------------------------------------------------------
create table if not exists video_sources (
  id            uuid primary key default gen_random_uuid(),
  title         text,
  url           text,
  source_type   text not null
                  check (source_type in ('uploaded', 'youtube', 'screen_capture', 'external_url')),
  -- Clave natural estable para upsert (p.ej. id de YouTube o "local:fichero.mp4").
  external_key  text not null unique,
  duration_seconds numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_video_sources_updated_at on video_sources;
create trigger trg_video_sources_updated_at
  before update on video_sources
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- analyzed_frames
-- ---------------------------------------------------------------------------
create table if not exists analyzed_frames (
  id               uuid primary key default gen_random_uuid(),
  video_id         uuid not null references video_sources(id) on delete cascade,
  timestamp_seconds numeric not null default 0,
  -- imageUrl (Storage) y/o miniatura embebida (data URL) — ambas opcionales.
  image_url        text,
  thumb_data_url   text,
  scene_summary    text,
  style_vibe       text,
  analysis_status  text not null default 'completed'
                     check (analysis_status in ('pending', 'completed', 'failed')),
  source_type      text,
  raw_vision_response jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_frames_video on analyzed_frames(video_id);
create index if not exists idx_frames_created on analyzed_frames(created_at desc);

-- ---------------------------------------------------------------------------
-- detected_items
-- ---------------------------------------------------------------------------
create table if not exists detected_items (
  id                uuid primary key default gen_random_uuid(),
  video_id          uuid not null references video_sources(id) on delete cascade,
  frame_id          uuid references analyzed_frames(id) on delete set null,
  source_type       text,
  source_url        text,
  timestamp_seconds numeric not null default 0,
  timestamp_bucket  integer not null default 0,
  -- Huella para deduplicación (ver generateItemFingerprint en el código).
  fingerprint       text not null unique,
  type              text,
  category          text not null default 'general',
  subcategory       text,
  name              text not null,
  description       text,
  color             text,
  secondary_colors  text[] not null default '{}',
  style             text,
  pattern           text,
  material_guess    text,
  gender_fit        text,
  visible_brand     text,
  confidence        real not null default 0,
  search_query      text,
  marketplace_keywords text[] not null default '{}',
  bounding_box      jsonb,
  image_crop_url    text,
  frame_image_url   text,
  status            text not null default 'detected'
                      check (status in ('detected', 'reviewed', 'matched', 'ignored')),
  -- Nº de veces que se ha vuelto a ver el mismo objeto (incrementa en dedupe).
  detection_count   integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_items_video on detected_items(video_id);
create index if not exists idx_items_status on detected_items(status);
create index if not exists idx_items_category on detected_items(lower(category));
create index if not exists idx_items_type on detected_items(type);
create index if not exists idx_items_created on detected_items(created_at desc);

drop trigger if exists trg_detected_items_updated_at on detected_items;
create trigger trg_detected_items_updated_at
  before update on detected_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- product_recommendations
-- ---------------------------------------------------------------------------
create table if not exists product_recommendations (
  id               uuid primary key default gen_random_uuid(),
  detected_item_id uuid not null references detected_items(id) on delete cascade,
  provider         text not null,
  title            text not null,
  product_url      text not null,
  image_url        text,
  price            numeric,
  currency         text,
  brand            text,
  similarity_score real,
  reason           text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_recs_item on product_recommendations(detected_item_id);

-- ---------------------------------------------------------------------------
-- item_feedback
-- ---------------------------------------------------------------------------
create table if not exists item_feedback (
  id                uuid primary key default gen_random_uuid(),
  detected_item_id  uuid not null references detected_items(id) on delete cascade,
  recommendation_id uuid references product_recommendations(id) on delete set null,
  action            text not null
                      check (action in ('clicked', 'saved', 'rejected', 'purchased', 'ignored')),
  created_at        timestamptz not null default now()
);

create index if not exists idx_feedback_item on item_feedback(detected_item_id);
