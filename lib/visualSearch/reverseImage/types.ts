import type { VisualCandidate } from "../types";

/**
 * Arquitectura multi-engine de reverse image search (inspirada funcionalmente
 * en el patrón 3-en-1 de SmallSEOTools, implementada con APIs legales — ver
 * docs/SMALLSEOTOOLS-REVERSE-IMAGE-ANALYSIS.md).
 */

export type ProviderStatus =
  | "available"
  | "degraded"
  | "quota_exhausted"
  | "timeout"
  | "unauthorized"
  | "not_configured"
  | "error";

export type ProviderHealth = {
  status: ProviderStatus;
  detail?: string;
};

export type ReverseSearchMode =
  | "all"
  | "exact_matches"
  | "products"
  | "visual_matches";

export type ReverseImageSearchInput = {
  /** URL pública del crop (Google Lens no acepta base64). */
  cropUrl: string;
  /** Query guiada opcional construida con la evidencia visual. */
  query?: string;
  category?: string;
  country: string;
  language: string;
  searchMode: ReverseSearchMode;
};

export type ResponseSection =
  | "exact_matches"
  | "products"
  | "visual_matches"
  | "shopping";

export type NormalizedVisualResult = VisualCandidate & {
  /** Sección del JSON de respuesta de la que salió el resultado. */
  sourceType: ResponseSection;
  /** Alias explícito de sourceType (sección de la RESPUESTA). */
  responseSection: ResponseSection;
  /**
   * Modo de la PETICIÓN que produjo este resultado. SearchAPI puede devolver
   * una petición `products` dentro del array `visual_matches`: sin este campo
   * se perdería que es un resultado comercial de búsqueda visual de productos.
   */
  requestMode: ReverseSearchMode;
};

export interface ReverseImageProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Coste estimado por consulta en USD (para presupuesto/telemetría). */
  costPerSearchUsd(): number;
  search(input: ReverseImageSearchInput): Promise<ProviderSearchResult>;
}

export type ProviderSearchResult = {
  results: NormalizedVisualResult[];
  health: ProviderHealth;
  /** Query REALMENTE enviada al proveedor en esta llamada (null = sin query). */
  queryUsed: string | null;
};

export type ProviderCallLog = {
  provider: string;
  searchType: ReverseSearchMode;
  /** Query realmente enviada (no la deseada): null si el modo no la soporta. */
  queryUsed: string | null;
  /** Referencia corta del crop (basename hash del fichero, sin URL completa). */
  cropRef: string | null;
  durationMs: number;
  resultCount: number;
  status: ProviderStatus;
  cached: boolean;
  estimatedCostUsd: number;
};

export type OrchestratorResult = {
  candidates: NormalizedVisualResult[];
  providerUsed: string | null;
  fallbackUsed: boolean;
  cached: boolean;
  calls: ProviderCallLog[];
  /** Motivo por el que no se buscó, si aplica (presupuesto, sin proveedor…). */
  skippedReason: string | null;
};
