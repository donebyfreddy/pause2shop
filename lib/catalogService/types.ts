/**
 * Tipos del contrato HTTP del servicio de catálogo, tal y como los consume el
 * admin. Se mantienen en la app (y no se importan del otro paquete) porque son
 * el contrato de red: si el servicio cambia una forma, tiene que romper aquí de
 * forma visible, no colarse por un import compartido.
 */

export type ConnectorImplementation = "bespoke" | "declarative" | "scaffold";

export type AccessStrategy =
  | "sitemap_jsonld"
  | "product_feed"
  | "partner_api"
  | "affiliate_feed"
  | "unavailable";

export type ComplianceMode =
  | "public_structured_data"
  | "partner_agreement"
  | "affiliate_agreement"
  | "legal_review";

export type ConnectorLifecycle =
  | "implemented"
  | "ready_to_configure"
  | "needs_credentials"
  | "partner_required"
  | "pending";

export type ConnectorHealthState =
  | "available"
  | "paused"
  | "blocked"
  | "disallowed"
  | "error"
  | "not_checked";

export type VerificationLevel = "live" | "fixtures" | "contract" | "live_unverified" | "none";

/**
 * Los OCHO estados honestos que muestra el admin. `implemented_verified` NO se
 * declara en el spec: lo deriva el servidor solo si la fuente tiene productos
 * reales extraídos en el catálogo.
 */
export type ConnectorEffectiveStatus =
  | "implemented_verified"
  | "implemented_unverified"
  | "partner_required"
  | "blocked_by_robots"
  | "blocked_or_challenged"
  | "paused"
  | "error"
  | "pending";

/** Etapas del pipeline de ingesta (lista cerrada). */
export type JobStage =
  | "job"
  | "robots"
  | "discover"
  | "navigate"
  | "parse_jsonld"
  | "parse_dom"
  | "ai_extract"
  | "normalize"
  | "download_image"
  | "embedding"
  | "database"
  | "complete"
  | "error";

export type JobLogLevel = "debug" | "info" | "success" | "warn" | "error";

export type JobLogEntry = {
  id: string;
  jobId: string | null;
  connectorId: string | null;
  level: JobLogLevel;
  stage: JobStage;
  message: string;
  url?: string | null;
  productId?: string | null;
  durationMs?: number | null;
  retry?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  seq: number;
};

export type ScraperLogsResponse = {
  logs: JobLogEntry[];
  /** `memory` = solo esta invocación; `memory+db` = incluye histórico. */
  source: "memory" | "memory+db";
  stages: JobStage[];
  summary: {
    byLevel: Record<JobLogLevel, number>;
    byStage: Record<string, number>;
    total: number;
  };
  cursor: number;
};

export type ScraperStatus = {
  ai: {
    enabled: boolean;
    model: string;
    unavailableReason: string | null;
    maxHtmlChars: number;
    cachePersistent: boolean;
    apiKeyPresent: boolean;
  };
  browser: {
    enabled: boolean;
    headless: boolean;
    connected: boolean;
    openPages: number;
    contexts: number;
    unavailableReason: string | null;
    remoteEndpointConfigured: boolean;
    circuits: Array<{ host: string; open: boolean; failures: number; lastError: string }>;
  };
  limits: {
    maxConcurrency: number;
    requestDelayMs: number;
    navigationTimeoutMs: number;
    maxRetries: number;
    batchSize: number;
    maxProductsPerSource: number;
  };
  persistence: {
    catalogBackend: "postgres" | "file";
    jobLogsPersistent: boolean;
    productionGrade: boolean;
  };
  robotsPolicy: string;
  warnings: string[];
};

/** Cómo se han extraído los productos de una fuente. */
export type ExtractionStats = {
  total: number;
  withAi: number;
  withoutAi: number;
  withBrowser: number;
  aiRatio: number | null;
  avgConfidence: number | null;
  aiCostUsd: number;
  byPrimaryExtractor: Record<string, number>;
};

export type StoreTier =
  | "fast_fashion"
  | "premium"
  | "luxury"
  | "sportswear"
  | "marketplace"
  | "department_store"
  | "dtc";

export type JobStatus =
  | "queued"
  | "running"
  | "discovering"
  | "scraping"
  | "normalizing"
  | "saving"
  | "embedding"
  | "partially_completed"
  | "completed"
  | "failed"
  | "cancelled";

export type JobProgress = {
  discovered: number;
  fetched: number;
  new: number;
  updated: number;
  duplicates: number;
  errors: number;
  ignored: number;
  retries: number;
  withAi: number;
  withoutAi: number;
  withBrowser: number;
  aiCostUsd: number;
  aiTokens: number;
  stage: string | null;
};

export type JobRecord = {
  jobId: string;
  type: string;
  source: string | null;
  mode: "full" | "incremental" | null;
  status: JobStatus;
  progress: JobProgress;
  checkpoint: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  errors: Array<{ url: string; message: string }>;
  // Derivados que calcula el servidor para que el cliente no reimplemente (y
  // desincronice) la aritmética de la barra de progreso.
  stage: string | null;
  processed: number;
  percent: number | null;
  productsPerMinute: number | null;
  aiRatio: number | null;
  resumeIndex: number | null;
  isActive: boolean;
  isTerminal: boolean;
};

