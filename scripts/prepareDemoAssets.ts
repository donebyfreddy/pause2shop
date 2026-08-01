/**
 * Prepara los assets de la demo del hero.
 *
 *   npm run demo:assets
 *
 * Qué hace y por qué está en un script y no "a mano":
 *
 *  1. Descarga cada imagen de su URL de ORIGEN documentada.
 *  2. Valida MIME real (no la extensión), tamaño y resolución mínima.
 *  3. Recorta el fondo cuando la imagen no viene con transparencia, mediante
 *     relleno por difusión desde los bordes — no por umbral global, que
 *     agujerearía las zonas claras del interior del producto (una etiqueta
 *     blanca sobre una prenda negra, por ejemplo).
 *  4. Escribe WebP optimizado en `public/demo/products/`.
 *  5. Guarda la procedencia y el sha256 en `public/demo/products/metadata.json`.
 *
 * El hero NO usa estas URLs en tiempo de ejecución: sirve los WebP locales. La
 * descarga es un paso de desarrollo, y por eso el script es idempotente y se
 * puede volver a lanzar cuando haya que sustituir un asset.
 *
 * LICENCIAS: ver `docs/DEMO_ASSETS.md`. Hay assets marcados como pendientes de
 * sustituir antes de un uso comercial.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { PROJECT_ROOT, loadEnv } from "./loadEnv";

// Sin esto, `process.env` no tiene lo de `.env`: el script solo importaba
// PROJECT_ROOT y nunca cargaba el entorno, así que UNSPLASH_ACCESS_KEY llegaba
// vacía aunque estuviera configurada.
loadEnv();

type AssetSpec = {
  id: "coat" | "bag" | "shoes";
  /**
   * De dónde sale el original. Tres formas, por orden de prioridad:
   *
   *  1. `DEMO_ASSET_<ID>` en el entorno — ruta local o URL. Es la vía rápida
   *     para sustituir un asset sin tocar código: deja el fichero y lanza el
   *     script.
   *  2. `assets/demo/<id>.*` en el repo, si existe.
   *  3. `sourceUrl`, la URL documentada de abajo.
   */
  sourceUrl: string;
  /** Quién publica el original y bajo qué condiciones. */
  sourceName: string;
  license: string;
  /** El original trae fondo opaco y hay que recortarlo. */
  removeBackground: boolean;
  /**
   * Cómo se recorta.
   *
   *  - `border`: solo lo conectado al borde. Protege las zonas claras del
   *    INTERIOR del producto (una etiqueta blanca sobre una prenda negra), a
   *    costa de dejar el fondo que quede encerrado.
   *  - `white`: todo lo casi blanco, esté donde esté. Es lo correcto para una
   *    foto de estudio sobre blanco puro, donde el hueco entre las asas de un
   *    bolso también es fondo — con `border` se quedaba como una mancha blanca.
   */
  backgroundMode?: "border" | "white";
  /** Tolerancia del recorte, 0-255. Más alta se come sombras suaves. */
  backgroundTolerance?: number;
  /** Lado mayor del WebP de salida. */
  targetSize: number;
  /**
   * Consulta de Unsplash con la que buscar un sustituto.
   *
   * Solo se usa con `--unsplash`, nunca en una ejecución normal: una búsqueda
   * devuelve fotos distintas cada semana y los assets del hero no pueden
   * cambiar solos. El flujo es elegir una vez, fijar su URL y volver a lo
   * determinista.
   */
  unsplashQuery?: string;
  /** Orientación que encaja con el hueco del producto en la escena. */
  unsplashOrientation?: "portrait" | "landscape" | "squarish";
  /**
   * Realce de luminosidad (1 = sin cambio).
   *
   * Hace falta para prendas negras: fotografiadas sobre blanco llegan con los
   * negros aplastados, y sobre el fondo casi negro del hero se quedaban en una
   * silueta plana sin costuras ni cremallera. Levantar el punto negro devuelve
   * el volumen sin desteñir el color.
   */
  brightness?: number;
};

