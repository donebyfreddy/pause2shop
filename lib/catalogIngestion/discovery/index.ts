import { loadHtml } from "../extraction/structured";
import { extractNextPage, extractProductLinks, type ConnectorSelectors } from "../extraction/dom";
import type { DiscoveryStrategy } from "../connectors/base/types";
import { RobotsDisallowedError } from "../connectors/base/httpClient";
import type { StageReporter } from "../extraction/pipeline";

/**
 * Descubrimiento de URLs de ficha.
 *
 * Tres vías, en orden de preferencia y coste:
 *
 *  1. **Sitemap** — la tienda nos dice dónde está su catálogo. Es la vía
 *     educada y la más completa; se recorre el índice y sus hijos.
 *  2. **Crawl de categorías** — para tiendas sin sitemap útil: se recorren las
 *     páginas de listado siguiendo la paginación.
 *  3. **Patrones de URL** — filtrado de URLs ya conocidas.
 *
 * Todo el proceso es REANUDABLE: el estado (cola de sitemaps/categorías,
 * páginas visitadas, URLs encontradas) se serializa en un checkpoint, de modo
 * que un job cortado a mitad no vuelve a descubrir desde cero.
 */

export interface DiscoveryQueueItem {
  url: string;
  depth: number;
  kind: "sitemap" | "category";
}

/** Estado serializable del descubrimiento. Va tal cual al checkpoint del job. */
export interface DiscoveryCheckpoint {
  /** Sitemaps/categorías pendientes de visitar, con su profundidad. */
  queue: DiscoveryQueueItem[];
  /** URLs de sitemap/listado ya visitadas (para no dar vueltas). */
  visited: string[];
  /** URLs de ficha encontradas, deduplicadas y en orden de hallazgo. */
  found: string[];
  /** Índice de la estrategia en curso. */
  strategyIndex: number;
  /** ¿Terminó el descubrimiento (cola vacía o límite alcanzado)? */
  done: boolean;
}

export interface DiscoveryInput {
  strategies: DiscoveryStrategy[];
  /** Sitemaps que la tienda declara en su robots.txt. */
  robotsSitemaps: string[];
  /** ¿Es esta URL una ficha de producto? */
  isProductUrl: (url: string) => boolean;
  /** Canonicaliza una URL de ficha (quita query/tracking). */
  canonicalize: (url: string) => string;
  limit: number;
  /** Descarga un documento (XML o HTML). Devuelve null si no es accesible. */
  fetchDocument: (url: string, accept?: string) => Promise<string | null>;
  selectors?: ConnectorSelectors | null;
  checkpoint?: DiscoveryCheckpoint | null;
  /** Techo de peticiones de descubrimiento por invocación (cortesía + tiempo). */
  maxRequests?: number;
  /**
   * Mercados/locales que interesan (p. ej. `["ES", "es_ES", "es-es"]`). Muchas
   * tiendas publican un sitemap por locale: sin esta pista el descubrimiento
   * gasta su presupuesto recorriendo Andorra o Serbia antes de llegar a España.
   */
  localeHints?: string[];
  report?: StageReporter;
}

export interface DiscoveryResult {
  urls: string[];
  checkpoint: DiscoveryCheckpoint;
  /** Peticiones consumidas en esta invocación. */
  requests: number;
  /** Estrategias que aportaron al menos una URL. */
  strategiesUsed: string[];
}

/** Niveles de sitemapindex que recorremos como máximo. */
const MAX_SITEMAP_DEPTH = 3;
/** Páginas de un listado paginado que seguimos como máximo. */
const DEFAULT_MAX_CATEGORY_PAGES = 5;
/** Peticiones de descubrimiento por invocación si no se especifica otra cosa. */
const DEFAULT_MAX_REQUESTS = 40;

/** <loc> de un sitemap (urlset o sitemapindex), con entidades decodificadas. */
export function extractSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((m) =>
    m[1]
      .trim()
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
  );
}

