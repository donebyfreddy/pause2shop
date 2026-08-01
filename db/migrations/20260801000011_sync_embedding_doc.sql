-- Sincroniza el `doc` JSONB con las columnas de embedding.
--
-- CORRIGE UN FALLO DE LA MIGRACIÓN 010. Aquella anuló los vectores de dimensión
-- incorrecta y marcó las fichas como `pending`, pero solo en las COLUMNAS
-- (`image_embedding`, `embedding_status`, `embedding_dimension`). El documento
-- JSONB se quedó como estaba: con su `imageEmbedding` de 64 dimensiones dentro.
--
-- Consecuencia observada: `store.allProducts()` lee de `doc`, y
-- `hydrateProduct` deduce el estado con
-- `raw.embeddingStatus ?? (raw.imageEmbedding ? "ready" : "pending")`. Como el
-- doc seguía teniendo un array, las tres fichas se leían como `ready` y
-- `catalog:embeddings:reindex --only-missing` las saltaba: reportaba
-- "0/0 fichas" mientras la columna decía `pending`. Un reindex que dice haber
-- terminado sin hacer nada es exactamente el fallo que la 010 pretendía evitar.
--
-- Lección para el futuro: en esta tabla los embeddings viven DUPLICADOS (columna
-- para consultar con pgvector, doc para hidratar el objeto). Cualquier cambio
-- tiene que tocar los dos lados o quedan contradiciéndose.

update catalog_products
   set doc = jsonb_set(
               jsonb_set(
                 doc - 'imageEmbedding' - 'textEmbedding',
                 '{embeddingStatus}', '"pending"'::jsonb, true
               ),
               '{embeddingDimension}', 'null'::jsonb, true
             )
 where embedding_status = 'pending'
   and (doc ? 'imageEmbedding' or doc->>'embeddingStatus' is distinct from 'pending');

-- Y al revés: las fichas SÍ listas deben declararlo también en el doc, para que
-- `hydrateProduct` no tenga que adivinarlo a partir de la presencia del array.
update catalog_products
   set doc = jsonb_set(
               jsonb_set(
                 doc,
                 '{embeddingStatus}', '"ready"'::jsonb, true
               ),
               '{embeddingDimension}', to_jsonb(embedding_dimension), true
             )
 where embedding_status = 'ready'
   and image_embedding is not null
   and doc->>'embeddingStatus' is distinct from 'ready';

analyze catalog_products;
