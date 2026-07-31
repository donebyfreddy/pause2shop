/**
 * Pipeline de imágenes para la importación de datasets.
 *
 * ¿Por qué no se reutiliza `images/processor.ts`? Porque ese pipeline escribe el
 * fichero en `os.tmpdir()` y genera el embedding SIEMPRE. Para un catálogo
 * persistente ninguna de las dos cosas sirve: en serverless el tmp se borra en
 * cada cold start (que es justo el bug por el que `reindex_embeddings` no
 * encontraba imágenes), y el embedding tiene que poder encolarse en vez de
 * generarse, o una importación de 1.000 fichas se convierte en 1.000
 * inferencias de CLIP en serie.
 *
 * Aquí la imagen va a storage persistente y de la base solo cuelga la URL, el
 * sha256 y el hash perceptual. Se comparten las primitivas de hashing con el
 * pipeline de scraping para que una imagen del dataset y la misma imagen
 * scrapeada produzcan el mismo hash y el dedup las reconozca.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";

import { getStorageConfig, publishPublicObject } from "@/lib/mediaStorage";
import { dhash } from "../images/dhash";
import type { ProductImage } from "../catalog/types";
import { datasetImagePath, datasetThumbPath } from "./normalize";
import type { DatasetDescriptor } from "./types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "tiff"]);

/**
 * Por debajo de este ancho no se genera miniatura aparte: las imágenes de
 * `fashion-product-images-small` son de 60×80 px, así que una "miniatura"
 * sería del mismo tamaño que el original. Duplicar el objeto costaría el doble
 * de PUTs y de almacenamiento para servir exactamente los mismos píxeles.
 */
const THUMB_TARGET_PX = 128;

export interface PreparedImage {
  image: ProductImage;
  /** Bytes optimizados: los necesita el embedding, no se persisten. */
  optimized: Buffer;
  uploaded: boolean;
  /** true si el objeto ya estaba en storage y no se resubió. */
  alreadyExisted: boolean;
  thumbUrl: string | null;
}

export type PrepareImageResult =
  | { ok: true; prepared: PreparedImage }
  | { ok: false; reason: string };

/**
 * Valida, normaliza y sube una imagen del dataset.
 *
 * `uploadImages: false` permite una importación de solo metadatos: se calculan
 * los hashes (que son deterministas y sirven para el dedup) pero no se sube
 * nada y la ficha queda sin URL de imagen.
 */
export async function prepareDatasetImage(options: {
  buffer: Buffer;
  descriptor: DatasetDescriptor;
  sourceProductId: string;
  /** URL de origen, solo para trazabilidad. En HF caduca; no se sirve de ahí. */
  originUrl: string | null;
  uploadImages: boolean;
}): Promise<PrepareImageResult> {
  const { buffer, descriptor, sourceProductId } = options;

  if (buffer.length === 0) return { ok: false, reason: "imagen vacía" };
  if (buffer.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `imagen demasiado grande (${buffer.length} bytes)`,
    };
  }

  // sharp.metadata() lee la cabecera real. El Content-Type del servidor no
  // basta: un HTML de error servido como image/jpeg pasaría el filtro.
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch (error) {
    return {
      ok: false,
      reason: `imagen corrupta: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    return { ok: false, reason: `formato no soportado: ${meta.format ?? "desconocido"}` };
  }
  if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16) {
    return { ok: false, reason: "imagen sin dimensiones o demasiado pequeña" };
  }

  // .rotate() sin argumentos aplica la orientación EXIF. Sin esto, una foto
  // girada produce un dHash distinto al de la misma foto ya derecha y el dedup
  // deja de reconocerla.
  const optimized = await sharp(buffer)
    .rotate()
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();

  const outMeta = await sharp(optimized).metadata();
  const sha256 = createHash("sha256").update(optimized).digest("hex");
  const perceptualHash = await dhash(optimized);

  const image: ProductImage = {
    // Si no se sube, `url` guarda la de origen para no perder la referencia,
    // aun sabiendo que en HuggingFace caduca.
    url: options.originUrl ?? "",
    localPath: null,
    sha256,
    perceptualHash,
    width: outMeta.width ?? meta.width,
    height: outMeta.height ?? meta.height,
  };

  if (!options.uploadImages) {
    return {
      ok: true,
      prepared: {
        image,
        optimized,
        uploaded: false,
        alreadyExisted: false,
        thumbUrl: null,
      },
    };
  }

  const pathname = datasetImagePath(descriptor, sourceProductId);
  const published = await publishPublicObject({
    hash: sha256,
    buffer: optimized,
    mime: "image/jpeg",
    pathname,
    config: getStorageConfig(),
  });
  if (!published.ok) return { ok: false, reason: `storage: ${published.reason}` };

  image.url = published.url;
  // `localPath` guarda la CLAVE en storage, no una ruta de disco. Es lo que
  // permite localizar y borrar los objetos de un dataset concreto.
  image.localPath = pathname;

  let thumbUrl: string | null = null;
  const width = outMeta.width ?? 0;
  if (width > THUMB_TARGET_PX) {
    const thumb = await sharp(optimized)
      .resize(THUMB_TARGET_PX, THUMB_TARGET_PX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const thumbPublished = await publishPublicObject({
      hash: `${sha256}-thumb`,
      buffer: thumb,
      mime: "image/jpeg",
      pathname: datasetThumbPath(descriptor, sourceProductId),
      config: getStorageConfig(),
    });
    // Que falle la miniatura no invalida la ficha: la imagen principal ya está.
    if (thumbPublished.ok) thumbUrl = thumbPublished.url;
  } else {
    // Ya es del tamaño de una miniatura: se sirve la misma URL.
    thumbUrl = published.url;
  }

  return {
    ok: true,
    prepared: {
      image,
      optimized,
      uploaded: true,
      alreadyExisted: published.alreadyExisted === true,
      thumbUrl,
    },
  };
}
