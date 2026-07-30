import { createHash } from "node:crypto";
import { SCHEMA_VERSION, type AiExtraction } from "./schema";

/**
 * Caché de extracciones por IA.
 *
 * Clave: dominio + URL + hash del DOM condensado + versión del schema + modelo.
 * Cualquier cambio en cualquiera de los cinco invalida la entrada, que es
 * exactamente lo que se quiere: reprocesar cuando la ficha cambia, cuando
 * cambiamos el contrato o cuando cambiamos de modelo — y NUNCA pagar dos veces
 * por la misma extracción.
 */

export interface AiCacheKeyParts {
  url: string;
  domHash: string;
  model: string;
}

export interface AiCacheEntry {
  extraction: AiExtraction;
  model: string;
  schemaVersion: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  createdAt: string;
}

export function aiCacheKey({ url, domHash, model }: AiCacheKeyParts): string {
  let domain = "";
  try {
    domain = new URL(url).host;
  } catch {
    domain = "unknown";
  }
  const canonical = `${domain}|${url}|${domHash}|${SCHEMA_VERSION}|${model}`;
  return createHash("sha256").update(canonical).digest("hex");
}

export interface AiExtractionCache {
  get(key: string): Promise<AiCacheEntry | null>;
  set(key: string, entry: AiCacheEntry, meta?: { url: string; domHash: string }): Promise<void>;
}

/**
 * Caché en memoria acotada. Suficiente dentro de un job (la misma ficha puede
 * aparecer por varios sitemaps) y es el fallback cuando no hay base de datos.
 */
export class MemoryAiCache implements AiExtractionCache {
  private entries = new Map<string, AiCacheEntry>();

  constructor(private capacity = 500) {}

  async get(key: string): Promise<AiCacheEntry | null> {
    const hit = this.entries.get(key);
    if (!hit) return null;
    // LRU simple: releer marca como reciente.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  async set(
    key: string,
    entry: AiCacheEntry,
    _meta?: { url: string; domHash: string }
  ): Promise<void> {
    this.entries.set(key, entry);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Caché de dos niveles: memoria delante de un backend persistente. La memoria
 * absorbe los aciertos del propio job; el backend sobrevive al reinicio (y en
 * serverless, entre invocaciones), que es donde está el ahorro real.
 */
export class LayeredAiCache implements AiExtractionCache {
  private memory = new MemoryAiCache();

  constructor(private persistent: AiExtractionCache) {}

  async get(key: string): Promise<AiCacheEntry | null> {
    const local = await this.memory.get(key);
    if (local) return local;
    const remote = await this.persistent.get(key).catch(() => null);
    if (remote) await this.memory.set(key, remote);
    return remote;
  }

  async set(key: string, entry: AiCacheEntry, meta?: { url: string; domHash: string }): Promise<void> {
    await this.memory.set(key, entry, meta);
    await this.persistent.set(key, entry, meta).catch(() => {
      /* la caché es un optimización: si el backend falla, seguimos */
    });
  }
}
