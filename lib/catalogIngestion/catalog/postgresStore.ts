import { getPool } from "../database/pool";
import type {
  CatalogProduct,
  JobRecord,
  PricePoint,
  ProductFilters,
  SourceState,
} from "./types";
import { hydrateProduct } from "./types";
import type {
  CatalogStore,
  ExtractionStats,
  StoreStats,
  VectorSearchHit,
  VectorSearchOptions,
} from "./store";
import { normalizeText } from "../normalization/normalize";
import { invalidateProductSnapshot } from "./productSnapshot";

/**
 * Store sobre Postgres (esquema en migrations/). El producto completo se
 * guarda como jsonb en `doc` además de las columnas indexables: así el modelo
 * puede evolucionar sin migración por cada campo nuevo, y las queries calientes
 * (dedup, filtros) siguen usando índices. Los embeddings viven en columnas
 * vector (pgvector) o jsonb (fallback creado por la migración 002).
 *
 * ⚠️ HONESTIDAD: este backend está implementado y tipado pero NO se ha podido
 * verificar contra un Postgres real en este entorno (la DATABASE_URL del
 * proyecto no es una connection string válida). Los tests corren contra
 * FileCatalogStore; verifica este backend con docker-compose antes de fiarte.
 */

interface Row {
  doc: CatalogProduct;
}

function rowToProduct(row: Row): CatalogProduct {
  // Se hidrata al leer: el `doc` puede venir de una versión anterior del
  // esquema y faltarle campos que hoy son obligatorios.
  return hydrateProduct(row.doc);
}

/**
 * Proyección SLIM del producto para la búsqueda.
 *
 * El `doc` completo trae historial de precios, metadatos de la fuente, la
 * evidencia de extracción y todas las variantes: nada de eso interviene ni en
 * el ranking ni en la tarjeta, y multiplica por 30 el payload. Medido sobre
 * 24 candidatos: doc entero 82 KB, esta proyección 32 KB (y 1022 KB cuando se
 * traían 300).
 *
 * `hydrateProduct` rellena con valores por defecto lo que no viene, así que un
 * documento parcial se convierte en un `CatalogProduct` válido. Si el ranking
 * empieza a usar un campo nuevo, hay que añadirlo AQUÍ además de en el ranking
 * — si no, llegará siempre vacío y el criterio no puntuará nunca.
 */
const SLIM_PRODUCT_JSON = `jsonb_build_object(
  'id', doc->'id',
  'title', doc->'title',
  'brand', doc->'brand',
  'category', doc->'category',
  'subcategory', doc->'subcategory',
  'style', doc->'style',
  'color', doc->'color',
  'secondaryColors', doc->'secondaryColors',
  'material', doc->'material',
  'pattern', doc->'pattern',
  'gender', doc->'gender',
  'primaryImage', doc->'primaryImage',
  'images', doc->'images',
  'price', doc->'price',
  'currency', doc->'currency',
  'availability', doc->'availability',
  'canonicalUrl', doc->'canonicalUrl',
  'source', doc->'source',
  'origin', doc->'origin',
  'dataset', doc->'dataset',
  'perceptualHash', doc->'perceptualHash',
  'isActive', doc->'isActive'
)`;

/**
 * `hnsw.ef_search` para la búsqueda vectorial, o 0 para dejar el de pgvector.
 * Se valida como entero en rango: interpolarlo en SQL sin comprobarlo sería
 * una inyección, porque `SET` no admite parámetros ligados.
 */
const HNSW_EF_SEARCH = (() => {
  const raw = Number(process.env.CATALOG_HNSW_EF_SEARCH);
  return Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : 0;
})();

export class PostgresCatalogStore implements CatalogStore {
  readonly backend = "postgres" as const;
  private hasVector = false;

  async init(): Promise<void> {
    const res = await getPool().query(
      "select 1 from pg_extension where extname = 'vector'"
    );
    this.hasVector = (res.rowCount ?? 0) > 0;
    // Comprueba que las migraciones se han aplicado — mejor fallar claro aquí
    // que con un error críptico en la primera query.
    await getPool().query("select 1 from catalog_products limit 1");
  }