const ASSETS: AssetSpec[] = [
  {
    id: "coat",
    sourceUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT8vRLD5OpIP2dxUeXP55KdeNaeC5gTQG4FAnNRE6WhQw&s=10",
    sourceName: "Miniatura de Google Images (titular original desconocido)",
    license: "SIN LICENCIA VERIFICADA — sustituir antes de uso comercial",
    removeBackground: true,
    backgroundMode: "border",
    targetSize: 900,
    brightness: 1.45,
    // Consulta CORTA a propósito: el buscador de Unsplash es semántico y
    // añadirle "isolated plain background" devolvía cero resultados. Filtrar
    // por fondo limpio es un juicio visual que se hace mirando, no en la query.
    unsplashQuery: "wool coat",
    unsplashOrientation: "portrait",
  },
  {
    id: "bag",
    // Unsplash · personalgraphic.com · foto IFlg3kFbR0E
    // https://unsplash.com/photos/a-brown-leather-handbag-on-a-white-background-IFlg3kFbR0E
    sourceUrl:
      "https://images.unsplash.com/photo-1691480150204-66dd1eb77391?fm=jpg&q=88&w=1600&fit=max",
    sourceName: "Unsplash · personalgraphic.com",
    license: "Unsplash License (uso comercial permitido, atribución no obligatoria)",
    removeBackground: true,
    // Estudio sobre blanco puro: se quita TODO lo casi blanco, también el hueco
    // encerrado entre las asas.
    backgroundMode: "white",
    backgroundTolerance: 38,
    targetSize: 900,
    unsplashQuery: "leather handbag",
    unsplashOrientation: "squarish",
  },
  {
    id: "shoes",
    // Unsplash · LoboStudio Hamburg · foto 4lf8mVuZESQ
    // https://unsplash.com/photos/pair-of-brown-leather-lace-up-shoes-on-white-surface-4lf8mVuZESQ
    sourceUrl:
      "https://images.unsplash.com/photo-1550998358-08b4f83dc345?fm=jpg&q=88&w=1600&fit=max",
    sourceName: "Unsplash · LoboStudio Hamburg",
    license: "Unsplash License (uso comercial permitido, atribución no obligatoria)",
    removeBackground: true,
    // `border` y no `white` como el bolso: este cuero es pálido y desaturado,
    // así que la regla "neutro y claro = fondo" se comía trozos de la propia
    // bota. Propagando desde el borde, las zonas claras del interior quedan
    // protegidas y el fondo blanco se va igual.
    backgroundMode: "border",
    // 48 y no 34: la sombra bajo la suela es un degradado gris y con poca
    // tolerancia la difusión se paraba a medio camino, dejando un halo claro
    // alrededor del recorte sobre el fondo oscuro del hero. Al propagar solo
    // desde el borde, subirla no puede comerse el interior de la bota.
    backgroundTolerance: 48,
    targetSize: 900,
    unsplashQuery: "leather dress shoes",
    unsplashOrientation: "squarish",
  },
];

const OUT_DIR = join(PROJECT_ROOT, "public", "demo", "products");

/** Resolución mínima aceptable: por debajo, el recorte se ve blando en el hero. */
const MIN_SIDE = 300;
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Quita el fondo por difusión desde los bordes.
 *
 * Un umbral global de luminosidad sería más simple pero borra también las
 * zonas claras de DENTRO del producto (costuras, etiquetas, reflejos). Al
 * propagar solo desde el borde, un píxel claro rodeado de producto no se toca.
 */
/**
 * Quita TODO píxel casi blanco, esté conectado al borde o no.
 *
 * El alfa se desvanece en una rampa en vez de cortar en seco: un corte binario
 * deja el borde dentado y, sobre el fondo oscuro del hero, un filo claro de un
 * píxel que se ve como un halo.
 */
function removeWhiteBackground(
  data: Buffer,
  width: number,
  height: number,
  tolerance: number
): Buffer {
  const hard = 255 - tolerance;
  const soft = hard - 26; // por debajo de esto es producto seguro
  for (let i = 0; i < width * height * 4; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const minC = Math.min(r, g, b);
    const chroma = Math.max(r, g, b) - minC;
    // Solo lo NEUTRO cuenta como fondo: un cuero claro tiene color y se queda.
    if (chroma > 22) continue;
    if (minC >= hard) data[i + 3] = 0;
    else if (minC > soft) {
      data[i + 3] = Math.round(255 * (1 - (minC - soft) / (hard - soft)));
    }
  }
  return data;
}

