-- Identidad global de producto por vídeo + estado de matching granular.
--
-- Qué corrige. Hasta ahora un producto único guardaba `matching` (el resultado)
-- y `skipped_reason` (un string libre). Con eso, TODO lo que no fuera una
-- coincidencia acababa en la UI como "NO MATCH" o como el mensaje crudo de la
-- excepción — se llegó a mostrar `matching omitido: The operation was aborted
-- due to timeout` en la tarjeta del producto. Tres situaciones muy distintas
-- (no existe / no dio tiempo / se rompió) compartían cajón, así que no había
-- forma de saber qué reintentar.
--
-- Además el producto no guardaba su IDENTIDAD: el nombre canónico elegido
-- entre las variantes que devolvió el modelo, las apariciones, el recuento.
-- Sin eso, "cinco tarjetas de la misma camiseta" no se puede convertir en una.

alter table product_matches
  -- Estado exacto. Ver `ProductMatchStatus` en lib/analysis/jobs/types.ts.
  add column if not exists match_status text not null default 'not_searched'
    check (match_status in (
      'catalog_matched','external_candidate','no_match','catalog_timeout',
      'external_timeout','embedding_error','partial_result','not_searched',
      'matching_error')),
  add column if not exists match_attempts integer not null default 0,
  add column if not exists match_error text,
  add column if not exists match_duration_ms integer not null default 0,
  -- Bloques separados catálogo/Internet tal cual los devolvió el resolver.
  add column if not exists detection jsonb,
  -- Identidad canónica (nombre elegido, timestamps, seen count, escenas).
  add column if not exists identity jsonb not null default '{}'::jsonb,
  -- Sospecha de duplicado que NO se fundió sola: entre el umbral posible y el
  -- fuerte. Apunta al `product_id` del que se sospecha.
  add column if not exists possible_duplicate_of text;

-- Consulta operativa: "¿qué quedó pendiente de reintentar en este job?".
create index if not exists idx_product_matches_status
  on product_matches (job_id, match_status);

-- Catálogo Mediaset: programa / episodio / contenido. Opcionales a propósito —
-- hoy la demo sube un fichero suelto y no hay jerarquía editorial que colgar.
alter table media_contents
  add column if not exists program_id text,
  add column if not exists episode_id text,
  add column if not exists content_id text,
  -- Instante editorial de referencia (cabecera, entrada de bloque…), en ms.
  add column if not exists editorial_timestamp_ms integer;

create index if not exists idx_media_contents_program
  on media_contents (program_id, episode_id)
  where program_id is not null;

-- La consulta "videoId + timestamp → productos activos" tenía que leer
-- `timestamps` (jsonb) y filtrar en memoria. Con estas columnas se resuelve con
-- el índice de rango que ya existe (idx_video_occurrences_timestamp).
alter table video_product_occurrences
  add column if not exists canonical_label text not null default '',
  add column if not exists canonical_category text not null default '',
  add column if not exists seen_count integer not null default 0,
  add column if not exists match_status text not null default 'not_searched',
  -- Estado EDITORIAL, distinto del de matching: una coincidencia técnica
  -- correcta puede no ser publicable.
  add column if not exists editorial_status text not null default 'pending'
    check (editorial_status in ('pending','approved','rejected','published'));

create index if not exists idx_video_occurrences_editorial
  on video_product_occurrences (media_content_id, editorial_status);
