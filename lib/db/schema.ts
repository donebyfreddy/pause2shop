/**
 * Esquema Drizzle del Postgres de Pause2Shop (Neon).
 *
 * ESTE FICHERO NO ES LA FUENTE DE VERDAD DEL DDL. Las tablas se crean y
 * evolucionan con los .sql de `db/migrations/` (ver scripts/migrate.ts), que
 * llevan cosas que Drizzle no modela bien y que no queremos perder: triggers
 * (set_updated_at), índices parciales y GIN, un DO block que degrada pgvector a
 * jsonb si la extensión no está, y backfills. Lo que hay aquí es el ESPEJO
 * TIPADO de ese DDL, para poder consultar con tipos en vez de con `any`.
 *
 * Regla de oro: si cambias una tabla, escribe la migración .sql primero y
 * refleja el cambio aquí después. `npm run db:check` avisa si se desincronizan.
 *
 * Los nombres de columna se declaran EXPLÍCITOS en snake_case en vez de
 * confiar en la conversión automática: el mapeo queda legible al lado del DDL.
 */
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Embedding del catálogo. La migración crea `vector` si pgvector está
 * disponible y `jsonb` si no, y la DIMENSIÓN la fija el provider activo
 * (CATALOG_EMBEDDING_PROVIDER), no el DDL. Por eso no se puede tipar como
 * `vector(768)`: se declara sin dimensión y la conversión se hace a mano.
 *
 * Neon trae pgvector, así que en producción la columna es `vector`.
 */
const embedding = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) =>
    typeof value === "string"
      ? (JSON.parse(value) as number[])
      : (value as unknown as number[]),
});

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Medios analizados y objetos detectados (20260627000001 + 20260627000002)
// ---------------------------------------------------------------------------

export const videoSources = pgTable("video_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title"),
  url: text("url"),
  /** uploaded | youtube | screen_capture | external_url | dailymotion | vimeo | direct_mp4 | hls | image_upload */
  sourceType: text("source_type").notNull(),
  /** Clave natural estable para upsert (id de YouTube, "local:fichero.mp4"…). */
  externalKey: text("external_key").notNull().unique(),
  durationSeconds: numeric("duration_seconds"),
  /** video | image | screen_capture */
  mediaType: text("media_type").notNull().default("video"),
  provider: text("provider").notNull().default("unknown"),
  embedUrl: text("embed_url"),
  normalizedUrl: text("normalized_url"),
  canEmbed: boolean("can_embed").notNull().default(true),
  canCaptureFrame: boolean("can_capture_frame").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const analyzedFrames = pgTable("analyzed_frames", {
  id: uuid("id").primaryKey().defaultRandom(),
  videoId: uuid("video_id")
    .notNull()
    .references(() => videoSources.id, { onDelete: "cascade" }),
  timestampSeconds: numeric("timestamp_seconds").notNull().default("0"),
  imageUrl: text("image_url"),
  thumbDataUrl: text("thumb_data_url"),
  sceneSummary: text("scene_summary"),
  styleVibe: text("style_vibe"),
  /** pending | completed | failed */
  analysisStatus: text("analysis_status").notNull().default("completed"),
  sourceType: text("source_type"),
  rawVisionResponse: jsonb("raw_vision_response"),
  createdAt: createdAt(),
});

