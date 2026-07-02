import { isDatabaseConfigured, query } from "@/lib/db/pool";
import type { VisualCandidate } from "./types";

/**
 * Caché de resultados de búsqueda visual/shopping.
 *  - Con DATABASE_URL → tabla visual_search_cache (persistente, compartida).
 *  - Sin DB → Map en memoria (por instancia, mejor que nada en dev).
 *
 * Claves:
 *  - Lens:     lens:v1:<sha256 del frame>
 *  - Shopping: shop:v1:<provider>:<query normalizada>
 * Un frame repetido (mismo hash) o una query repetida no vuelve a pagar API.
 */

type MemEntry = { payload: VisualCandidate[]; expiresAt: number };
const globalMem = globalThis as unknown as {
  __visualSearchCache?: Map<string, MemEntry>;
  __visualSearchDbHealthy?: boolean;
};

function mem(): Map<string, MemEntry> {
  if (!globalMem.__visualSearchCache) globalMem.__visualSearchCache = new Map();
  return globalMem.__visualSearchCache;
}

// Respaldo del connectionTimeoutMillis del pool (ver lib/db/pool.ts): si por
// lo que sea la conexión no falla a tiempo, no dejamos que un lookup de
// caché cuelgue el análisis. Tras el primer fallo, la caché queda en modo
// memoria para el resto de la vida del proceso.
const DB_CACHE_TIMEOUT_MS = 4_000;

function dbCacheUsable(): boolean {
  return isDatabaseConfigured() && globalMem.__visualSearchDbHealthy !== false;
}

function markDbCacheBroken(err: unknown): void {
  if (globalMem.__visualSearchDbHealthy !== false) {
    globalMem.__visualSearchDbHealthy = false;
    console.warn(
      "[visualSearch] Caché en DB no disponible; usando memoria:",
      err instanceof Error ? err.message : err
    );
  }
}

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout de ${DB_CACHE_TIMEOUT_MS}ms`)),
      DB_CACHE_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function lensCacheKey(imageHash: string): string {
  return `lens:v1:${imageHash}`;
}

export function shoppingCacheKey(provider: string, q: string): string {
  return `shop:v1:${provider}:${q.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export async function cacheGet(key: string): Promise<VisualCandidate[] | null> {
  if (dbCacheUsable()) {
    try {
      const res = await withTimeout(
        query<{ payload: VisualCandidate[] }>(
          `select payload from visual_search_cache
            where cache_key = $1 and expires_at > now()`,
          [key]
        )
      );
      return res.rows[0]?.payload ?? null;
    } catch (err) {
      markDbCacheBroken(err);
      // cae a memoria
    }
  }
  const entry = mem().get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    mem().delete(key);
    return null;
  }
  return entry.payload;
}

export async function cacheSet(
  key: string,
  provider: string,
  payload: VisualCandidate[],
  ttlDays: number
): Promise<void> {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  if (dbCacheUsable()) {
    try {
      await withTimeout(
        query(
          `insert into visual_search_cache (cache_key, provider, payload, expires_at)
           values ($1, $2, $3::jsonb, now() + ($4 || ' days')::interval)
           on conflict (cache_key)
             do update set payload = excluded.payload,
                           provider = excluded.provider,
                           expires_at = excluded.expires_at`,
          [key, provider, JSON.stringify(payload), String(ttlDays)]
        )
      );
      return;
    } catch (err) {
      markDbCacheBroken(err);
    }
  }
  mem().set(key, { payload, expiresAt: Date.now() + ttlMs });
}
