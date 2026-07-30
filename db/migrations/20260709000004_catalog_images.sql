-- Imágenes reales en el catálogo: tipo de coincidencia por recomendación.
-- Segura para datos existentes: solo añade una columna nullable.
--
-- image_crop_url / frame_image_url ya existen en detected_items desde
-- 20260627000001_init_catalog.sql; este cambio persiste el TIPO de match
-- (exact | near_exact | similar) que el motor visual ya calculaba pero no
-- guardaba, para poder distinguir "producto exacto" de "producto similar"
-- en la UI sin re-buscar.

alter table product_recommendations
  add column if not exists match_type text
  check (match_type in ('exact', 'near_exact', 'similar') or match_type is null);