export const detectedItems = pgTable("detected_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  videoId: uuid("video_id")
    .notNull()
    .references(() => videoSources.id, { onDelete: "cascade" }),
  frameId: uuid("frame_id").references(() => analyzedFrames.id, {
    onDelete: "set null",
  }),
  sourceType: text("source_type"),
  sourceUrl: text("source_url"),
  timestampSeconds: numeric("timestamp_seconds").notNull().default("0"),
  timestampBucket: integer("timestamp_bucket").notNull().default(0),
  /** Huella de deduplicación (ver generateItemFingerprint). UNIQUE. */
  fingerprint: text("fingerprint").notNull().unique(),
  type: text("type"),
  category: text("category").notNull().default("general"),
  subcategory: text("subcategory"),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"),
  secondaryColors: text("secondary_colors").array().notNull().default([]),
  style: text("style"),
  pattern: text("pattern"),
  materialGuess: text("material_guess"),
  genderFit: text("gender_fit"),
  visibleBrand: text("visible_brand"),
  confidence: real("confidence").notNull().default(0),
  searchQuery: text("search_query"),
  marketplaceKeywords: text("marketplace_keywords").array().notNull().default([]),
  boundingBox: jsonb("bounding_box"),
  imageCropUrl: text("image_crop_url"),
  frameImageUrl: text("frame_image_url"),
  /** detected | reviewed | matched | ignored */
  status: text("status").notNull().default("detected"),
  /** Veces que se ha vuelto a ver el mismo objeto (sube en el dedupe). */
  detectionCount: integer("detection_count").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productRecommendations = pgTable("product_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  detectedItemId: uuid("detected_item_id")
    .notNull()
    .references(() => detectedItems.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  title: text("title").notNull(),
  productUrl: text("product_url").notNull(),
  imageUrl: text("image_url"),
  price: numeric("price"),
  currency: text("currency"),
  brand: text("brand"),
  similarityScore: real("similarity_score"),
  reason: text("reason"),
  /** exact | near_exact | similar | null (20260709000004) */
  matchType: text("match_type"),
  createdAt: createdAt(),
});

export const itemFeedback = pgTable("item_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  detectedItemId: uuid("detected_item_id")
    .notNull()
    .references(() => detectedItems.id, { onDelete: "cascade" }),
  recommendationId: uuid("recommendation_id").references(
    () => productRecommendations.id,
    { onDelete: "set null" }
  ),
  /** clicked | saved | rejected | purchased | ignored */
  action: text("action").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Caché de búsqueda visual (20260702000003)
// ---------------------------------------------------------------------------

export const visualSearchCache = pgTable("visual_search_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** lens:v1:<sha256> | shop:v1:<provider>:<query> */
  cacheKey: text("cache_key").notNull().unique(),
  provider: text("provider").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// Jobs de análisis asíncrono de vídeo (20260718000005)
// ---------------------------------------------------------------------------

export const mediaContents = pgTable("media_contents", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: text("file_name").notNull().default(""),
  mimeType: text("mime_type").notNull().default(""),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  durationSeconds: doublePrecision("duration_seconds").notNull().default(0),
  createdAt: createdAt(),
});

export const analysisJobs = pgTable("analysis_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  mediaContentId: uuid("media_content_id")
    .notNull()
    .references(() => mediaContents.id, { onDelete: "cascade" }),
  /** queued | running | partially_completed | completed | failed | cancelled */
  status: text("status").notNull().default("queued"),
  matchingMode: text("matching_mode").notNull().default("external-only"),
  analysisConfig: jsonb("analysis_config").notNull().default({}),
  checkpoint: jsonb("checkpoint").notNull().default({}),
  counters: jsonb("counters").notNull().default({}),
  timings: jsonb("timings").notNull().default({}),
  warnings: jsonb("warnings").notNull().default([]),
  error: text("error"),
  /** Verdad operativa del motor: tracker serializado para REANUDAR el job. */
  runtimeState: jsonb("runtime_state"),
  createdAt: createdAt(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** Metadata de frames recibidos. Nunca píxeles ni data URLs. */
export const mediaFrames = pgTable("media_frames", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => analysisJobs.id, { onDelete: "cascade" }),
  timestampSeconds: doublePrecision("timestamp_seconds").notNull(),
  analyzed: boolean("analyzed").notNull().default(false),
  sceneId: integer("scene_id"),
  createdAt: createdAt(),
});

export const mediaScenes = pgTable(
  "media_scenes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    sceneId: integer("scene_id").notNull(),
    startSeconds: doublePrecision("start_seconds").notNull(),
    endSeconds: doublePrecision("end_seconds").notNull(),
    frameCount: integer("frame_count").notNull().default(0),
  },
  (t) => [uniqueIndex("media_scenes_job_id_scene_id_key").on(t.jobId, t.sceneId)]
);

export const itemTracks = pgTable(
  "item_tracks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    category: text("category").notNull().default(""),
    name: text("name").notNull().default(""),
    color: text("color"),
    firstSeenSeconds: doublePrecision("first_seen_seconds").notNull(),
    lastSeenSeconds: doublePrecision("last_seen_seconds").notNull(),
    seenFrameCount: integer("seen_frame_count").notNull().default(0),
    confidence: doublePrecision("confidence").notNull().default(0),
    bestCrop: jsonb("best_crop").notNull().default({}),
    representativeItem: jsonb("representative_item").notNull().default({}),
  },
  (t) => [uniqueIndex("item_tracks_job_id_track_id_key").on(t.jobId, t.trackId)]
);