function removeBorderBackground(
  data: Buffer,
  width: number,
  height: number,
  tolerance = 26
): Buffer {
  const isBackgroundish = (i: number) => {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Casi blanco y casi neutro: el fondo de catálogo, no un gris del producto.
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return minC >= 255 - tolerance && maxC - minC <= 12;
  };

  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (visited[p]) return;
    if (!isBackgroundish(p * 4)) return;
    visited[p] = 1;
    queue.push(p);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (queue.length > 0) {
    const p = queue.pop()!;
    const x = p % width;
    const y = (p / width) | 0;
    data[p * 4 + 3] = 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  return data;
}

/**
 * Origen efectivo del asset y de dónde ha salido, para la trazabilidad.
 *
 * El override por entorno existe porque el abrigo hay que sustituirlo por uno
 * con licencia y no quiero que eso obligue a editar código: basta con
 * `DEMO_ASSET_COAT=/ruta/abrigo.png npm run demo:assets`.
 */
function resolveSource(spec: AssetSpec): { source: string; kind: "env" | "local" | "url" } {
  const override = process.env[`DEMO_ASSET_${spec.id.toUpperCase()}`]?.trim();
  if (override) {
    return { source: override, kind: override.startsWith("http") ? "env" : "local" };
  }
  for (const ext of ["png", "webp", "jpg", "jpeg"]) {
    const local = join(PROJECT_ROOT, "assets", "demo", `${spec.id}.${ext}`);
    if (existsSync(local)) return { source: local, kind: "local" };
  }
  return { source: spec.sourceUrl, kind: "url" };
}

async function fetchAsset(spec: AssetSpec): Promise<{ buffer: Buffer; origin: string }> {
  const { source, kind } = resolveSource(spec);

  if (kind === "local") {
    // Fichero del disco: ni red ni licencia que discutir — lo aporta quien
    // lanza el script y es responsable de su procedencia.
    return { buffer: readFileSync(source), origin: `archivo local: ${source}` };
  }

  const res = await fetch(source, {
    headers: {
      // Sin User-Agent de navegador, varias CDN de imágenes responden 403.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`demasiado grande: ${buf.byteLength} bytes`);
  }
  return { buffer: buf, origin: source };
}

async function prepareAsset(spec: AssetSpec) {
  const { buffer: raw, origin } = await fetchAsset(spec);

  const meta = await sharp(raw).metadata();
  const mime = `image/${meta.format}`;
  if (!ALLOWED_MIME.has(mime)) {
    throw new Error(`MIME no admitido: ${mime}`);
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.min(w, h) < MIN_SIDE) {
    console.warn(
      `  ⚠ ${spec.id}: resolución baja (${w}×${h}); se reescala, pero conviene sustituirlo`
    );
  }

  let pipeline = sharp(raw).ensureAlpha();

  if (spec.removeBackground) {
    const { data, info } = await pipeline
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cut =
      spec.backgroundMode === "white"
        ? removeWhiteBackground(
            data,
            info.width,
            info.height,
            spec.backgroundTolerance ?? 38
          )
        : removeBorderBackground(
            data,
            info.width,
            info.height,
            spec.backgroundTolerance ?? 26
          );
    pipeline = sharp(cut, {
      raw: { width: info.width, height: info.height, channels: 4 },
    });
  }

  if (spec.brightness && spec.brightness !== 1) {
    pipeline = pipeline.modulate({ brightness: spec.brightness });
  }

  // `trim` deja el producto pegado a los bordes del lienzo: así el encuadre no
  // depende del margen que trajera el original y las cajas de detección de la
  // escena pueden calcularse sobre proporciones estables.
  const out = await pipeline
    .trim({ threshold: 1 })
    .resize(spec.targetSize, spec.targetSize, {
      fit: "inside",
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 88, effort: 6, alphaQuality: 90 })
    .toBuffer();

  const finalMeta = await sharp(out).metadata();
  const file = join(OUT_DIR, `${spec.id}.webp`);
  writeFileSync(file, out);

  return {
    id: spec.id,
    file: `public/demo/products/${spec.id}.webp`,
    width: finalMeta.width ?? null,
    height: finalMeta.height ?? null,
    bytes: out.byteLength,
    sha256: createHash("sha256").update(out).digest("hex"),
    source: {
      url: origin,
      declaredUrl: spec.sourceUrl,
      name: spec.sourceName,
      license: spec.license,
      originalFormat: meta.format ?? null,
      originalSize: `${w}x${h}`,
    },
    // Sin fecha automática: `new Date()` haría que cada ejecución produjese un
    // metadata.json distinto aunque los assets fueran idénticos.
    note: [
      spec.removeBackground
        ? `fondo recortado (${spec.backgroundMode ?? "border"})`
        : "original con transparencia",
      spec.brightness && spec.brightness !== 1
        ? `luminosidad ×${spec.brightness}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/* ------------------------- buscador de sustitutos ------------------------- */

type UnsplashHit = {
  id: string;
  width: number;
  height: number;
  description: string;
  author: string;
  authorUrl: string;
  pageUrl: string;
  downloadUrl: string;
};

/**
 * Busca candidatos en Unsplash y los IMPRIME. No descarga ni sustituye nada.
 *
 * Es deliberado que solo liste: elegir la foto es un juicio visual y de
 * licencia que no debe automatizarse. El script imprime la URL lista para
 * pegar en `sourceUrl`, y a partir de ahí el asset vuelve a ser fijo y
 * reproducible.
 */
async function searchUnsplash(spec: AssetSpec): Promise<UnsplashHit[]> {
  const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
  if (!key) throw new Error("falta UNSPLASH_ACCESS_KEY");
  if (!spec.unsplashQuery) return [];

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", spec.unsplashQuery);
  url.searchParams.set("per_page", "8");
  url.searchParams.set("orientation", spec.unsplashOrientation ?? "portrait");
  // `content_filter=high` evita resultados inapropiados en una landing pública.
  url.searchParams.set("content_filter", "high");

  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Unsplash respondió ${res.status}`);
  const data = (await res.json()) as {
    results: Array<{
      id: string;
      width: number;
      height: number;
      alt_description?: string | null;
      description?: string | null;
      user?: { name?: string; links?: { html?: string } };
      links?: { html?: string };
      urls?: { raw?: string };
    }>;
  };

  return data.results.map((r) => ({
    id: r.id,
    width: r.width,
    height: r.height,
    description: r.alt_description ?? r.description ?? "",
    author: r.user?.name ?? "?",
    authorUrl: r.user?.links?.html ?? "",
    pageUrl: r.links?.html ?? "",
    // `raw` + parámetros: se pide el tamaño que hace falta, no el original de
    // 30 MP. `fm=jpg&q=85&w=1600` basta de sobra para un recorte de 900 px.
    downloadUrl: `${r.urls?.raw}&fm=jpg&q=85&w=1600&fit=max`,
  }));
}

async function runSearch() {
  console.log("Candidatos de Unsplash (licencia: uso comercial, sin atribución obligatoria)\n");
  for (const spec of ASSETS) {
    if (!spec.unsplashQuery) continue;
    console.log(`── ${spec.id} · "${spec.unsplashQuery}"`);
    try {
      const hits = await searchUnsplash(spec);
      if (!hits.length) console.log("   sin resultados");
      for (const h of hits) {
        console.log(`   ${h.id}  ${h.width}×${h.height}  ${h.description.slice(0, 44)}`);
        console.log(`      foto: ${h.pageUrl}  ·  autor: ${h.author}`);
        console.log(`      usar: DEMO_ASSET_${spec.id.toUpperCase()}="${h.downloadUrl}" npm run demo:assets`);
      }
    } catch (err) {
      console.error(`   ✗ ${err instanceof Error ? err.message : err}`);
    }
    console.log();
  }
  console.log(
    "Abre las fichas, elige una, y lánzala con la línea `usar:` de arriba.\n" +
      "Cuando te convenza, fija esa URL en ASSETS para que deje de depender de la búsqueda."
  );
}

async function main() {
  if (process.argv.includes("--unsplash")) {
    await runSearch();
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  console.log("Preparando assets de la demo del hero\n");

  const results = [];
  const failures: string[] = [];

  for (const spec of ASSETS) {
    process.stdout.write(`• ${spec.id} … `);
    try {
      const r = await prepareAsset(spec);
      console.log(`✓ ${r.width}×${r.height} · ${(r.bytes / 1024).toFixed(1)} KB`);
      results.push(r);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${msg}`);
      failures.push(`${spec.id}: ${msg}`);
    }
  }

  if (results.length > 0) {
    writeFileSync(
      join(OUT_DIR, "metadata.json"),
      `${JSON.stringify({ assets: results }, null, 2)}\n`
    );
    console.log(`\n✓ metadata.json escrito con ${results.length} asset(s).`);
  }

  if (failures.length > 0) {
    console.error(`\n✖ Fallaron ${failures.length}:`);
    for (const f of failures) console.error(`   ${f}`);
    console.error("\nSustituye la URL en ASSETS o aporta un archivo local.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