  async close(): Promise<void> {
    // El pool se cierra en el shutdown del proceso (closePool).
  }

  async saveProduct(p: CatalogProduct): Promise<void> {
    // Ver fileStore.saveProduct: la búsqueda usa una instantánea compartida.
    invalidateProductSnapshot();
    const embeddingSql = this.hasVector
      ? "$14::vector, $15::vector"
      : "$14::jsonb, $15::jsonb";
    const imageEmb = p.imageEmbedding ? JSON.stringify(p.imageEmbedding) : null;
    const textEmb = p.textEmbedding ? JSON.stringify(p.textEmbedding) : null;
    await getPool().query(
      `insert into catalog_products
         (id, source, source_product_id, canonical_url, brand, title, category,
          availability, sku, gtin, content_hash, perceptual_hash, is_active,
          image_embedding, text_embedding, origin, doc,
          embedding_status, embedding_provider, embedding_dimension,
          dataset_id, dataset_version, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,${embeddingSql},$16,$17,
               $18,$19,$20,$21,$22,now())
       on conflict (source, source_product_id) do update set
         canonical_url = excluded.canonical_url,
         brand = excluded.brand,
         title = excluded.title,
         category = excluded.category,
         availability = excluded.availability,
         sku = excluded.sku,
         gtin = excluded.gtin,
         content_hash = excluded.content_hash,
         perceptual_hash = excluded.perceptual_hash,
         is_active = excluded.is_active,
         image_embedding = excluded.image_embedding,
         text_embedding = excluded.text_embedding,
         origin = excluded.origin,
         doc = excluded.doc,
         embedding_status = excluded.embedding_status,
         embedding_provider = excluded.embedding_provider,
         embedding_dimension = excluded.embedding_dimension,
         dataset_id = excluded.dataset_id,
         dataset_version = excluded.dataset_version,
         updated_at = now()`,
      [
        p.id, p.source, p.sourceProductId, p.canonicalUrl, p.brand, p.title,
        p.category, p.availability, p.sku, p.gtin, p.contentHash,
        p.perceptualHash, p.isActive, imageEmb, textEmb, p.origin,
        JSON.stringify(p),
        // Estos cinco viven además en `doc`, pero como columnas permiten
        // filtrar y contar en SQL sin traerse el jsonb entero: es la diferencia
        // entre "cuántos embeddings faltan" en 20 ms o en 20 segundos.
        p.embeddingStatus ?? "pending",
        p.embeddingProvider,
        p.embeddingDimension,
        p.dataset?.id ?? null,
        p.dataset?.version ?? null,
      ]
    );
    // Imágenes en tabla propia para dedup por sha256 con índice
    for (const img of p.images) {
      if (!img.sha256) continue;
      await getPool().query(
        `insert into catalog_product_images (product_id, url, local_path, sha256, perceptual_hash, width, height)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (product_id, sha256) do nothing`,
        [p.id, img.url, img.localPath, img.sha256, img.perceptualHash, img.width, img.height]
      );
    }
  }

  private async one(sql: string, params: unknown[]): Promise<CatalogProduct | null> {
    const res = await getPool().query<Row>(sql, params);
    return res.rows[0] ? rowToProduct(res.rows[0]) : null;
  }

  async getProduct(id: string): Promise<CatalogProduct | null> {
    return this.one("select doc from catalog_products where id = $1", [id]);
  }

