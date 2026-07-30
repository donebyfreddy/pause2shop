-- Esquema base del catálogo. Los embeddings usan pgvector si la extensión
-- está disponible; si no, columnas jsonb de fallback (mismo dato, sin índice
-- vectorial). El DO block detecta la disponibilidad en tiempo de migración.

-- Intento de habilitar pgvector: en Supabase/imagen pgvector existe; en un
-- Postgres pelado puede no estar instalada y no debe romper la migración.
do $$
begin
  begin
    execute 'create extension if not exists vector';
  exception when others then
    raise notice 'pgvector no disponible: se usaran columnas jsonb de fallback';
  end;
end $$;

create table if not exists catalog_sources (
  id            text primary key,
  paused        boolean not null default false,
  last_sync_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists catalog_products (
  id                 uuid primary key,
  source             text not null,
  source_product_id  text not null,
  canonical_url      text not null,
  brand              text,
  title              text not null,
  category           text,
  availability       text not null default 'unknown',
  sku                text,
  gtin               text,
  content_hash       text,
  perceptual_hash    text,
  is_active          boolean not null default true,
  origin             text not null default 'scraped',
  -- El documento completo (variantes, tallas, metadata…) vive en jsonb para
  -- que el modelo evolucione sin una migración por campo. Las columnas de
  -- arriba existen solo porque se filtran/indexan.
  doc                jsonb not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Columnas de embedding: vector si hay pgvector, jsonb si no. La DIMENSIÓN
-- no se fija aquí: la define el provider activo (scripts/migrate.ts tipa la
-- columna y crea el índice ivfflat leyendo la dimensión real del provider).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'alter table catalog_products add column if not exists image_embedding vector';
    execute 'alter table catalog_products add column if not exists text_embedding vector';
  else
    execute 'alter table catalog_products add column if not exists image_embedding jsonb';
    execute 'alter table catalog_products add column if not exists text_embedding jsonb';
  end if;
end $$;

create unique index if not exists idx_products_source_pid on catalog_products (source, source_product_id);
create index if not exists idx_products_canonical_url on catalog_products (canonical_url);
create index if not exists idx_products_sku on catalog_products (sku) where sku is not null;
create index if not exists idx_products_gtin on catalog_products (gtin) where gtin is not null;
create index if not exists idx_products_content_hash on catalog_products (content_hash);
create index if not exists idx_products_perceptual_hash on catalog_products (perceptual_hash);
create index if not exists idx_products_category on catalog_products (category);
create index if not exists idx_products_brand on catalog_products (brand);
create index if not exists idx_products_availability on catalog_products (availability);
create index if not exists idx_products_origin on catalog_products (origin);

create table if not exists catalog_product_variants (
  id          bigserial primary key,
  product_id  uuid not null references catalog_products(id) on delete cascade,
  color       text,
  size        text,
  sku         text,
  price       numeric(12,2),
  currency    text,
  availability text not null default 'unknown'
);
create index if not exists idx_variants_product on catalog_product_variants (product_id);
create index if not exists idx_variants_sku on catalog_product_variants (sku) where sku is not null;

create table if not exists catalog_product_images (
  id              bigserial primary key,
  product_id      uuid not null references catalog_products(id) on delete cascade,
  url             text not null,
  local_path      text,
  sha256          text,
  perceptual_hash text,
  width           int,
  height          int,
  created_at      timestamptz not null default now(),
  unique (product_id, sha256)
);
create index if not exists idx_images_sha256 on catalog_product_images (sha256);
create index if not exists idx_images_phash on catalog_product_images (perceptual_hash);

create table if not exists catalog_prices (
  id              bigserial primary key,
  product_id      uuid not null references catalog_products(id) on delete cascade,
  price           numeric(12,2) not null,
  original_price  numeric(12,2),
  currency        text not null,
  recorded_at     timestamptz not null default now()
);
create index if not exists idx_prices_product on catalog_prices (product_id, recorded_at desc);
-- Jobs de sincronización, errores, uso de proveedores y auditoría.

create table if not exists catalog_sync_jobs (
  job_id      uuid primary key,
  type        text not null,
  source      text,
  mode        text,
  status      text not null default 'queued',
  -- Estado completo del job (progreso, checkpoint, errores) en jsonb: el
  -- checkpoint es de forma libre por tipo de job.
  doc         jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_jobs_status on catalog_sync_jobs (status);
create index if not exists idx_jobs_source on catalog_sync_jobs (source, created_at desc);

create table if not exists catalog_sync_errors (
  id          bigserial primary key,
  job_id      uuid not null references catalog_sync_jobs(job_id) on delete cascade,
  url         text,
  message     text not null,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_sync_errors_job on catalog_sync_errors (job_id);

create table if not exists provider_usage (
  provider     text primary key,
  calls        bigint not null default 0,
  errors       bigint not null default 0,
  last_used_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id          bigserial primary key,
  actor       text not null default 'system',
  action      text not null,
  entity_type text,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_created on audit_logs (created_at desc);
