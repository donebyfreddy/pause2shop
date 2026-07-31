-- Importación de catálogos de dataset (fashion-product-images-small y futuros).
--
-- Tres cosas que antes no se podían responder en SQL y ahora sí:
--
--   1. "¿Qué productos tienen embedding y cuáles están pendientes?" — antes solo
--      existía `image_embedding is not null`, que no distingue "todavía no se ha
--      intentado" de "se intentó y falló" ni de "se omitió a propósito". Sin esa
--      distinción no hay forma de reintentar solo los fallidos.
--
--   2. "¿De qué dataset y de qué versión salió esta ficha?" — hace falta para
--      poder reimportar tras un cambio del dataset upstream y para borrar un
--      dataset concreto sin tocar los productos scrapeados.
--
--   3. "¿Qué proveedor de embeddings generó este vector?" — mezclar vectores de
--      64 dimensiones (hash) con los de 512 (CLIP) en la misma columna hace que
--      la búsqueda por coseno los descarte en silencio. Guardarlo permite
--      detectar el índice mixto en vez de sufrirlo.
--
-- Los binarios de imagen NO entran aquí: van a storage persistente y en la base
-- solo queda la URL, igual que el resto del catálogo.

alter table catalog_products
  add column if not exists embedding_status text not null default 'pending';

alter table catalog_products
  add column if not exists embedding_provider text;

alter table catalog_products
  add column if not exists embedding_dimension integer;

alter table catalog_products
  add column if not exists dataset_id text;

alter table catalog_products
  add column if not exists dataset_version text;

-- Backfill honesto de lo que ya había: si hay vector, está listo; si no, está
-- pendiente. Nunca se marca como 'ready' algo que no tiene vector.
update catalog_products
   set embedding_status = case
         when image_embedding is not null then 'ready'
         else 'pending'
       end
 where embedding_status = 'pending';

create index if not exists idx_products_embedding_status
  on catalog_products (embedding_status);

create index if not exists idx_products_dataset
  on catalog_products (dataset_id) where dataset_id is not null;

-- Los productos de dataset se distinguen por `origin = 'dataset_demo'`. El
-- índice de origin ya existe (idx_products_origin), así que no hace falta otro.