  async listProducts(filters: ProductFilters): Promise<{ items: CatalogProduct[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (filters.source) add("source = ?", filters.source);
    if (filters.category) add("category = ?", filters.category);
    if (filters.brand) add("lower(brand) = ?", normalizeText(filters.brand));
    if (filters.active !== undefined) add("is_active = ?", filters.active);
    if (filters.origin) add("origin = ?", filters.origin);
    if (filters.embeddingStatus) add("embedding_status = ?", filters.embeddingStatus);
    // `color` y `gender` no tienen columna: viven en el doc. Se filtran con el
    // operador ->> en vez de traerse la página y filtrarla en el cliente, que
    // es lo que hacía el admin y solo filtraba los 24 resultados visibles.
    if (filters.color) add("lower(doc->>'color') = ?", normalizeText(filters.color));
    if (filters.gender) add("lower(doc->>'gender') = ?", normalizeText(filters.gender));
    if (filters.q) add("(title ilike ? or brand ilike '%' || $" + (params.length + 1) + " || '%')", `%${filters.q}%`);
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    const limit = Math.min(filters.limit ?? 20, 100);
    const page = Math.max(filters.page ?? 1, 1);
    const total = Number(
      (await getPool().query(`select count(*) as c from catalog_products ${whereSql}`, params)).rows[0].c
    );
    const res = await getPool().query<Row>(
      `select doc from catalog_products ${whereSql} order by updated_at desc limit ${limit} offset ${(page - 1) * limit}`,
      params
    );
    return { items: res.rows.map(rowToProduct), total };
  }

  async findBySourceProductId(source: string, sourceProductId: string): Promise<CatalogProduct | null> {
    return this.one(
      "select doc from catalog_products where source = $1 and source_product_id = $2",
      [source, sourceProductId]
    );
  }

  async findByCanonicalUrl(url: string): Promise<CatalogProduct | null> {
    return this.one("select doc from catalog_products where canonical_url = $1", [url]);
  }

  async findBySku(sku: string): Promise<CatalogProduct | null> {
    return this.one("select doc from catalog_products where sku = $1 limit 1", [sku]);
  }

  async findByGtin(gtin: string): Promise<CatalogProduct | null> {
    return this.one("select doc from catalog_products where gtin = $1 limit 1", [gtin]);
  }

  async findByImageSha256(sha256: string): Promise<CatalogProduct | null> {
    return this.one(
      `select p.doc from catalog_products p
       join catalog_product_images i on i.product_id = p.id
       where i.sha256 = $1 limit 1`,
      [sha256]
    );
  }

  /** Candidatos para matching en memoria. Limitado a 5000: con más volumen,
   * la búsqueda debe hacerse con el operador <=> de pgvector (índice ivfflat
   * ya creado por la migración cuando la extensión existe). */
  async allProducts(): Promise<CatalogProduct[]> {
    const res = await getPool().query<Row>(
      "select doc from catalog_products order by updated_at desc limit 5000"
    );
    return res.rows.map(rowToProduct);
  }

  /**
   * Top-N por similitud coseno, calculada por pgvector.
   *
   * Se filtra por `embedding_dimension` a propósito: el índice puede tener
   * vectores de distinta dimensión conviviendo (un reindex a medias, o fichas
   * antiguas del provider `hash` de 64d). Sin el filtro, pgvector aborta la
   * consulta entera con "different vector dimensions" en cuanto se topa con
   * una — no la ignora.
   *
   * El `doc` viaja sin embeddings (`- 'imageEmbedding' - 'textEmbedding'`):
   * son el 75% del payload y aquí ya no sirven para nada, porque la similitud
   * la ha calculado la base.
   */
  async searchByImageEmbedding(
    embedding: number[],
    opts: VectorSearchOptions
  ): Promise<VectorSearchHit[]> {
    if (!this.hasVector) return [];


    const params: unknown[] = [JSON.stringify(embedding), embedding.length];
    const where: string[] = [
      "is_active",
      "image_embedding is not null",
      "embedding_dimension = $2",
    ];

    // Prefiltros EN SQL. Antes se traían 300 candidatos y se filtraban en
    // memoria; ahora Postgres descarta lo que no aplica y basta con pedir
    // top-K. Medido: 300 candidatos con doc = 1022 KB; 24 con esta proyección
    // = 32 KB.
    if (opts.categories?.length) {
      params.push(opts.categories);
      where.push(`category = any($${params.length})`);
    }
    if (opts.gender) {
      params.push(opts.gender.toLowerCase());
      // Solo excluye si la ficha declara un género y no casa: una ficha sin
      // género no se descarta (ver `genderConflicts`).
      where.push(
        `(doc->>'gender' is null
          or lower(doc->>'gender') = $${params.length}
          or lower(doc->>'gender') in ('unisex','unisexo','all','todos'))`
      );
    }
    if (opts.requireImage) {
      where.push(`(doc->>'primaryImage' is not null or jsonb_array_length(coalesce(doc->'images','[]'::jsonb)) > 0)`);
    }

    params.push(opts.limit);
    const limitParam = `$${params.length}`;

    const sql = `select ${SLIM_PRODUCT_JSON} as doc,
              1 - (image_embedding <=> $1::vector) as similarity
         from catalog_products
        where ${where.join("\n          and ")}
        order by image_embedding <=> $1::vector
        limit ${limitParam}`;

    const res = await this.runVectorQuery(sql, params);

    return res.rows.map((row) => ({
      product: rowToProduct(row),
      // pgvector puede devolver el escalar como texto según el driver.
      similarity: Math.max(0, Math.min(1, Number(row.similarity))),
    }));
  }

  /**
   * Ejecuta la consulta vectorial, ajustando `hnsw.ef_search` si está
   * configurado.
   *
   * Cuando NO lo está —el caso por defecto— va directa contra el pool: una sola
   * ida y vuelta. Solo si alguien fija la variable se paga una transacción
   * sobre un cliente dedicado, y hace falta que sea así: `SET LOCAL` fuera de
   * una transacción no hace nada, y un `SET` de sesión sobre un pool afectaría
   * a las demás consultas que compartan esa conexión.
   */
  private async runVectorQuery(
    sql: string,
    params: unknown[]
  ): Promise<{ rows: Array<Row & { similarity: string | number }> }> {
    if (!HNSW_EF_SEARCH) {
      return getPool().query<Row & { similarity: string | number }>(sql, params);
    }
    const client = await getPool().connect();
    try {
      await client.query("begin");
      await client.query(`set local hnsw.ef_search = ${HNSW_EF_SEARCH}`);
      const res = await client.query<Row & { similarity: string | number }>(sql, params);
      await client.query("commit");
      return res;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await getPool().query(
      `update catalog_products
       set is_active = $2,
           doc = jsonb_set(doc, '{isActive}', to_jsonb($2::boolean)),
           updated_at = now()
       where id = $1`,
      [id, active]
    );
  }

  async recordPrice(id: string, point: PricePoint): Promise<void> {
    await getPool().query(
      `insert into catalog_prices (product_id, price, original_price, currency, recorded_at)
       values ($1,$2,$3,$4,$5)`,
      [id, point.price, point.originalPrice, point.currency, point.recordedAt]
    );
    await getPool().query(
      `update catalog_products
       set doc = jsonb_set(doc, '{priceHistory}', coalesce(doc->'priceHistory','[]'::jsonb) || $2::jsonb)
       where id = $1`,
      [id, JSON.stringify(point)]
    );
  }

  async countProducts(source?: string): Promise<number> {
    const res = source
      ? await getPool().query("select count(*) as c from catalog_products where source = $1", [source])
      : await getPool().query("select count(*) as c from catalog_products");
    return Number(res.rows[0].c);
  }

  /** Un solo GROUP BY en vez de un count por fuente. Ver el interfaz. */
  async countProductsBySource(): Promise<Map<string, number>> {
    const res = await getPool().query<{ source: string; c: string }>(
      "select source, count(*) as c from catalog_products group by source"
    );
    return new Map(res.rows.map((r) => [r.source, Number(r.c)]));
  }

  async incrementDuplicates(n = 1): Promise<void> {
    await getPool().query(
      `insert into provider_usage (provider, calls, errors)
       values ('dedup', $1, 0)
       on conflict (provider) do update set calls = provider_usage.calls + $1, last_used_at = now()`,
      [n]
    );
  }

  async getSourceState(id: string): Promise<SourceState> {
    const res = await getPool().query(
      "select id, paused, last_sync_at from catalog_sources where id = $1",
      [id]
    );
    if (!res.rows[0]) return { id, paused: false, lastSyncAt: null };
    return {
      id: res.rows[0].id,
      paused: res.rows[0].paused,
      lastSyncAt: res.rows[0].last_sync_at ? new Date(res.rows[0].last_sync_at).toISOString() : null,
    };
  }

  /** Una sola lectura de catalog_sources en vez de una por fuente. */
  async getAllSourceStates(): Promise<Map<string, SourceState>> {
    const res = await getPool().query<{
      id: string;
      paused: boolean;
      last_sync_at: string | Date | null;
    }>("select id, paused, last_sync_at from catalog_sources");
    return new Map(
      res.rows.map((r) => [
        r.id,
        {
          id: r.id,
          paused: r.paused,
          lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
        },
      ])
    );
  }

  async setSourceState(state: SourceState): Promise<void> {
    await getPool().query(
      `insert into catalog_sources (id, paused, last_sync_at)
       values ($1,$2,$3)
       on conflict (id) do update set paused = $2, last_sync_at = $3`,
      [state.id, state.paused, state.lastSyncAt]
    );
  }

  async saveJob(job: JobRecord): Promise<void> {
    await getPool().query(
      `insert into catalog_sync_jobs (job_id, type, source, mode, status, doc, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (job_id) do update set status = $5, doc = $6`,
      [job.jobId, job.type, job.source, job.mode, job.status, JSON.stringify(job), job.createdAt]
    );
    // Errores del job a tabla propia (consultables sin parsear jsonb)
    for (const e of job.errors.slice(-5)) {
      await getPool().query(
        `insert into catalog_sync_errors (job_id, url, message, occurred_at)
         values ($1,$2,$3,$4) on conflict do nothing`,
        [job.jobId, e.url, e.message, e.at]
      );
    }
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const res = await getPool().query("select doc from catalog_sync_jobs where job_id = $1", [jobId]);
    return res.rows[0] ? (res.rows[0].doc as JobRecord) : null;
  }

  async listJobs(limit: number): Promise<JobRecord[]> {
    const res = await getPool().query(
      "select doc from catalog_sync_jobs order by created_at desc limit $1",
      [limit]
    );
    return res.rows.map((r) => r.doc as JobRecord);
  }

  /**
   * Estadísticas de extracción agregadas EN SQL sobre `doc->'extraction'`.
   * Traerse 5000 documentos a memoria para contar cuántos usaron IA sería
   * absurdo cuando Postgres sabe hacerlo con un solo escaneo.
   */
  async extractionStats(source?: string): Promise<ExtractionStats> {
    const where = source ? "where source = $1 and doc ? 'extraction'" : "where doc ? 'extraction'";
    const params = source ? [source] : [];
    const totals = await getPool().query(
      `select
         count(*) filter (where doc->'extraction' is not null and doc->'extraction' <> 'null'::jsonb)::int as total,
         count(*) filter (where (doc->'extraction'->>'aiUsed')::boolean)::int as with_ai,
         count(*) filter (where (doc->'extraction'->>'aiUsed')::boolean is false)::int as without_ai,
         count(*) filter (where (doc->'extraction'->>'browserUsed')::boolean)::int as with_browser,
         coalesce(sum((doc->'extraction'->>'aiCostUsd')::numeric),0)::numeric as ai_cost,
         avg((doc->'extraction'->>'confidence')::numeric) as avg_confidence
       from catalog_products ${where}`,
      params
    );
    const byExtractor = await getPool().query(
      `select coalesce(doc->'extraction'->>'primaryExtractor', 'desconocido') as extractor,
              count(*)::int as c
       from catalog_products ${where}
       group by 1`,
      params
    );

    const row = totals.rows[0];
    const total = row.total as number;
    const byPrimaryExtractor: Record<string, number> = {};
    for (const r of byExtractor.rows) byPrimaryExtractor[r.extractor] = r.c;

    return {
      total,
      withAi: row.with_ai,
      withoutAi: row.without_ai,
      withBrowser: row.with_browser,
      aiRatio: total > 0 ? Math.round((row.with_ai / total) * 100) / 100 : null,
      avgConfidence:
        row.avg_confidence != null ? Math.round(Number(row.avg_confidence) * 100) / 100 : null,
      aiCostUsd: Math.round(Number(row.ai_cost) * 1e6) / 1e6,
      byPrimaryExtractor,
    };
  }

  /**
   * Las mismas dos agregaciones que `extractionStats`, pero agrupadas por
   * `source` para resolver todas las fuentes en 2 queries en vez de 2 por
   * fuente. Ver el interfaz.
   */
  async extractionStatsBySource(): Promise<Map<string, ExtractionStats>> {
    const where = "where doc ? 'extraction'";
    const [totals, byExtractor] = await Promise.all([
      getPool().query(
        `select
           source,
           count(*) filter (where doc->'extraction' is not null and doc->'extraction' <> 'null'::jsonb)::int as total,
           count(*) filter (where (doc->'extraction'->>'aiUsed')::boolean)::int as with_ai,
           count(*) filter (where (doc->'extraction'->>'aiUsed')::boolean is false)::int as without_ai,
           count(*) filter (where (doc->'extraction'->>'browserUsed')::boolean)::int as with_browser,
           coalesce(sum((doc->'extraction'->>'aiCostUsd')::numeric),0)::numeric as ai_cost,
           avg((doc->'extraction'->>'confidence')::numeric) as avg_confidence
         from catalog_products ${where}
         group by source`
      ),
      getPool().query(
        `select source,
                coalesce(doc->'extraction'->>'primaryExtractor', 'desconocido') as extractor,
                count(*)::int as c
         from catalog_products ${where}
         group by source, extractor`
      ),
    ]);

    const extractors = new Map<string, Record<string, number>>();
    for (const r of byExtractor.rows) {
      const bucket = extractors.get(r.source) ?? {};
      bucket[r.extractor] = r.c;
      extractors.set(r.source, bucket);
    }

    const out = new Map<string, ExtractionStats>();
    for (const row of totals.rows) {
      const total = row.total as number;
      out.set(row.source, {
        total,
        withAi: row.with_ai,
        withoutAi: row.without_ai,
        withBrowser: row.with_browser,
        aiRatio: total > 0 ? Math.round((row.with_ai / total) * 100) / 100 : null,
        avgConfidence:
          row.avg_confidence != null ? Math.round(Number(row.avg_confidence) * 100) / 100 : null,
        aiCostUsd: Math.round(Number(row.ai_cost) * 1e6) / 1e6,
        byPrimaryExtractor: extractors.get(row.source) ?? {},
      });
    }
    return out;
  }

  async stats(): Promise<StoreStats> {
    const pool = getPool();
    const totals = await pool.query(
      `select count(*)::int as total,
              count(*) filter (where is_active)::int as active,
              count(*) filter (where image_embedding is not null)::int as with_embeddings
       from catalog_products`
    );
    const bySourceRes = await pool.query(
      "select source, count(*)::int as c from catalog_products group by source"
    );
    const byOriginRes = await pool.query(
      "select origin, count(*)::int as c from catalog_products group by origin"
    );
    const withImagesRes = await pool.query(
      "select count(distinct product_id)::int as c from catalog_product_images"
    );
    const jobsRes = await pool.query(
      "select status, count(*)::int as c from catalog_sync_jobs group by status"
    );
    const dupRes = await pool.query(
      "select coalesce(sum(calls),0)::int as c from provider_usage where provider = 'dedup'"
    );
    const bySource: Record<string, number> = {};
    for (const r of bySourceRes.rows) bySource[r.source] = r.c;
    const byOrigin: Record<string, number> = {};
    for (const r of byOriginRes.rows) byOrigin[r.origin] = r.c;
    const jobs: Record<string, number> = {};
    for (const r of jobsRes.rows) jobs[r.status] = r.c;
    return {
      totalProducts: totals.rows[0].total,
      activeProducts: totals.rows[0].active,
      bySource,
      byOrigin,
      withImages: withImagesRes.rows[0].c,
      withEmbeddings: totals.rows[0].with_embeddings,
      duplicatesDetected: dupRes.rows[0].c,
      jobs,
    };
  }
}
