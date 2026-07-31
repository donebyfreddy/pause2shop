import type { BadgeTone } from "@/components/ui";
import type {
  AccessStrategy,
  ComplianceMode,
  ConnectorEffectiveStatus,
  ConnectorHealthState,
  ConnectorLifecycle,
  JobLogLevel,
  JobStage,
  JobStatus,
  StoreTier,
  VerificationLevel,
} from "@/lib/catalogService/types";

/**
 * Traducción de estados del servicio a etiqueta + tono + explicación.
 *
 * Está centralizado a propósito: es donde se decide qué se le dice al operador.
 * Regla que se respeta en todo el mapa: NO pintamos de verde lo que no está
 * comprobado. `not_checked` y `ready_to_configure` son neutros, no positivos —
 * el admin tiene que reflejar el estado real, no dar buena impresión.
 */

export type StatusMeta = { label: string; tone: BadgeTone; description: string };

export const HEALTH_META: Record<ConnectorHealthState, StatusMeta> = {
  available: {
    label: "Disponible",
    tone: "success",
    description: "La tienda respondió correctamente y robots.txt permite el acceso.",
  },
  paused: {
    label: "Pausado",
    tone: "warning",
    description: "Pausado desde el admin: no se lanzan syncs.",
  },
  blocked: {
    label: "Bloqueado",
    tone: "danger",
    description:
      "La tienda bloquea el acceso automatizado (403/429). No se intenta eludir: la fuente necesita vía de partner o afiliación.",
  },
  disallowed: {
    label: "robots.txt",
    tone: "danger",
    description: "El robots.txt de la tienda no permite las rutas de catálogo.",
  },
  error: {
    label: "Error",
    tone: "danger",
    description: "Fallos consecutivos o circuit breaker abierto.",
  },
  not_checked: {
    label: "Sin comprobar",
    tone: "muted",
    description:
      "No se ha medido el estado live en esta sesión. Usa «Probar conector» para comprobarlo de verdad.",
  },
};

export const LIFECYCLE_META: Record<ConnectorLifecycle, StatusMeta> = {
  implemented: {
    label: "Implementado",
    tone: "success",
    description: "Código específico verificado contra fixtures reales de la tienda.",
  },
  ready_to_configure: {
    label: "Listo, sin verificar",
    tone: "info",
    description:
      "Implementado por el motor genérico (sitemap/robots + JSON-LD), pero sin verificar contra esta tienda concreta.",
  },
  needs_credentials: {
    label: "Faltan credenciales",
    tone: "warning",
    description: "La vía de acceso existe, pero faltan variables de entorno.",
  },
  partner_required: {
    label: "Requiere acuerdo",
    tone: "warning",
    description:
      "Solo accesible por API de partner o red de afiliación. No se ingiere nada hasta tener el acuerdo.",
  },
  pending: {
    label: "Pendiente",
    tone: "muted",
    description: "Reservado en el registro, sin implementación.",
  },
};

export const ACCESS_META: Record<AccessStrategy, StatusMeta> = {
  sitemap_jsonld: {
    label: "Sitemap + JSON-LD",
    tone: "neutral",
    description: "Sitemaps públicos y datos estructurados schema.org de la ficha.",
  },
  product_feed: {
    label: "Feed de producto",
    tone: "neutral",
    description: "Feed público publicado por la marca.",
  },
  partner_api: {
    label: "API de partner",
    tone: "info",
    description: "API con credenciales y contrato comercial.",
  },
  affiliate_feed: {
    label: "Feed de afiliación",
    tone: "info",
    description: "Feed de producto de una red de afiliación (Awin, Rakuten…).",
  },
  unavailable: {
    label: "Sin vía",
    tone: "muted",
    description: "Sin vía de acceso legítima conocida a día de hoy.",
  },
};

