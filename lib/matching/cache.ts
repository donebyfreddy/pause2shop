/**
 * Caché en memoria LRU+TTL para respuestas del catálogo.
 *
 * ¿Por qué no la tabla visual_search_cache? Su payload está tipado como
 * VisualCandidate[] (candidatos de motores externos) y las respuestas del
 * catálogo tienen otra forma (CatalogSearchResponse). Mezclarlas rompería el
 * tipado y contaminaría las keys existentes; el catálogo además es un
 * servicio LOCAL barato, así que una caché por proceso con TTL corto
 * (CATALOG_CACHE_TTL_SECONDS) es suficiente y cero-riesgo.
 */

type Entry<T> = { value: T; expiresAt: number };

export class TtlLruCache<T> {
  private readonly map = new Map<string, Entry<T>>();

  constructor(private readonly maxEntries = 200) {}

  get(key: string, now = Date.now()): T | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.map.delete(key);
      return null;
    }
    // Refresco LRU: re-insertar mueve la key al final (la más reciente).
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds: number, now = Date.now()): void {
    if (ttlSeconds <= 0) return;
    if (this.map.has(key)) this.map.delete(key);
    // Evicción LRU: la primera key del Map es la menos usada recientemente.
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
  }

  get size(): number {
    return this.map.size;
  }
}

// Compartida entre recargas en caliente de Next dev (mismo patrón que
// lib/visualSearch/cache.ts con __visualSearchCache).
const globalForCache = globalThis as unknown as {
  __catalogMatchCache?: TtlLruCache<unknown>;
};

export function getCatalogMatchCache<T>(): TtlLruCache<T> {
  if (!globalForCache.__catalogMatchCache) {
    globalForCache.__catalogMatchCache = new TtlLruCache<unknown>(200);
  }
  return globalForCache.__catalogMatchCache as TtlLruCache<T>;
}
