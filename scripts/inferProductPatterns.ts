/**
 * Infiere `productUrlPattern` desde los sitemaps REALES de cada tienda.
 *
 *   npm run scraper:infer                # todas las fuentes no-scaffold
 *   npm run scraper:infer -- camper tous # solo esas
 *   npm run scraper:infer -- --json      # salida para pegar en los specs
 *
 * Por qué existe: escribir a mano el regex de la ficha de 60 tiendas es
 * adivinar, y adivinar produce un registro que dice "implementado" y descubre
 * cero productos. Esta herramienta mira lo que la tienda publica de verdad,
 * agrupa las URLs por FORMA y propone el patrón de la forma dominante.
 *
 * No escribe nada: imprime la propuesta para revisarla antes de tocar el spec.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
loadEnv();

import { SOURCE_SPECS } from "../lib/catalogIngestion/connectors/sources/index";
import {
  discoverSitemapsFromRobots,
  politeFetch,
  RobotsDisallowedError,
} from "../lib/catalogIngestion/connectors/base/httpClient";
import { extractSitemapLocs } from "../lib/catalogIngestion/discovery/index";

/** Cuántos sitemaps se visitan por tienda como máximo. */
const MAX_SITEMAPS = 8;
/** URLs que se muestrean por tienda. */
const MAX_SAMPLE = 4000;

interface Inference {
  id: string;
  homeUrl: string;
  reachable: boolean;
  note: string;
  sampled: number;
  currentPattern: string;
  currentMatches: number;
  /** Formas de URL encontradas, de más frecuente a menos. */
  shapes: Array<{ pattern: string; count: number; example: string }>;
  suggestedPattern: string | null;
  suggestedIdPattern: string | null;
  suggestedMatches: number;
}

type TokenType = "digits" | "letters" | "sep" | "slug";

interface Token {
  type: TokenType;
  value: string;
}

/**
 * Tokeniza la hoja del path en tramos de dígitos, letras y separadores.
 *
 * La clave del método: se agrupa por la SECUENCIA DE TIPOS (que es estable
 * entre fichas de la misma tienda) y las longitudes concretas se resuelven
 * después, mirando todo el grupo. Así `244537NC.html` y `100200AB.html` caen
 * en el mismo grupo y producen `\d{6}[A-Za-z]{2}\.html`, en vez de fragmentarse
 * en un grupo por longitud.
 */
function tokenize(segment: string): Token[] {
  const raw = segment.match(/\d+|[A-Za-z]+|[^A-Za-z\d]+/g) ?? [];
  const tokens: Token[] = raw.map((value) => ({
    type: /^\d+$/.test(value) ? "digits" : /^[A-Za-z]+$/.test(value) ? "letters" : "sep",
    value,
  }));

  // Fusión de slug: `side-tie-bikini-skirt` son CUATRO palabras en esta ficha y
  // dos en la siguiente. Tratarlas por separado fragmenta el grupo y produce un
  // patrón que solo vale para los títulos de esa longitud exacta, así que se
  // colapsan en un único token de slug.
  const merged: Token[] = [];
  for (const token of tokens) {
    const prev = merged[merged.length - 1];
    const prevPrev = merged[merged.length - 2];
    const joinable =
      token.type === "letters" &&
      prev?.type === "sep" &&
      /^[-_]$/.test(prev.value) &&
      (prevPrev?.type === "letters" || prevPrev?.type === "slug");
    if (joinable) {
      merged.splice(merged.length - 2, 2, {
        type: "slug",
        value: `${prevPrev.value}${prev.value}${token.value}`,
      });
      continue;
    }
    merged.push({ ...token });
  }
  return merged;
}

/** Extensión de fichero de la hoja, si la hay (`.html`, `.aspx`…). */
function extensionOf(segment: string): string | null {
  const m = /\.([a-z]{2,5})$/i.exec(segment);
  return m ? m[0].toLowerCase() : null;
}

interface ShapeGroup {
  count: number;
  example: string;
  depth: number;
  host: string;
  extension: string | null;
  /** Secuencia de tipos, sin longitudes. */
  types: TokenType[];
  /** Longitudes vistas por posición, para derivar `\d{min,max}`. */
  lengths: Array<{ min: number; max: number }>;
  /** Separadores literales por posición (son estables). */
  seps: Array<string | null>;
}