export type Connector = {
  id: string;
  label: string;
  brand: string;
  group: string | null;
  homeUrl: string;
  sitemapUrls: string[];
  region: string;
  markets: string[];
  tier: StoreTier;
  segments: string[];
  categories: string[];
  implementation: ConnectorImplementation;
  access: AccessStrategy;
  compliance: ComplianceMode;
  lifecycle: ConnectorLifecycle;
  verification: VerificationLevel;
  syncModes: Array<"full" | "incremental">;
  requiresEnv: string[];
  notes: string;
  docsUrl: string | null;
  canSync: boolean;
  status: string;
  health: ConnectorHealthState;
  paused: boolean;
  note: string;
  healthCheckedAt: string | null;
  lastSyncAt: string | null;
  productCount: number;
  missingEnv: string[];
  // --- Scraper modular ---
  effectiveStatus: ConnectorEffectiveStatus;
  effectiveStatusLabel: string;
  /** Demostrado con productos reales en el catálogo, no declarado. */
  verifiedLive: boolean;
  crawlDelaySeconds: number | null;
  extraction: ExtractionStats;
  lastError: { message: string; url: string; at: string } | null;
  robotsPolicy: string;
  requiresAgreement: boolean;
  enabled: boolean;
  baseUrl: string;
  accessType: AccessStrategy;
  maturity: ConnectorLifecycle;
  complianceMode: ComplianceMode;
  segment: string;
  allProductUrlPatterns: string[];
  discoveryKinds: string[];
  selectorFields: string[];
};

export type ConnectorDetail = Connector & {
  recentJobs: JobRecord[];
  logs: LogEntry[];
};

export type RegistrySummary = {
  total: number;
  byLifecycle: Record<string, number>;
  byAccess: Record<string, number>;
  byCompliance: Record<string, number>;
  byTier: Record<string, number>;
  syncable: number;
  verifiedWithFixtures: number;
};

export type ConnectorsResponse = {
  connectors: Connector[];
  summary: RegistrySummary;
  syncable: string[];
};

export type ConnectorTestResult = {
  id: string;
  label: string;
  ok: boolean;
  steps: Array<{ step: string; ok: boolean; detail: string; ms: number }>;
  sampleUrl: string | null;
  sampleTitle: string | null;
  samplePrice: number | null;
  sampleImage: string | null;
  extractorsUsed: string[];
  aiUsed: boolean;
  browserUsed: boolean;
  durationMs: number;
};

export type LogEntry = {
  id: number;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  context: Record<string, unknown>;
};

export type LogsResponse = {
  logs: LogEntry[];
  counts: Record<"debug" | "info" | "warn" | "error", number>;
  retention: string;
  minLevelEmitted: string;
};

export type Overview = {
  catalog: {
    totalProducts: number;
    activeProducts: number;
    withImages: number;
    withEmbeddings: number;
    duplicatesDetected: number;
    bySource: Record<string, number>;
    byOrigin: Record<string, number>;
  };
  connectors: RegistrySummary & { paused: number; lastSyncAt: string | null };
  embeddings: { provider: string; model: string; dimension: number; coverage: number };
  queue: {
    byStatus: Record<string, number>;
    running: number;
    queued: number;
    recent: JobRecord[];
  };
  throughput: {
    windowMinutes: number;
    products: number;
    perMinute: number;
    bySource: Record<string, number>;
  };
  errorRate: number;
  logs: { counts: Record<string, number>; recent: LogEntry[] };
  backend: "postgres" | "file";
  uptimeSeconds: number;
};

/** Trazabilidad de la extracción tal y como la sirve la API. */
export type ProductExtractionMeta = {
  extractorsUsed: string[];
  primaryExtractor: string | null;
  aiUsed: boolean;
  browserUsed: boolean;
  aiModel: string | null;
  aiCostUsd: number;
  aiTokens: number;
  confidence: number;
  evidence: Array<{ field: string; source: string; snippet: string; confidence: number }>;
  warnings: string[];
  extractedAt: string;
  durationMs: number;
};

export type CatalogProductSummary = {
  id: string;
  source: string;
  brand: string | null;
  title: string;
  category: string | null;
  subcategory: string | null;
  gender: string | null;
  color: string | null;
  price: number | null;
  originalPrice: number | null;
  currency: string | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  canonicalUrl: string;
  primaryImage: string | null;
  images: Array<{ url: string; localPath: string | null; perceptualHash: string | null }>;
  hasImageEmbedding: boolean;
  hasTextEmbedding: boolean;
  perceptualHash: string | null;
  lastSeenAt: string;
  firstSeenAt: string;
  isActive: boolean;
  origin: "scraped" | "externally_discovered";
  externalScore: number | null;
  /** Null en productos descubiertos por proveedores externos. */
  extraction: ProductExtractionMeta | null;
};

export type ProductsResponse = {
  products: CatalogProductSummary[];
  total: number;
  page: number;
  limit: number;
};

export type SearchMatch = {
  productId: string;
  title: string;
  brand: string | null;
  image: string | null;
  productUrl: string;
  price: number | null;
  currency: string | null;
  availability: string;
  visualScore: number;
  textScore: number;
  attributeScore: number;
  finalScore: number;
  matchStage: string;
  origin: string;
};

export type SearchResponse = { queryId: string; matches: SearchMatch[] };

export type Settings = {
  service: {
    port: number;
    logLevel: string;
    apiKey: { configured: boolean; length: number };
    authEnforced: boolean;
  };
  storage: {
    backend: "postgres" | "file";
    databaseConfigured: boolean;
    dataDir: string;
    imagesDir: string;
  };
  embeddings: {
    imageProvider: string;
    imageModel: string;
    textProvider: string;
    active: { name: string; model: string; dimension: number };
  };
  matching: {
    minImageScore: number;
    perceptualHashMaxDistance: number;
    embeddingDedupThreshold: number;
  };
  scraping: {
    rateLimitPerDomainMs: number;
    maxConcurrency: number;
    requestTimeoutMs: number;
    maxRetries: number;
    circuitBreakerThreshold: number;
    userAgent: string;
    robotsPolicy: string;
  };
  jobs: { workers: number };
};
