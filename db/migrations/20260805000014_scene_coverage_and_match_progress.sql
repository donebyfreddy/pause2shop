-- Estado por escena, cobertura temporal y progreso de matching en vivo.
--
-- Qué corrige. Hasta ahora una escena solo tenía sus límites y su recuento de
-- frames RECIBIDOS (media_scenes.frame_count) — nada distinguía "procesé toda
-- la escena" de "la escena existió pero casi todo se descartó". Tampoco había
-- ningún concepto de cobertura TEMPORAL del vídeo (huecos entre escenas, antes
-- de la primera o después de la última), ni un progreso de matching visible
-- mientras corre: `product_matches.match_status` solo se escribía al terminar,
-- así que un job con 100 s de matching en curso mostraba "not_searched" en
-- todos sus productos hasta el segundo 100 en punto.

alter table media_scenes
  add column if not exists analyzed_frame_count integer not null default 0,
  add column if not exists status text not null default 'completed'
    check (status in ('pending','extracting','detecting','tracking','completed','failed')),
  add column if not exists failure_reason text;

-- Motivo por el que un frame se conservó o se descartó (auditoría del
-- sampling adaptativo: ver `FrameSamplingReason` en lib/analysis/jobs/types.ts).
alter table media_frames
  add column if not exists reason text;

alter table analysis_jobs
  -- Cobertura real de la línea temporal — ver `TemporalCoverage`. NULL hasta
  -- que el job finaliza.
  add column if not exists coverage jsonb,
  -- Poblado solo cuando `validateProcessedVideoResult` encuentra algo; un job
  -- `completed` con esta lista no vacía es una contradicción que no debería
  -- ocurrir nunca (y si ocurre, se degrada a `partially_completed` antes de
  -- persistirse, no después).
  add column if not exists integrity_errors jsonb not null default '[]'::jsonb;

-- Progreso EN VIVO del matching de un producto, distinto de `match_status`
-- (el resultado final). Se escribe en cada transición real del resolver.
alter table product_matches
  add column if not exists match_progress text not null default 'not_started'
    check (match_progress in (
      'not_started','embedding','catalog_search','catalog_matched',
      'catalog_unresolved','catalog_timeout','external_queued',
      'external_searching','external_candidate','review_required','completed'));
