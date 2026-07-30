/**
 * Metadatos del sistema de conectores.
 *
 * Separamos DOS ejes que antes iban mezclados en un único "status", y que en un
 * catálogo de 50+ fuentes son preguntas distintas:
 *
 *  1. `lifecycle` — madurez de NUESTRA implementación (¿hay código?, ¿está
 *     verificado?, ¿faltan credenciales?). Es un dato declarado, estable.
 *  2. `health`    — estado OPERATIVO ahora mismo (¿la tienda responde?, ¿nos
 *     bloquea?, ¿robots.txt lo permite?). Se mide en runtime.
 *
 * El admin muestra los dos: así nunca decimos "disponible" por algo que solo
 * está esbozado, ni "roto" por algo que simplemente requiere un acuerdo.
 */

import type { ConnectorSelectors } from "../../extraction/dom";

export type { ConnectorSelectors };

/** Cómo está implementado el conector. */
export type ConnectorImplementation =
  /** Subclase propia con extracción específica de la tienda. */
  | "bespoke"
  /** Motor genérico sitemap + datos estructurados, configurado por spec. */
  | "declarative"
  /** Solo esqueleto: sin vía de acceso legítima disponible todavía. */
  | "scaffold";

/** Vía por la que se obtiene el catálogo. */
export type AccessStrategy =
  /** Sitemaps públicos + JSON-LD schema.org/Product en la ficha. */
  | "sitemap_jsonld"
  /** Feed de producto público (XML/CSV) publicado por la marca. */
  | "product_feed"
  /** API de partner con credenciales y acuerdo comercial. */
  | "partner_api"
  /** Feed de red de afiliación (Awin, Rakuten, TradeDoubler, CJ, Impact…). */
  | "affiliate_feed"
  /** Sin vía legítima conocida a día de hoy. */
  | "unavailable";

/** Marco de cumplimiento bajo el que opera la fuente. */
export type ComplianceMode =
  /** Datos estructurados públicos, robots.txt respetado, rate limit educado. */
  | "public_structured_data"
  /** Requiere contrato/API de partner firmado antes de ingerir nada. */
  | "partner_agreement"
  /** Requiere alta aprobada en una red de afiliación. */
  | "affiliate_agreement"
  /** Bloqueado a la espera de revisión legal o comercial. */
  | "legal_review";

/** Madurez de la implementación (declarada, no medida). */
export type ConnectorLifecycle =
  /** Código real y verificado contra fixtures reales de la tienda. */
  | "implemented"
  /** Código real (motor declarativo) pero sin verificar contra la tienda. */
  | "ready_to_configure"
  /** La vía existe pero faltan credenciales en el entorno. */
  | "needs_credentials"
  /** Requiere acuerdo de partner/afiliación antes de poder activarse. */
  | "partner_required"
  /** Reservado en el registro, sin implementación. */
  | "pending";

/** Estado operativo medido en runtime. */
export type ConnectorHealthState =
  /** Responde y robots.txt permite el acceso. */
  | "available"
  /** Pausado desde el admin. */
  | "paused"
  /** La tienda bloquea el acceso automatizado (403/429/challenge). */
  | "blocked"
  /** robots.txt prohíbe las rutas de catálogo. */
  | "disallowed"
  /** Fallos consecutivos / circuit breaker abierto. */
  | "error"
  /** No aplica todavía (scaffold) o no se ha comprobado. */
  | "not_checked";

/**
 * Grado de verificación de la extracción, de más fuerte a más débil. La
 * distinción entre `fixtures` y `contract` es deliberada: un test contra HTML
 * CAPTURADO de la tienda demuestra que sabemos leer esa tienda; un test contra
 * un fixture escrito a mano solo demuestra que sabemos leer la FORMA que
 * documentamos. No es lo mismo y no se debe presentar como si lo fuera.
 */
export type VerificationLevel =
  /** Extracción comprobada CONTRA LA TIENDA REAL: productos reales guardados. */
  | "live"
  /** Tests contra HTML real capturado de la tienda. */
  | "fixtures"
  /** Tests contra fixtures SINTÉTICOS que reproducen la forma documentada. */
  | "contract"
  /** Implementación genérica, sin verificar contra la tienda concreta. */
  | "live_unverified"
  /** Nada que verificar (scaffold). */
  | "none";

export type StoreTier =
  | "fast_fashion"
  | "premium"
  | "luxury"
  | "sportswear"
  | "marketplace"
  | "department_store"
  | "dtc";

export type SyncMode = "full" | "incremental";

/**
 * Cómo se descubren las URLs de ficha en esta fuente. Se declaran en orden de
 * preferencia y el motor las prueba en ese orden hasta llenar el límite.
 */