export const COMPLIANCE_META: Record<ComplianceMode, StatusMeta> = {
  public_structured_data: {
    label: "Datos públicos",
    tone: "success",
    description: "robots.txt respetado, rate limit educado, datos estructurados públicos.",
  },
  partner_agreement: {
    label: "Contrato partner",
    tone: "warning",
    description: "Requiere contrato firmado antes de ingerir.",
  },
  affiliate_agreement: {
    label: "Alta afiliación",
    tone: "warning",
    description: "Requiere alta aprobada en la red de afiliación.",
  },
  legal_review: {
    label: "Revisión legal",
    tone: "danger",
    description: "Bloqueado a la espera de revisión legal o comercial.",
  },
};

export const VERIFICATION_META: Record<VerificationLevel, StatusMeta> = {
  live: {
    label: "Verificado en vivo",
    tone: "success",
    description:
      "Se han extraído y guardado productos REALES de esta tienda. Es la única verificación que no se puede declarar a mano.",
  },
  fixtures: {
    label: "Fixtures reales",
    tone: "success",
    description: "Extracción cubierta por tests contra HTML capturado de la tienda.",
  },
  contract: {
    label: "Contrato probado",
    tone: "info",
    description:
      "Hay tests del contrato de extracción, pero contra fixtures sintéticos: demuestran que sabemos leer la forma documentada, no que la tienda siga publicándola.",
  },
  live_unverified: {
    label: "Sin verificar",
    tone: "muted",
    description: "Implementación genérica: no se ha validado contra esta tienda.",
  },
  none: {
    label: "N/D",
    tone: "muted",
    description: "Nada que verificar todavía.",
  },
};

export const JOB_META: Record<JobStatus, StatusMeta> = {
  queued: { label: "En cola", tone: "neutral", description: "Esperando worker libre." },
  running: { label: "Ejecutando", tone: "info", description: "En curso." },
  // Los estados de etapa dicen QUÉ está haciendo el job ahora mismo, que es
  // mucho más útil que un "ejecutando" genérico durante varios minutos.
  discovering: {
    label: "Descubriendo",
    tone: "info",
    description: "Recorriendo sitemaps o categorías para encontrar URLs de ficha.",
  },
  scraping: {
    label: "Extrayendo",
    tone: "info",
    description: "Descargando y extrayendo fichas de producto.",
  },
  // Etapas propias de la importación de datasets. Separarlas de "extrayendo"
  // permite ver si lo que va lento es el proveedor del dataset o el storage.
  downloading: {
    label: "Descargando",
    tone: "info",
    description: "Leyendo filas e imágenes del dataset de origen.",
  },
  uploading_images: {
    label: "Subiendo imágenes",
    tone: "info",
    description: "Publicando las imágenes en el almacenamiento persistente.",
  },
  normalizing: {
    label: "Normalizando",
    tone: "info",
    description: "Convirtiendo lo extraído al modelo del catálogo.",
  },
  saving: { label: "Guardando", tone: "info", description: "Escribiendo productos en la base." },
  embedding: {
    label: "Indexando",
    tone: "info",
    description: "Procesando imágenes y generando embeddings.",
  },
  completed: { label: "Completado", tone: "success", description: "Terminó sin quedar pendiente." },
  partially_completed: {
    label: "Parcial",
    tone: "warning",
    description: "Terminó con parte pendiente: reintentable desde su checkpoint.",
  },
  failed: { label: "Fallido", tone: "danger", description: "Terminó con error." },
  cancelled: { label: "Cancelado", tone: "muted", description: "Cancelado manualmente." },
};

/**
 * Los OCHO estados honestos. Este mapa es la política de honestidad hecha UI:
 * solo `implemented_verified` es verde, y solo se alcanza con productos reales
 * en el catálogo. Todo lo demás es neutro, ámbar o rojo.
 */