export const itemAppearances = pgTable("item_appearances", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => analysisJobs.id, { onDelete: "cascade" }),
  trackId: text("track_id").notNull(),
  timestampSeconds: doublePrecision("timestamp_seconds").notNull(),
  sceneId: integer("scene_id"),
  box: jsonb("box"),
  confidence: doublePrecision("confidence").notNull().default(0),
});

/** Productos ÚNICOS tras el dedup global + su resultado de matching. */
export const productMatches = pgTable(
  "product_matches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => analysisJobs.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    trackIds: jsonb("track_ids").notNull().default([]),
    item: jsonb("item").notNull().default({}),
    bestCrop: jsonb("best_crop").notNull().default({}),
    segments: jsonb("segments").notNull().default([]),
    matching: jsonb("matching"),
    externalSearchesUsed: integer("external_searches_used").notNull().default(0),
    skippedReason: text("skipped_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("product_matches_job_id_product_id_key").on(
      t.jobId,
      t.productId
    ),
  ]
);

/** Resultados de búsqueda externa por producto (auditoría de coste). */
export const externalSearchResults = pgTable("external_search_results", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => analysisJobs.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  provider: text("provider").notNull().default(""),
  result: jsonb("result").notNull().default({}),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Catálogo propio e ingesta (20260729000006)
// ---------------------------------------------------------------------------

export const catalogSources = pgTable("catalog_sources", {
  id: text("id").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: uuid("id").primaryKey(),
    source: text("source").notNull(),
    sourceProductId: text("source_product_id").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    brand: text("brand"),
    title: text("title").notNull(),
    category: text("category"),
    availability: text("availability").notNull().default("unknown"),
    sku: text("sku"),
    gtin: text("gtin"),
    contentHash: text("content_hash"),
    perceptualHash: text("perceptual_hash"),
    isActive: boolean("is_active").notNull().default(true),
    origin: text("origin").notNull().default("scraped"),
    /**
     * Documento completo (variantes, tallas, metadata…). Vive en jsonb para que
     * el modelo evolucione sin una migración por campo; las columnas de arriba
     * existen SOLO porque se filtran o indexan.
     */
    doc: jsonb("doc").notNull(),
    imageEmbedding: embedding("image_embedding"),
    textEmbedding: embedding("text_embedding"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("idx_products_source_pid").on(t.source, t.sourceProductId),
  ]
);

export const catalogProductVariants = pgTable("catalog_product_variants", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => catalogProducts.id, { onDelete: "cascade" }),
  color: text("color"),
  size: text("size"),
  sku: text("sku"),
  price: numeric("price", { precision: 12, scale: 2 }),
  currency: text("currency"),
  availability: text("availability").notNull().default("unknown"),
});

export const catalogProductImages = pgTable(
  "catalog_product_images",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => catalogProducts.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Ruta en el proveedor de storage. El binario NUNCA vive en Postgres. */
    localPath: text("local_path"),
    sha256: text("sha256"),
    perceptualHash: text("perceptual_hash"),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("catalog_product_images_product_id_sha256_key").on(
      t.productId,
      t.sha256
    ),
  ]
);