export type DiscoveryStrategy =
  /** Sitemap index / product sitemaps declarados o hallados en robots.txt. */
  | { kind: "sitemap"; urls?: string[] }
  /** Recorrido de páginas de categoría siguiendo la paginación. */
  | { kind: "category_crawl"; urls: string[]; maxPages?: number }
  /** Feed de producto autorizado (XML/CSV/JSON). */
  | { kind: "feed"; url: string; format: "xml" | "csv" | "json" }
  /** Solo filtrado por patrón de URL sobre URLs ya conocidas. */
  | { kind: "url_patterns" };

/**
 * Política frente a robots.txt. Hay un solo valor a propósito: NO existe una
 * opción para ignorarlo. Está declarado como campo para que el admin pueda
 * mostrar explícitamente que cada fuente lo respeta.
 */
export type RobotsPolicy = "respect";

/** Cómo se permite extraer en esta fuente. */
export interface ExtractionPolicy {
  /** ¿Se puede renderizar con navegador si el HTML plano no basta? */
  allowBrowser: boolean;
  /** ¿Se puede usar OpenAI como fallback de extracción? */
  allowAi: boolean;
  /** Selector a esperar al renderizar (típicamente el del precio). */
  waitForSelector?: string;
}

/**
 * Definición declarativa de una fuente. Todo lo que el motor genérico necesita
 * para descubrir, extraer y clasificar productos de una tienda.
 */
export interface ConnectorSpec {
  id: string;
  label: string;
  /** Marca normalizada que se escribe en el producto. */
  brand: string;
  /** Grupo empresarial (Inditex, H&M Group…). Útil para agrupar en el admin. */
  group: string | null;
  homeUrl: string;
  /** Sitemaps candidatos en orden de preferencia. Puede ir vacío: el motor
   *  cae al descubrimiento vía `Sitemap:` de robots.txt. */
  sitemapUrls: string[];
  /** Regex (source) que identifica una URL de ficha de producto. */
  productUrlPattern: string;
  /** Regex (source) con UN grupo de captura: el id estable del producto. */
  productIdPattern: string | null;
  region: string;
  markets: string[];
  tier: StoreTier;
  segments: Array<"women" | "men" | "kids" | "unisex">;
  categories: string[];
  implementation: ConnectorImplementation;
  access: AccessStrategy;
  compliance: ComplianceMode;
  lifecycle: ConnectorLifecycle;
  verification: VerificationLevel;
  syncModes: SyncMode[];
  /** Variables de entorno necesarias para activar la fuente (credenciales). */
  requiresEnv: string[];
  /** Nota honesta: qué falta, qué se sabe, dónde está el riesgo. */
  notes: string;
  /** Documentación del programa de partners/afiliados, si aplica. */
  docsUrl: string | null;

  // --- Scraper modular -------------------------------------------------

  /**
   * Patrones ADICIONALES de URL de ficha. `productUrlPattern` sigue siendo el
   * principal; esta lista permite tiendas con varias formas de URL (migración
   * de plantilla, mercados con rutas distintas) sin un regex ilegible.
   */
  productUrlPatterns: string[];
  /** Estrategias de descubrimiento, en orden de preferencia. */
  discoveryStrategies: DiscoveryStrategy[];
  /** Selectores CSS por campo, para el extractor de selectores. */
  selectors: ConnectorSelectors | null;
  /** Siempre "respect": no hay opción de ignorar robots.txt. */
  robotsPolicy: RobotsPolicy;
  /** Qué se permite hacer para extraer en esta fuente. */
  extraction: ExtractionPolicy;
  /** ¿Requiere un acuerdo firmado (partner/afiliación) antes de ingerir? */
  requiresAgreement: boolean;
  /** Interruptor declarativo: una fuente deshabilitada no sincroniza nunca. */
  enabled: boolean;
}

/**
 * Los OCHO estados honestos que se muestran en el admin. Combinan los dos ejes
 * (madurez declarada + salud medida) en una sola etiqueta legible, con una
 * regla dura: nada llega a `implemented_verified` sin una prueba real.
 */
export type ConnectorEffectiveStatus =
  /** Hay código y se ha demostrado que extrae productos reales de esa tienda. */
  | "implemented_verified"
  /** Hay código real, pero nadie ha comprobado esta tienda concreta. */
  | "implemented_unverified"
  /** Necesita un acuerdo de partner/afiliación antes de poder activarse. */
  | "partner_required"
  /** robots.txt prohíbe las rutas de catálogo. */
  | "blocked_by_robots"
  /** La tienda bloquea o presenta un challenge anti-bot. */
  | "blocked_or_challenged"
  /** Pausado desde el admin (o deshabilitado en el spec). */
  | "paused"
  /** Fallos sostenidos / circuit breaker abierto. */
  | "error"
  /** Reservado en el registro, sin implementación activa. */
  | "pending";