export const EFFECTIVE_STATUS_META: Record<ConnectorEffectiveStatus, StatusMeta> = {
  implemented_verified: {
    label: "Verificado",
    tone: "success",
    description:
      "Hay código real Y se han extraído productos reales de esta tienda. Es la única etiqueta verde.",
  },
  implemented_unverified: {
    label: "Sin verificar",
    tone: "info",
    description:
      "Hay implementación real, pero NADIE ha comprobado esta tienda concreta: no hay productos suyos en el catálogo.",
  },
  partner_required: {
    label: "Requiere acuerdo",
    tone: "warning",
    description:
      "Necesita API de partner o alta de afiliación. No se ingiere nada hasta tener el acuerdo firmado.",
  },
  blocked_by_robots: {
    label: "robots.txt",
    tone: "danger",
    description: "El robots.txt de la tienda prohíbe las rutas de catálogo. Se respeta.",
  },
  blocked_or_challenged: {
    label: "Bloqueado",
    tone: "danger",
    description:
      "La tienda bloquea el acceso automatizado o presenta un challenge anti-bot. NO se intenta eludir.",
  },
  paused: {
    label: "Pausado",
    tone: "warning",
    description: "Pausado desde el admin o deshabilitado en su definición.",
  },
  error: {
    label: "Error",
    tone: "danger",
    description: "Fallos sostenidos: el circuit breaker está abierto.",
  },
  pending: {
    label: "Pendiente",
    tone: "muted",
    description: "Reservado en el registro, sin implementación activa.",
  },
};

/** Etapas del pipeline: etiqueta corta para la consola de logs. */
export const STAGE_LABEL: Record<JobStage, string> = {
  job: "JOB",
  robots: "ROBOTS",
  discover: "DISCOVER",
  navigate: "NAVIGATE",
  parse_jsonld: "JSON-LD",
  parse_dom: "DOM",
  ai_extract: "IA",
  normalize: "NORMALIZE",
  download_image: "IMAGEN",
  embedding: "EMBEDDING",
  database: "DATABASE",
  complete: "COMPLETE",
  error: "ERROR",
};

/**
 * Colores por nivel de log. Elegidos sobre los tokens del sistema para cumplir
 * contraste AA en claro y oscuro: el nivel NUNCA se codifica solo con color
 * (siempre va acompañado de su etiqueta en texto).
 */
export const LOG_LEVEL_STYLE: Record<
  JobLogLevel,
  { label: string; dot: string; text: string }
> = {
  debug: { label: "DEBUG", dot: "bg-ink-faint", text: "text-ink-faint" },
  info: { label: "INFO", dot: "bg-info", text: "text-info" },
  success: { label: "OK", dot: "bg-success", text: "text-success" },
  warn: { label: "WARN", dot: "bg-warning", text: "text-warning" },
  error: { label: "ERROR", dot: "bg-danger", text: "text-danger" },
};

export const TIER_LABEL: Record<StoreTier, string> = {
  fast_fashion: "Fast fashion",
  premium: "Premium",
  luxury: "Lujo",
  sportswear: "Deporte",
  marketplace: "Marketplace",
  department_store: "Grandes almacenes",
  dtc: "DTC",
};

export const JOB_TYPE_LABEL: Record<string, string> = {
  sync_full: "Sync completo",
  sync_incremental: "Sync incremental",
  refresh_prices: "Refresco de precios",
  refresh_availability: "Refresco de stock",
  reindex_embeddings: "Reindexado de embeddings",
  cleanup_inactive: "Limpieza de inactivos",
  retry_failed: "Reintento",
  dataset_import: "Importación de dataset",
};

/** Fallback seguro: un estado nuevo del backend se muestra tal cual, en neutro. */
export function metaFor<T extends string>(
  map: Record<string, StatusMeta>,
  key: T | null | undefined
): StatusMeta {
  if (!key) return { label: "—", tone: "muted", description: "" };
  return map[key] ?? { label: key, tone: "neutral", description: "" };
}

/** Fecha relativa corta en español ("hace 4 min", "hace 2 h"). */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "hace segundos";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString("es-ES");
}

export function formatDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatPrice(price: number | null, currency: string | null): string {
  if (price == null) return "—";
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${price} ${currency ?? ""}`.trim();
  }
}
