-- Índice vectorial para la búsqueda del catálogo.
--
-- MEDICIÓN QUE MOTIVA ESTA MIGRACIÓN (1048 productos, Neon eu-central-1):
--
--   explain analyze de la búsqueda top-24  →  Seq Scan, Execution Time 3,7 ms
--   la misma consulta medida desde el cliente →  248 ms
--
-- Es decir: con mil productos el escaneo secuencial NO es el problema (son
-- 3,7 ms); el tiempo se va en red y en payload. Pero el escaneo lee 3208
-- buffers (~25 MB) por consulta y eso crece LINEALMENTE: a 10.000 productos son
-- ~250 MB por búsqueda y el coste deja de ser despreciable. El índice es para
-- ese caso, no para el de hoy.
--
-- Requisito de pgvector: para indexar, la columna necesita dimensión FIJA.
-- Hoy es `vector` sin dimensión, así que hay que fijarla a 512 — y antes,
-- limpiar lo que no encaje.

do $$
declare
  has_vector boolean;
  bad_rows integer;
  dims integer[];
begin
  select exists (select 1 from pg_extension where extname = 'vector') into has_vector;
  if not has_vector then
    raise notice 'pgvector no disponible: no se crea indice vectorial';
    return;
  end if;

  -- 1. Vectores de otra dimensión.
  --
  -- Hay 3 fichas con embeddings de 64 dimensiones del proveedor `hash` antiguo,
  -- marcadas `ready` con `embedding_dimension` a null: mienten sobre su estado.
  -- No se pueden convertir a 512 (no hay forma de "estirar" un vector), así que
  -- se anulan y se marcan `pending` para que un reindex los regenere. Anular es
  -- lo honesto: un vector de 64 dimensiones no participa en las búsquedas de
  -- todas formas — pgvector aborta la consulta entera si se topa con uno.
  select count(*) into bad_rows
    from catalog_products
   where image_embedding is not null
     and vector_dims(image_embedding) <> 512;

  if bad_rows > 0 then
    raise notice 'anulando % embeddings de dimension distinta de 512', bad_rows;
    update catalog_products
       set image_embedding = null,
           embedding_status = 'pending',
           embedding_dimension = null
     where image_embedding is not null
       and vector_dims(image_embedding) <> 512;
  end if;

  update catalog_products
     set text_embedding = null
   where text_embedding is not null
     and vector_dims(text_embedding) <> 512;

  -- 2. Coherencia de `embedding_dimension` con el vector real. Estaba a null en
  -- filas que sí tenían vector, y ese campo se usa como filtro en la búsqueda.
  update catalog_products
     set embedding_dimension = 512
   where image_embedding is not null
     and embedding_dimension is distinct from 512;

  -- 3. Dimensión fija en la columna: sin esto pgvector rechaza crear el índice.
  select array_agg(distinct vector_dims(image_embedding)) into dims
    from catalog_products where image_embedding is not null;

  if dims is null or dims = array[512] then
    execute 'alter table catalog_products alter column image_embedding type vector(512)';
    execute 'alter table catalog_products alter column text_embedding type vector(512)';
  else
    raise notice 'dimensiones heterogeneas %, no se fija el tipo ni se indexa', dims;
    return;
  end if;

  -- 4. HNSW sobre distancia coseno, que es la que usa la búsqueda (`<=>`).
  --
  -- HNSW y no IVFFlat: IVFFlat necesita entrenarse con datos ya cargados y hay
  -- que reconstruirlo cuando el catálogo crece mucho; HNSW se mantiene solo al
  -- insertar. Para un catálogo que se sincroniza a diario, esa diferencia
  -- operativa pesa más que el algo mayor coste de construcción.
  execute 'create index if not exists idx_catalog_products_image_embedding_hnsw
             on catalog_products using hnsw (image_embedding vector_cosine_ops)';

  raise notice 'indice HNSW creado sobre image_embedding';
end
$$;

-- Prefiltro barato: la búsqueda siempre acota por activo + categoría antes de
-- ordenar por distancia. Sin este índice, ese filtro es otro escaneo.
create index if not exists idx_catalog_products_active_category
  on catalog_products (is_active, category)
  where is_active;

-- Filtro "tiene embedding utilizable", que es la condición de entrada de toda
-- búsqueda visual. Parcial para que ocupe solo lo que se consulta.
create index if not exists idx_catalog_products_embeddable
  on catalog_products (is_active)
  where is_active and image_embedding is not null;

comment on index idx_catalog_products_image_embedding_hnsw is
  'HNSW coseno para la busqueda visual del catalogo. Ver docs/MATCHING_PERFORMANCE.md';

-- ANALYZE no es opcional después de crear el índice.
--
-- Medido en el banco de pruebas (scripts/benchmarkMatching.ts) con 10.000
-- productos: sin estadísticas frescas el planificador DESCARTA el índice HNSW y
-- se queda en escaneo secuencial — 30,1 ms frente a 1,7 ms. El índice existía y
-- no se usaba, que es la peor variante posible porque parece que está aplicado.
--
-- Mismo riesgo tras cada importación grande de catálogo: ver
-- docs/MATCHING_PERFORMANCE.md.
analyze catalog_products;
