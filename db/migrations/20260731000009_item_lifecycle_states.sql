-- Ciclo de vida explícito de un elemento detectado.
--
-- Antes solo había 'detected' | 'reviewed' | 'matched' | 'ignored', y eso hacía
-- imposible distinguir tres cosas que NO son lo mismo:
--
--   * una detección guardada sin ningún producto asociado,
--   * una detección con un producto del CATÁLOGO propio confirmado,
--   * un resultado de INTERNET guardado como candidato, pendiente de revisar.
--
-- Con un único 'matched' para los tres casos, la UI acababa contando
-- detecciones visuales como si fueran productos del catálogo validados, y un
-- resultado externo sin verificar quedaba indistinguible de uno aprobado.
--
-- Estados nuevos:
--   detected            detección guardada, sin producto asociado
--   catalog_matched     producto del catálogo propio por encima del umbral
--   external_candidate  resultado externo guardado como candidato (SIN validar)
--   review_required     necesita revisión humana antes de aprobarse
--   approved            revisado y aceptado por una persona
--   published           publicado como producto del catálogo
--
-- Los cuatro valores anteriores se CONSERVAN en el check: hay filas con ellos y
-- reescribirlas perdería información sobre qué se revisó y qué se ignoró.
-- 'matched' queda como legado de 'catalog_matched' y 'reviewed' de 'approved'.

alter table detected_items
  drop constraint if exists detected_items_status_check;

alter table detected_items
  add constraint detected_items_status_check
  check (status in (
    -- estados vigentes
    'detected',
    'catalog_matched',
    'external_candidate',
    'review_required',
    'approved',
    'published',
    'ignored',
    -- estados legados (filas existentes)
    'reviewed',
    'matched'
  ));

-- Las filas ya marcadas 'matched' se escribieron cuando el único match posible
-- venía del pipeline externo SIN verificación de catálogo. Promocionarlas a
-- 'catalog_matched' afirmaría algo que no consta, así que se dejan como están:
-- el check las sigue aceptando y quedan visibles como legado.

comment on column detected_items.status is
  'Ciclo de vida: detected → catalog_matched | external_candidate → review_required → approved → published. ''matched''/''reviewed'' son legado.';