/**
 * Deriva el estado efectivo. El ORDEN de las comprobaciones es la política:
 * primero lo que nos impide legalmente ingerir, después lo que nos impide
 * técnicamente, y solo al final se habla de verificación.
 */
export function effectiveStatus(
  spec: ConnectorSpec,
  health: ConnectorHealthState,
  options: { paused?: boolean; verifiedLive?: boolean } = {}
): ConnectorEffectiveStatus {
  if (options.paused || !spec.enabled) return "paused";
  if (spec.requiresAgreement || spec.lifecycle === "partner_required") return "partner_required";
  if (health === "disallowed") return "blocked_by_robots";
  if (health === "blocked") return "blocked_or_challenged";
  if (spec.implementation === "scaffold" || spec.lifecycle === "pending") return "pending";
  if (health === "error") return "error";
  // `verifiedLive` viene de la BASE DE DATOS (¿hay productos reales de esta
  // fuente?), no del spec: es la única prueba que no se puede declarar a mano.
  if (options.verifiedLive || spec.verification === "live") return "implemented_verified";
  return "implemented_unverified";
}

/** Etiquetas en español para el admin. */
export const EFFECTIVE_STATUS_LABEL: Record<ConnectorEffectiveStatus, string> = {
  implemented_verified: "implementado y verificado",
  implemented_unverified: "implementado sin verificar",
  partner_required: "requiere acuerdo",
  blocked_by_robots: "bloqueado por robots.txt",
  blocked_or_challenged: "bloqueado o con challenge",
  paused: "pausado",
  error: "error",
  pending: "pendiente",
};

/** Vista pública de un conector para el admin/API. */
export interface ConnectorMetadata
  extends Omit<ConnectorSpec, "productUrlPattern" | "productIdPattern"> {
  /** ¿Puede lanzar jobs de sync ahora mismo? */
  canSync: boolean;
  // --- Alias de nomenclatura -------------------------------------------
  // El contrato del admin habla de baseUrl/accessType/maturity/segment; el
  // spec usa homeUrl/access/lifecycle/segments. Se exponen los dos nombres
  // para el mismo dato en vez de duplicar el campo en el spec.
  /** Alias de `homeUrl`. */
  baseUrl: string;
  /** Alias de `access`. */
  accessType: AccessStrategy;
  /** Alias de `lifecycle`. */
  maturity: ConnectorLifecycle;
  /** Alias de `compliance`. */
  complianceMode: ComplianceMode;
  /** Primer segmento declarado (el admin agrupa por uno). */
  segment: string;
  /** Todos los patrones de URL de ficha, incluido el principal. */
  allProductUrlPatterns: string[];
  /** Nombres de las estrategias de descubrimiento, para mostrar. */
  discoveryKinds: string[];
  /** Campos con selector declarado (sin exponer los selectores en sí). */
  selectorFields: string[];
}

export function specToMetadata(spec: ConnectorSpec): ConnectorMetadata {
  const { productUrlPattern: _p, productIdPattern: _i, ...rest } = spec;
  return {
    ...rest,
    canSync: canSpecSync(spec),
    baseUrl: spec.homeUrl,
    accessType: spec.access,
    maturity: spec.lifecycle,
    complianceMode: spec.compliance,
    segment: spec.segments[0] ?? "unisex",
    allProductUrlPatterns: allProductUrlPatterns(spec),
    discoveryKinds: spec.discoveryStrategies.map((s) => s.kind),
    selectorFields: spec.selectors ? Object.keys(spec.selectors) : [],
  };
}

/** Todos los patrones de URL de ficha declarados por la fuente. */
export function allProductUrlPatterns(spec: ConnectorSpec): string[] {
  return [spec.productUrlPattern, ...spec.productUrlPatterns].filter(
    (p) => p && p !== "$^"
  );
}

/**
 * Solo sincronizan las fuentes con implementación real (bespoke/declarativa) Y
 * con todas sus credenciales presentes. Un scaffold nunca sincroniza: preferimos
 * un 422 explícito a un job que finge trabajar.
 */
export function canSpecSync(spec: ConnectorSpec): boolean {
  if (!spec.enabled) return false;
  if (spec.implementation === "scaffold") return false;
  if (spec.lifecycle === "pending" || spec.lifecycle === "partner_required") return false;
  if (spec.requiresAgreement) return false;
  return spec.requiresEnv.every((key) => Boolean(process.env[key]));
}
