-- Caché de resultados de búsqueda visual (Google Lens / Google Shopping).
-- Clave por hash de imagen (lens) o por query normalizada (shopping), con TTL.
-- Evita repetir llamadas de pago para frames o queries ya vistas.

create table if not exists visual_search_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  provider text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_visual_search_cache_expires
  on visual_search_cache (expires_at);

comment on table visual_search_cache is
  'Resultados cacheados de SearchAPI/SerpAPI Lens y Google Shopping. cache_key = lens:v1:<sha256> | shop:v1:<provider>:<query>.';
