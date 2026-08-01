import type { FrameAnalysis } from "@/lib/types";
import type {
  CatalogItem,
  CatalogItemWithRecommendations,
  CatalogListItem,
  FrameSourceType,
  ItemFeedback,
  ProductRecommendation,
  VideoSource,
} from "@/lib/catalog/types";

/**
 * DTOs compartidos entre cliente y servidor. SOLO imports de tipos (se borran
 * al compilar), de modo que importarlos desde el cliente NO arrastra `pg` ni
 * código de servidor al bundle del navegador.
 */

/** Metadatos del frame que el cliente envía al backend al pausar. */
export type FrameMeta = {
  sourceType: FrameSourceType;
  /** Clave estable por vídeo (id de YouTube, "local:fichero.mp4", …). */
  videoKey: string;
  videoUrl?: string;
  videoTitle?: string;
  timestampSeconds: number;
  /** Tiempo de presentación exacto reportado por requestVideoFrameCallback. */
  mediaTime?: number;
  /** Identidad del frame capturado; no se redondea a segundos. */
  frameId?: string;
  /** SHA-256 del JPEG capturado, usado para caché/deduplicación. */
  frameHash?: string;
  /** Sesión cancelable creada por cada pausa. */
  analysisSessionId?: string;
  /** Origen del trabajo: preanálisis en reproducción o pausa interactiva. */
  analysisTrigger?: "preanalysis" | "pause" | "manual" | "image";
  /** Clave de caché/throttle del cliente (videoKey + ":" + segundo). Omitir para saltarse la caché. */
  cacheKey?: string;
  /** Proveedor detectado (youtube, dailymotion, vimeo, direct_mp4, hls, …). */
  provider?: string;
  /** URL canónica del vídeo. */
  normalizedUrl?: string;
  /** URL de embed del vídeo (si aplica). */
  embedUrl?: string;
  /** Si el proveedor soporta embed. */
  canEmbed?: boolean;
  /** Si el proveedor permite captura directa de frame. */
  canCaptureFrame?: boolean;
};

export type SavedCatalogItem = {
  item: CatalogItem;
  created: boolean;
  recommendations: ProductRecommendation[];
};

/** Estado de la persistencia del catálogo. */
export type PersistenceStatus = "postgres" | "memory" | "memory_fallback";

export type AnalyzeFrameSuccess = {
  ok: true;
  analysis: FrameAnalysis;
  /** Visión en modo demo (sin OPENAI_API_KEY). */
  mock: boolean;
  /** true si el catálogo persiste en base de datos; false si es en memoria. */
  persisted: boolean;
  /** Detalle del modo de persistencia (memory_fallback = DB caída, sesión en memoria). */
  persistence?: PersistenceStatus;
  videoId: string | null;
  frameId: string | null;
  /** Identidad de cliente que permite descartar respuestas antiguas. */
  analysisSessionId?: string;
  requestedFrameId?: string;
  mediaTime?: number;
  items: SavedCatalogItem[];
  warning?: string;
  /** Duraciones por etapa (detectionMs, enrichMs, persistenceMs, totalMs). */
  timings?: Record<string, number>;
};

export type AnalyzeFrameError = { ok: false; error: string; errorDetail?: string };
export type AnalyzeFrameApiResponse = AnalyzeFrameSuccess | AnalyzeFrameError;

export type CatalogListResponse =
  | {
      ok: true;
      items: CatalogListItem[];
      total: number;
      persisted: boolean;
      persistence?: PersistenceStatus;
    }
  | { ok: false; error: string };

export type CatalogItemResponse =
  | { ok: true; item: CatalogItemWithRecommendations }
  | { ok: false; error: string };

export type CatalogItemUpdateResponse =
  | { ok: true; item: CatalogItem }
  | { ok: false; error: string };

export type SearchProductsResponse =
  | { ok: true; recommendations: ProductRecommendation[]; mock: boolean }
  | { ok: false; error: string };

export type FeedbackResponse =
  | { ok: true; feedback: ItemFeedback }
  | { ok: false; error: string };

export type FramesResponse =
  | { ok: true; video: VideoSource | null; frames: import("@/lib/catalog/types").AnalyzedFrame[] }
  | { ok: false; error: string };
