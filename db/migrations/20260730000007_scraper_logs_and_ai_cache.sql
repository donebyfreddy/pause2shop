-- Scraper modular: logs de ingesta por etapas, caché de extracciones por IA y
-- contabilidad de uso del modelo.
--
-- Los tres viven en la base de datos a propósito:
--  · los logs, porque en serverless el proceso muere y el admin necesita poder
--    reconstruir qué pasó en un job de hace una hora;
--  · la caché, porque es donde está el ahorro real (una ficha ya extraída no se
--    vuelve a pagar aunque cambie de invocación);
--  · el uso, porque "cuánto ha costado esto" no puede ser una estimación en
--    memoria que se pierde al reiniciar.

create table if not exists catalog_job_logs (
  id            uuid primary key,
  job_id        uuid,
  connector_id  text,
  level         text not null,
  stage         text not null,
  message       text not null,
  url           text,
  product_id    uuid,
  duration_ms   integer,
  retry         integer,
  metadata      jsonb,
  -- `seq` es el orden monótono DENTRO de una invocación: el streaming del admin
  -- lo usa como cursor para no repetir líneas ya enviadas.
  seq           bigint not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_job_logs_job on catalog_job_logs (job_id, created_at desc);
create index if not exists idx_job_logs_connector on catalog_job_logs (connector_id, created_at desc);
create index if not exists idx_job_logs_level on catalog_job_logs (level);
create index if not exists idx_job_logs_stage on catalog_job_logs (stage);
create index if not exists idx_job_logs_created on catalog_job_logs (created_at desc);
-- Búsqueda libre sobre el mensaje (lo que teclea el operador en el filtro).
create index if not exists idx_job_logs_message on catalog_job_logs using gin (to_tsvector('simple', message));

/**
 * Caché de extracciones por IA.
 *
 * `cache_key` es sha256(dominio|url|hash del DOM|versión de schema|modelo): al
 * cambiar cualquiera de los cinco, la clave cambia y se vuelve a extraer. Es la
 * política de invalidación completa, sin TTL que adivinar.
 */
create table if not exists catalog_ai_extractions (
  cache_key         text primary key,
  url               text not null,
  domain            text not null,
  dom_hash          text not null,
  model             text not null,
  schema_version    text not null,
  extraction        jsonb not null,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  cost_usd          numeric(12,6) not null default 0,
  /* Aciertos de caché: mide el ahorro real, no el teórico. */
  hits              integer not null default 0,
  created_at        timestamptz not null default now(),
  last_hit_at       timestamptz
);

create index if not exists idx_ai_extractions_url on catalog_ai_extractions (url);
create index if not exists idx_ai_extractions_domain on catalog_ai_extractions (domain, created_at desc);
create index if not exists idx_ai_extractions_model on catalog_ai_extractions (model);

/** Uso del modelo agregado por día, modelo y conector. */
create table if not exists catalog_ai_usage (
  id                bigserial primary key,
  day               date not null default current_date,
  model             text not null,
  connector_id      text,
  job_id            uuid,
  calls             integer not null default 0,
  cached_calls      integer not null default 0,
  prompt_tokens     bigint not null default 0,
  completion_tokens bigint not null default 0,
  cost_usd          numeric(12,6) not null default 0,
  updated_at        timestamptz not null default now(),
  unique (day, model, connector_id, job_id)
);

create index if not exists idx_ai_usage_day on catalog_ai_usage (day desc);
create index if not exists idx_ai_usage_connector on catalog_ai_usage (connector_id, day desc);