export const catalogPrices = pgTable("catalog_prices", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => catalogProducts.id, { onDelete: "cascade" }),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  originalPrice: numeric("original_price", { precision: 12, scale: 2 }),
  currency: text("currency").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const catalogSyncJobs = pgTable("catalog_sync_jobs", {
  jobId: uuid("job_id").primaryKey(),
  type: text("type").notNull(),
  source: text("source"),
  mode: text("mode"),
  status: text("status").notNull().default("queued"),
  /** Estado completo del job. El checkpoint es de forma libre por tipo. */
  doc: jsonb("doc").notNull(),
  createdAt: createdAt(),
});

export const catalogSyncErrors = pgTable("catalog_sync_errors", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => catalogSyncJobs.jobId, { onDelete: "cascade" }),
  url: text("url"),
  message: text("message").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const providerUsage = pgTable("provider_usage", {
  provider: text("provider").primaryKey(),
  calls: bigint("calls", { mode: "number" }).notNull().default(0),
  errors: bigint("errors", { mode: "number" }).notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actor: text("actor").notNull().default("system"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  detail: jsonb("detail"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Logs del scraper, caché de IA y uso del modelo (20260730000007)
// ---------------------------------------------------------------------------

export const catalogJobLogs = pgTable("catalog_job_logs", {
  id: uuid("id").primaryKey(),
  jobId: uuid("job_id"),
  connectorId: text("connector_id"),
  level: text("level").notNull(),
  stage: text("stage").notNull(),
  message: text("message").notNull(),
  url: text("url"),
  productId: uuid("product_id"),
  durationMs: integer("duration_ms"),
  retry: integer("retry"),
  metadata: jsonb("metadata"),
  /** Orden monótono DENTRO de una invocación: cursor del streaming del admin. */
  seq: bigint("seq", { mode: "number" }).notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Caché de extracciones por IA. `cache_key` = sha256(dominio|url|hash del
 * DOM|versión de schema|modelo): al cambiar cualquiera de los cinco la clave
 * cambia y se vuelve a extraer. Es la política de invalidación completa, sin
 * TTL que adivinar.
 */
export const catalogAiExtractions = pgTable("catalog_ai_extractions", {
  cacheKey: text("cache_key").primaryKey(),
  url: text("url").notNull(),
  domain: text("domain").notNull(),
  domHash: text("dom_hash").notNull(),
  model: text("model").notNull(),
  schemaVersion: text("schema_version").notNull(),
  extraction: jsonb("extraction").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  /** Aciertos de caché: mide el ahorro real, no el teórico. */
  hits: integer("hits").notNull().default(0),
  createdAt: createdAt(),
  lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
});

/** Uso del modelo agregado por día, modelo y conector. */
export const catalogAiUsage = pgTable(
  "catalog_ai_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    day: date("day").notNull().defaultNow(),
    model: text("model").notNull(),
    connectorId: text("connector_id"),
    jobId: uuid("job_id"),
    calls: integer("calls").notNull().default(0),
    cachedCalls: integer("cached_calls").notNull().default(0),
    promptTokens: bigint("prompt_tokens", { mode: "number" })
      .notNull()
      .default(0),
    completionTokens: bigint("completion_tokens", { mode: "number" })
      .notNull()
      .default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("catalog_ai_usage_day_model_connector_id_job_id_key").on(
      t.day,
      t.model,
      t.connectorId,
      t.jobId
    ),
  ]
);

/**
 * Bookkeeping del aplicador de migraciones (scripts/migrate.ts). Se declara
 * para que las herramientas que introspeccionan el esquema no la vean como
 * tabla huérfana, pero la crea el runner, no Drizzle.
 */
export const catalogMigrations = pgTable("_catalog_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Tipos de fila inferidos, para los repositorios.
export type VideoSource = typeof videoSources.$inferSelect;
export type DetectedItem = typeof detectedItems.$inferSelect;
export type CatalogProduct = typeof catalogProducts.$inferSelect;
export type CatalogSyncJob = typeof catalogSyncJobs.$inferSelect;
export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
