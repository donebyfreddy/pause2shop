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
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { PROJECT_ROOT } from "./loadEnv";

type AssetSpec = {
  id: "coat" | "bag" | "shoes";
  sourceUrl: string;
  /** Quién publica el original y bajo qué condiciones. */
  sourceName: string;
  license: string;
  /** El original trae fondo opaco y hay que recortarlo. */
  removeBackground: boolean;
  /** Lado mayor del WebP de salida. */
  targetSize: number;
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
    targetSize: 900,
    brightness: 1.45,
  },
  {
    id: "bag",
    sourceUrl:
      "https://png.pngtree.com/png-vector/20241230/ourmid/pngtree-stylish-women-purses-and-handbags-collection-png-image_14975125.png",
    sourceName: "pngtree.com",
    license: "Licencia gratuita de pngtree (exige atribución; uso comercial restringido)",
    removeBackground: false,
    targetSize: 900,
  },
  {
    id: "shoes",
    sourceUrl:
      "https://png.pngtree.com/png-vector/20240729/ourmid/pngtree-men-formal-shoes-png-image_13287455.png",
    sourceName: "pngtree.com",
    license: "Licencia gratuita de pngtree (exige atribución; uso comercial restringido)",
    removeBackground: false,
    targetSize: 900,
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

async function fetchAsset(spec: AssetSpec): Promise<Buffer> {
  const res = await fetch(spec.sourceUrl, {
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
  return buf;
}

async function prepareAsset(spec: AssetSpec) {
  const raw = await fetchAsset(spec);

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
    const cut = removeBorderBackground(data, info.width, info.height);
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
      url: spec.sourceUrl,
      name: spec.sourceName,
      license: spec.license,
      originalFormat: meta.format ?? null,
      originalSize: `${w}x${h}`,
    },
    // Sin fecha automática: `new Date()` haría que cada ejecución produjese un
    // metadata.json distinto aunque los assets fueran idénticos.
    note: [
      spec.removeBackground
        ? "fondo recortado por difusión desde bordes"
        : "original con transparencia",
      spec.brightness && spec.brightness !== 1
        ? `luminosidad ×${spec.brightness}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

async function main() {
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
