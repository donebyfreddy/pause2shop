import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { getConfig } from "../config/index";
import { logger } from "../observability/logger";
import { dhash } from "./dhash";
import { getEmbeddingProvider } from "../embeddings/index";
import { politeFetchBinary } from "../connectors/base/httpClient";

/**
 * Pipeline de imágenes: descarga (respetando robots), validación real del
 * formato (sharp falla con bytes corruptos — no confiamos solo en el
 * Content-Type), normalización de orientación EXIF y versión optimizada de
 * máx. 512px para embeddings. La URL original SIEMPRE se conserva como
 * referencia; el fichero local es un derivado regenerable.
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "tiff"]);

export interface ProcessedImage {
  sha256: string;
  perceptualHash: string;
  localPath: string;
  width: number;
  height: number;
  embedding: number[];
  optimized: Buffer;
}

/** Procesa bytes de imagen ya descargados (fixtures, uploads, base64). */
export async function processImageBuffer(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new Error("imagen vacía");
  if (input.length > MAX_IMAGE_BYTES) {
    throw new Error(`imagen demasiado grande (${input.length} bytes > ${MAX_IMAGE_BYTES})`);
  }

  // sharp.metadata() valida la cabecera real; una imagen corrupta lanza aquí.
  const meta = await sharp(input).metadata();
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new Error(`formato de imagen no soportado: ${meta.format ?? "desconocido"}`);
  }
  if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16) {
    throw new Error("imagen demasiado pequeña o sin dimensiones");
  }

  // .rotate() sin argumentos aplica la orientación EXIF; después reducimos a
  // 512px máx. — suficiente para CLIP (224px de entrada) sin perder detalle.
  const optimized = await sharp(input)
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const outMeta = await sharp(optimized).metadata();
  const sha256 = createHash("sha256").update(optimized).digest("hex");
  const perceptualHash = await dhash(optimized);

  const provider = await getEmbeddingProvider();
  const embedding = await provider.embedImage(optimized);

  const { imagesDir } = getConfig();
  mkdirSync(imagesDir, { recursive: true });
  const localPath = join(imagesDir, `${sha256}.jpg`);
  writeFileSync(localPath, optimized);

  return {
    sha256,
    perceptualHash,
    localPath,
    width: outMeta.width ?? 0,
    height: outMeta.height ?? 0,
    embedding,
    optimized,
  };
}

/**
 * Descarga y procesa una imagen remota. Devuelve null (sin lanzar) si la
 * descarga falla o la imagen es inválida: una imagen rota no debe tumbar un
 * sync entero, solo registrarse como error del item.
 */
export async function downloadAndProcessImage(url: string): Promise<ProcessedImage | null> {
  try {
    const res = await politeFetchBinary(url);
    if (res.status < 200 || res.status >= 300) {
      logger.debug("descarga de imagen fallida", { url, status: res.status });
      return null;
    }
    if (res.contentType && !res.contentType.startsWith("image/")) {
      logger.debug("contenido no es imagen", { url, contentType: res.contentType });
      return null;
    }
    return await processImageBuffer(res.body);
  } catch (err) {
    logger.debug("imagen descartada", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
