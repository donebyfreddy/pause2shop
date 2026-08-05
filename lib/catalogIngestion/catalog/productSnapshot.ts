import type { CatalogProduct } from "./types";
import type { CatalogStore } from "./store";

/**
 * Instantánea en memoria del catálogo para la BÚSQUEDA.
 *
 * Por qué hace falta: `matchProducts` recorre todas las fichas, así que llamaba
 * a `store.allProducts()` una vez POR OBJETO detectado. Contra Postgres eso es
 * traerse el documento JSONB entero de cada producto —embedding CLIP de 512
 * floats incluido— por la red, en cada petición. Con ~1000 fichas y tres
 * objetos resolviéndose en paralelo (lo normal en un frame), Supabase devolvía
 * "Query read timeout" y el matching se caía justo cuando el catálogo pasó a
 * ser la fuente principal.
 *
 * El índice solo cambia cuando se ingiere o reindexa, no entre dos detecciones
 * del mismo frame, así que una instantánea compartida es correcta además de
 * barata. Se invalida explícitamente en cada escritura (`invalidateProductSnapshot`),
 * y el TTL es solo una red de seguridad para escrituras hechas por OTRO proceso
 * (un job en otra instancia serverless).
 */

const TTL_MS = Number(process.env.CATALOG_SNAPSHOT_TTL_MS) || 60_000;

type Snapshot = {
  products: CatalogProduct[];
  expiresAt: number;
};

// Compartido vía globalThis: en dev, el hot-reload recrea el módulo y sin esto
// la caché se perdería en cada recompilación.
const globalForSnapshot = globalThis as unknown as {
  __catalogSnapshot?: Snapshot | null;
  __catalogSnapshotInFlight?: Promise<CatalogProduct[]> | null;
};

/**
 * Todas las fichas activas para buscar, desde la instantánea si está fresca.
 *
 * Las peticiones concurrentes comparten la MISMA promesa en vuelo: sin eso,
 * tres objetos del mismo frame lanzarían tres consultas idénticas a la vez, que
 * es exactamente el patrón que provocaba el timeout.
 */
export async function getProductsForMatching(
  store: CatalogStore
): Promise<CatalogProduct[]> {
  const cached = globalForSnapshot.__catalogSnapshot;
  if (cached && cached.expiresAt > Date.now()) return cached.products;

  const inFlight = globalForSnapshot.__catalogSnapshotInFlight;
  if (inFlight) return inFlight;

  const promise = store
    .allProducts()
    .then((products) => {
      globalForSnapshot.__catalogSnapshot = {
        products,
        expiresAt: Date.now() + TTL_MS,
      };
      return products;
    })
    .finally(() => {
      globalForSnapshot.__catalogSnapshotInFlight = null;
    });

  globalForSnapshot.__catalogSnapshotInFlight = promise;
  return promise;
}

/**
 * Tira la instantánea. La llaman los stores al escribir, para que un producto
 * recién ingerido sea buscable de inmediato y no dentro de un TTL.
 */
export function invalidateProductSnapshot(): void {
  globalForSnapshot.__catalogSnapshot = null;
}
