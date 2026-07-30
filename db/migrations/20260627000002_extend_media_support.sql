-- Pause2Shop — extensión para soporte multi-proveedor de vídeo e imágenes.
-- Añade columnas a video_sources para almacenar proveedor, tipo de media,
-- embedUrl, normalizedUrl, canEmbed y canCaptureFrame.
-- Amplía el check de source_type para incluir los nuevos proveedores.
-- Idempotente: puede aplicarse varias veces.

-- ---------------------------------------------------------------------------
-- Extender video_sources
-- ---------------------------------------------------------------------------

-- Columnas nuevas (idempotentes gracias a "if not exists" en Postgres 9.6+).
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'video_sources' and column_name = 'media_type'
  ) then
    alter table video_sources add column media_type text not null default 'video';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'video_sources' and column_name = 'provider'
  ) then
    alter table video_sources add column provider text not null default 'unknown';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'video_sources' and column_name = 'embed_url'
  ) then
    alter table video_sources add column embed_url text;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'video_sources' and column_name = 'normalized_url'
  ) then
    alter table video_sources add column normalized_url text;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'video_sources' and column_name = 'can_embed'
  ) then
    alter table video_sources add column can_embed boolean not null default true;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'video_sources' and column_name = 'can_capture_frame'
  ) then
    alter table video_sources add column can_capture_frame boolean not null default false;
  end if;
end $$;

-- Ampliar check de source_type: eliminar el check antiguo y crear uno nuevo.
alter table video_sources
  drop constraint if exists video_sources_source_type_check;

alter table video_sources
  add constraint video_sources_source_type_check
    check (source_type in (
      'uploaded',
      'youtube',
      'screen_capture',
      'external_url',
      'dailymotion',
      'vimeo',
      'direct_mp4',
      'hls',
      'image_upload'
    ));

-- Check para media_type
alter table video_sources
  drop constraint if exists video_sources_media_type_check;

alter table video_sources
  add constraint video_sources_media_type_check
    check (media_type in ('video', 'image', 'screen_capture'));

-- Backfill de filas existentes
update video_sources
set media_type = 'image', provider = 'image_upload'
where source_type = 'image_upload' and media_type = 'video';

update video_sources
set media_type = 'screen_capture', provider = 'screen_capture'
where source_type = 'screen_capture' and media_type = 'video';

update video_sources
set provider = source_type
where provider = 'unknown' and source_type in ('youtube', 'uploaded', 'external_url');

-- Índice para filtrar por media_type / source_type en catálogo.
create index if not exists idx_video_sources_media_type on video_sources(media_type);
create index if not exists idx_video_sources_provider on video_sources(provider);

-- ---------------------------------------------------------------------------
-- Índice en detected_items para filtrar por source_type (origen)
-- ---------------------------------------------------------------------------
create index if not exists idx_items_source_type on detected_items(source_type);