/** ¿Esta <loc> apunta a otro sitemap en lugar de a una ficha? */
function looksLikeSitemap(url: string): boolean {
  if (/\.xml(\.gz)?([?#]|$)/i.test(url)) return true;
  try {
    return /sitemap/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * ¿El nombre del sitemap sugiere que contiene fichas de producto?
 *
 * Cuidado con lo obvio: la palabra "sitemap" CONTIENE "item", así que buscar
 * "item" a pelo daba positivo en toda URL de sitemap y anulaba la priorización
 * entera. Se elimina el literal "sitemap" antes de mirar, y los tokens se
 * exigen delimitados.
 */
function isProductish(url: string): boolean {
  const cleaned = url.replace(/sitemaps?|site_?maps?/gi, "");
  return /(^|[^a-z])(products?|productos?|artikel|articles?|items?|catalog|pdp)([^a-z]|$)/i.test(
    cleaned
  );
}

/** Sitemaps de un idioma/mercado que NO nos interesa (ruido de locales). */
function matchesLocale(url: string, hints: string[]): boolean {
  if (hints.length === 0) return true;
  const lower = url.toLowerCase();
  return hints.some((h) => lower.includes(h.toLowerCase()));
}

/**
 * Prioridad de un elemento de la cola. Es la pieza que decide si el
 * descubrimiento encuentra productos o se pierde: con una cola FIFO plana, un
 * índice que declara 26 sitemaps (uno por mercado) consume todo el presupuesto
 * recorriendo hermanos en vez de DESCENDER al que dice "Products".
 *
 * Por eso se prefiere, en orden: parecer de producto → ser del mercado que
 * interesa → estar más profundo (descenso en profundidad).
 */
function itemPriority(item: DiscoveryQueueItem, localeHints: string[]): number {
  let score = 0;
  if (isProductish(item.url)) score += 100;
  if (matchesLocale(item.url, localeHints)) score += 40;
  // Las páginas de categoría ya están en el nivel del producto: van antes que
  // un índice de sitemaps sin explorar.
  if (item.kind === "category") score += 10;
  score += item.depth * 5;
  return score;
}

function emptyCheckpoint(): DiscoveryCheckpoint {
  return { queue: [], visited: [], found: [], strategyIndex: 0, done: false };
}

/**
 * Ejecuta (o reanuda) el descubrimiento. Se detiene al llenar `limit`, al
 * agotar las estrategias o al consumir `maxRequests` — en ese último caso
 * `checkpoint.done` queda en false y la siguiente invocación continúa.
 */
export async function discoverProductUrls(input: DiscoveryInput): Promise<DiscoveryResult> {
  const report = input.report ?? (() => undefined);
  const maxRequests = input.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const checkpoint: DiscoveryCheckpoint = input.checkpoint
    ? {
        ...emptyCheckpoint(),
        ...input.checkpoint,
        queue: [...(input.checkpoint.queue ?? [])],
        visited: [...(input.checkpoint.visited ?? [])],
        found: [...(input.checkpoint.found ?? [])],
      }
    : emptyCheckpoint();

  const visited = new Set(checkpoint.visited);
  const found = new Set(checkpoint.found);
  const strategiesUsed = new Set<string>();
  let requests = 0;

  const addFound = (url: string): boolean => {
    const canonical = input.canonicalize(url);
    if (found.has(canonical)) return false;
    found.add(canonical);
    return true;
  };

  const enqueue = (url: string, depth: number, kind: "sitemap" | "category"): void => {
    if (visited.has(url)) return;
    if (checkpoint.queue.some((q) => q.url === url)) return;
    checkpoint.queue.push({ url, depth, kind });
  };

  // Siembra la cola con la estrategia en curso (y las siguientes) si está vacía.
  while (
    checkpoint.queue.length === 0 &&
    checkpoint.strategyIndex < input.strategies.length &&
    found.size < input.limit
  ) {
    const strategy = input.strategies[checkpoint.strategyIndex];
    if (strategy.kind === "sitemap") {
      const urls = [...(strategy.urls ?? []), ...input.robotsSitemaps];
      for (const url of [...new Set(urls)]) enqueue(url, 0, "sitemap");
      if (urls.length === 0) {
        report({
          stage: "discover",
          level: "warn",
          message: "la fuente no declara sitemaps y su robots.txt no publica ninguno",
        });
      }
    } else if (strategy.kind === "category_crawl") {
      for (const url of strategy.urls) enqueue(url, 0, "category");
    } else if (strategy.kind === "feed") {
      // El feed lo consume el conector (es la vía 1 del pipeline, no un crawl).
      report({
        stage: "discover",
        level: "debug",
        message: `estrategia feed declarada (${strategy.url}): la resuelve el conector`,
      });
    }
    if (checkpoint.queue.length === 0) checkpoint.strategyIndex++;
  }

  const localeHints = input.localeHints ?? [];

  /** Saca el elemento más prometedor de la cola (no el primero que llegó). */
  const dequeue = (): DiscoveryQueueItem | null => {
    if (checkpoint.queue.length === 0) return null;
    let bestIndex = 0;
    let bestScore = itemPriority(checkpoint.queue[0], localeHints);
    for (let i = 1; i < checkpoint.queue.length; i++) {
      const score = itemPriority(checkpoint.queue[i], localeHints);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return checkpoint.queue.splice(bestIndex, 1)[0];
  };

  while (checkpoint.queue.length > 0 && found.size < input.limit && requests < maxRequests) {
    const item = dequeue();
    if (!item) break;
    if (visited.has(item.url)) continue;
    visited.add(item.url);

    let body: string | null = null;
    requests++;
    try {
      body = await input.fetchDocument(
        item.url,
        item.kind === "sitemap" ? "application/xml,text/xml" : undefined
      );
    } catch (err) {
      if (err instanceof RobotsDisallowedError) throw err;
      report({
        stage: "discover",
        level: "warn",
        message: `no accesible: ${err instanceof Error ? err.message : String(err)}`,
        url: item.url,
      });
      continue;
    }
    if (!body) {
      // Un documento vacío o inaccesible se REPORTA: si no, un descubrimiento
      // que gasta 40 peticiones en 404s parece "sin resultados" sin más.
      report({
        stage: "discover",
        level: "debug",
        message: "documento vacío o no accesible; se descarta",
        url: item.url,
      });
      continue;
    }

    if (item.kind === "sitemap") {
      strategiesUsed.add("sitemap");
      const locs = extractSitemapLocs(body);
      let added = 0;
      for (const loc of locs) {
        if (found.size >= input.limit) break;
        if (input.isProductUrl(loc) && addFound(loc)) added++;
      }
      if (item.depth < MAX_SITEMAP_DEPTH && found.size < input.limit) {
        const children = locs.filter((l) => l !== item.url && looksLikeSitemap(l));
        // Se encolan TODOS y ya decide `dequeue()` por prioridad: filtrar aquí
        // arriesgaría descartar el único hijo que sí tiene productos.
        for (const child of children) enqueue(child, item.depth + 1, "sitemap");
      }
      report({
        stage: "discover",
        level: added > 0 ? "info" : "debug",
        message: `sitemap con ${locs.length} <loc>: ${added} fichas nuevas (total ${found.size})`,
        url: item.url,
      });
    } else {
      strategiesUsed.add("category_crawl");
      const $ = loadHtml(body);
      const links = extractProductLinks($, item.url, input.selectors ?? undefined, input.isProductUrl);
      let added = 0;
      for (const link of links) {
        if (found.size >= input.limit) break;
        if (addFound(link)) added++;
      }
      const strategy = input.strategies[checkpoint.strategyIndex];
      const maxPages =
        strategy?.kind === "category_crawl"
          ? (strategy.maxPages ?? DEFAULT_MAX_CATEGORY_PAGES)
          : DEFAULT_MAX_CATEGORY_PAGES;
      if (item.depth + 1 < maxPages && found.size < input.limit) {
        const next = extractNextPage($, item.url, input.selectors ?? undefined);
        if (next && !visited.has(next)) enqueue(next, item.depth + 1, "category");
      }
      report({
        stage: "discover",
        level: added > 0 ? "info" : "debug",
        message: `listado con ${links.length} enlaces de ficha: ${added} nuevas (página ${item.depth + 1}, total ${found.size})`,
        url: item.url,
      });
    }

    // Estrategia agotada: pasa a la siguiente y siémbrala.
    if (checkpoint.queue.length === 0 && found.size < input.limit) {
      checkpoint.strategyIndex++;
      const next = input.strategies[checkpoint.strategyIndex];
      if (next?.kind === "sitemap") {
        for (const url of [...(next.urls ?? []), ...input.robotsSitemaps]) {
          enqueue(url, 0, "sitemap");
        }
      } else if (next?.kind === "category_crawl") {
        for (const url of next.urls) enqueue(url, 0, "category");
      }
    }
  }

  checkpoint.visited = [...visited].slice(-500);
  checkpoint.found = [...found];
  checkpoint.done =
    checkpoint.queue.length === 0 || found.size >= input.limit;

  return {
    urls: [...found].slice(0, input.limit),
    checkpoint,
    requests,
    strategiesUsed: [...strategiesUsed],
  };
}