function shapeKey(url: string): { key: string; group: Omit<ShapeGroup, "count"> } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const leaf = segments[segments.length - 1];
  const extension = extensionOf(leaf);
  // La extensión se trata aparte: dentro del tokenizado ensuciaría el tipo.
  const body = extension ? leaf.slice(0, -extension.length) : leaf;
  const tokens = tokenize(body);
  if (tokens.length === 0) return null;

  const host = parsed.host.replace(/^www\./, "");
  const types = tokens.map((t) => t.type);
  return {
    key: `${host}|${segments.length}|${types.join(",")}|${extension ?? ""}|${tokens
      .map((t) => (t.type === "sep" ? t.value : ""))
      .join("")}`,
    group: {
      example: url,
      depth: segments.length,
      host,
      extension,
      types,
      lengths: tokens.map((t) => ({ min: t.value.length, max: t.value.length })),
      seps: tokens.map((t) => (t.type === "sep" ? t.value : null)),
    },
  };
}

/** Construye el regex de un grupo, con rangos de longitud reales. */
function groupPattern(group: ShapeGroup): string {
  const escapedHost = group.host.replace(/\./g, "\\.");
  const leaf = group.types
    .map((type, i) => {
      const { min, max } = group.lengths[i];
      if (type === "sep") {
        return (group.seps[i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
      // El slug es variable por naturaleza (el título del producto): siempre
      // cuantificador abierto, nunca longitud fija.
      if (type === "slug") return "[A-Za-z][A-Za-z_-]*";
      const cls = type === "digits" ? "\\d" : "[A-Za-z]";
      // Rango amplio → cuantificador abierto: fijar longitudes que varían mucho
      // haría el patrón frágil ante una referencia nueva.
      if (max - min > 3) return `${cls}+`;
      return min === max ? `${cls}{${min}}` : `${cls}{${min},${max}}`;
    })
    .join("");
  const ext = group.extension ? group.extension.replace(/\./g, "\\.") : "";
  const prefix = group.depth > 1 ? String.raw`${escapedHost}\/.+\/` : String.raw`${escapedHost}\/`;
  return `${prefix}${leaf}${ext}([?#]|$)`;
}

/** Segmentos de path que delatan que NO es una ficha de producto. */
const NON_PRODUCT_PATH =
  /\/(pages?|blogs?|blog|noticias|news|help|ayuda|about|legal|terms|privacy|store-?locator|tiendas|collections?|categor|c\/|lookbook|shopthelook|landing|gift-?card|search|buscar)\//i;

/** ¿La forma parece una FICHA y no una categoría o una landing? */
function looksLikeProductShape(
  shape: { pattern: string; count: number; example: string },
  totalSampled: number
): boolean {
  // Una ficha es ABUNDANTE: en un sitemap de catálogo las fichas dominan.
  if (shape.count < 5) return false;
  if (shape.count / totalSampled < 0.02) return false;
  if (NON_PRODUCT_PATH.test(shape.example)) return false;
  const hasNumericId = /\\d[{+]/.test(shape.pattern);
  const leaf = shape.example.split("/").filter(Boolean).pop() ?? "";
  // Con id numérico basta; si no, exigimos un slug largo (las categorías son
  // palabras cortas tipo "mujer" o "abrigos").
  return hasNumericId || leaf.length >= 14;
}

/** Grupo de captura del id: el primer bloque numérico largo de la hoja. */
function idPatternFor(pattern: string): string | null {
  const m = /\\d\{(\d+)\}/.exec(pattern);
  if (!m || Number(m[1]) < 4) return null;
  // Se convierte el PRIMER \d{n} de 4+ dígitos en grupo de captura.
  return pattern.replace(/\\d\{(\d+)\}/, (full, n) =>
    Number(n) >= 4 ? `(\\d{${n}})` : full
  );
}

async function infer(spec: (typeof SOURCE_SPECS)[number]): Promise<Inference> {
  const result: Inference = {
    id: spec.id,
    homeUrl: spec.homeUrl,
    reachable: false,
    note: "",
    sampled: 0,
    currentPattern: spec.productUrlPattern,
    currentMatches: 0,
    shapes: [],
    suggestedPattern: null,
    suggestedIdPattern: null,
    suggestedMatches: 0,
  };

  let sitemaps: string[];
  try {
    sitemaps = [...new Set([...spec.sitemapUrls, ...(await discoverSitemapsFromRobots(spec.homeUrl))])];
  } catch (err) {
    result.note = err instanceof RobotsDisallowedError ? "robots.txt no lo permite" : String(err);
    return result;
  }
  if (sitemaps.length === 0) {
    result.note = "la tienda no declara sitemaps (ni en el spec ni en robots.txt)";
    return result;
  }

  // Se prioriza lo que suena a producto y al mercado del spec, igual que hace
  // el descubrimiento real.
  const marketHints = spec.markets.map((m) => m.toLowerCase());
  const score = (url: string): number => {
    let s = 0;
    // "sitemap" contiene "item": se quita antes de buscar, o toda URL de
    // sitemap parecería de producto (el mismo fallo que en discovery/).
    const cleaned = url.replace(/sitemaps?|site_?maps?/gi, "");
    if (/(^|[^a-z])(products?|productos?|artikel|articles?|items?|catalog|pdp)([^a-z]|$)/i.test(cleaned)) s += 100;
    if (marketHints.some((h) => url.toLowerCase().includes(h))) s += 40;
    if (/image|video|landing|blog|store|shopthelook|category/i.test(url)) s -= 60;
    return s;
  };

  const queue = [...sitemaps];
  const visited = new Set<string>();
  const urls: string[] = [];

  while (queue.length > 0 && visited.size < MAX_SITEMAPS && urls.length < MAX_SAMPLE) {
    queue.sort((a, b) => score(b) - score(a));
    const next = queue.shift();
    if (!next || visited.has(next)) continue;
    visited.add(next);

    let xml: string;
    try {
      const res = await politeFetch(next, "application/xml,text/xml");
      if (res.status < 200 || res.status >= 300) continue;
      xml = res.body;
      result.reachable = true;
    } catch (err) {
      if (err instanceof RobotsDisallowedError) {
        result.note = "robots.txt no permite los sitemaps";
        return result;
      }
      continue;
    }

    for (const loc of extractSitemapLocs(xml)) {
      if (/\.xml(\.gz)?([?#]|$)/i.test(loc) || /sitemap/i.test(loc)) {
        if (!visited.has(loc)) queue.push(loc);
      } else if (urls.length < MAX_SAMPLE) {
        urls.push(loc);
      }
    }
  }

  result.sampled = urls.length;
  if (urls.length === 0) {
    result.note = result.reachable
      ? "sitemaps accesibles pero sin URLs de página (solo índices/imágenes)"
      : "ningún sitemap accesible";
    return result;
  }

  const currentRe = spec.productUrlPattern === "$^" ? null : new RegExp(spec.productUrlPattern, "i");
  result.currentMatches = currentRe ? urls.filter((u) => currentRe.test(u)).length : 0;

  // Agrupación en dos pasos: primero por secuencia de tipos, y dentro del grupo
  // se acumulan las longitudes reales para derivar los cuantificadores.
  const groups = new Map<string, ShapeGroup>();
  for (const url of urls) {
    const shape = shapeKey(url);
    if (!shape) continue;
    const existing = groups.get(shape.key);
    if (!existing) {
      groups.set(shape.key, { ...shape.group, count: 1 });
      continue;
    }
    existing.count++;
    shape.group.lengths.forEach((len, i) => {
      const target = existing.lengths[i];
      if (!target) return;
      target.min = Math.min(target.min, len.min);
      target.max = Math.max(target.max, len.max);
    });
  }

  result.shapes = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((g) => ({ pattern: groupPattern(g), count: g.count, example: g.example }));

  const best = result.shapes.find((s) => looksLikeProductShape(s, urls.length));
  if (best) {
    result.suggestedPattern = best.pattern;
    result.suggestedIdPattern = idPatternFor(best.pattern);
    const re = new RegExp(best.pattern, "i");
    result.suggestedMatches = urls.filter((u) => re.test(u)).length;
  } else {
    result.note = "ninguna forma de URL parece una ficha de producto";
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const ids = args.filter((a) => !a.startsWith("--"));
  const targets = SOURCE_SPECS.filter(
    (s) => (ids.length > 0 ? ids.includes(s.id) : s.implementation !== "scaffold")
  );

  const results: Inference[] = [];
  for (const spec of targets) {
    if (!asJson) process.stdout.write(`▸ ${spec.id} … `);
    const inference = await infer(spec);
    results.push(inference);
    if (!asJson) {
      if (inference.suggestedPattern) {
        const improved = inference.suggestedMatches > inference.currentMatches;
        console.log(
          `${inference.sampled} URLs · patrón actual acierta ${inference.currentMatches}` +
            ` · propuesto acierta ${inference.suggestedMatches}${improved ? "  ⇦ MEJORA" : ""}`
        );
        console.log(`    propuesto: ${inference.suggestedPattern}`);
        if (inference.suggestedIdPattern) {
          console.log(`    id:        ${inference.suggestedIdPattern}`);
        }
        console.log(`    ejemplo:   ${inference.shapes[0]?.example ?? "—"}`);
      } else {
        console.log(`sin propuesta — ${inference.note}`);
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const improved = results.filter(
      (r) => r.suggestedPattern && r.suggestedMatches > r.currentMatches
    );
    console.log(`\n${improved.length} de ${results.length} fuentes mejorarían su patrón.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\n✖ la inferencia falló:", err);
  process.exit(1);
});
