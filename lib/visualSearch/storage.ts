import { createHash } from "node:crypto";

import {
  extensionForMime,
  publishPublicObject,
  type StorageConfig,
} from "@/lib/mediaStorage";
import type { VisualSearchConfig } from "./config";

/**
 * Publicación del frame para los motores de búsqueda visual. Google Lens (vía
 * SearchAPI o SerpAPI) exige una URL pública de la imagen: no acepta base64.
 * Subimos el frame una sola vez por hash, de forma idempotente.
 *
 * El "dónde" lo decide el adaptador (lib/mediaStorage), no este módulo:
 * antes esto hablaba directamente con la API REST de Supabase Storage y cambiar
 * de proveedor implicaba tocar aquí.
 *
 * Privacidad: solo se publica el frame que el usuario ha decidido analizar, con
 * nombre derivado del hash (no enumerable) y reutilizable entre análisis.
 */

export type DecodedImage = {
  buffer: Buffer;
  mime: string;
  /** sha256 hex del contenido — clave de caché y nombre de fichero. */
  hash: string;
};

export function decodeImageDataUrl(imageDataUrl: string): DecodedImage | null {
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(imageDataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
  if (buffer.byteLength === 0) return null;
  const hash = createHash("sha256").update(buffer).digest("hex");
  return { buffer, mime, hash };
}

/** Se mantiene exportada: varios módulos derivan de aquí el nombre del fichero. */
export function extensionFor(mime: string): string {
  return extensionForMime(mime);
}

/**
 * Publica el frame y devuelve su URL pública, o null si no se ha podido (el
 * engine continúa sin Lens en ese caso, ver engine.ts).
 */
export async function uploadFramePublic(
  image: DecodedImage,
  config: VisualSearchConfig,
  /** Carpeta destino: "frames" (frame completo) o "crops" (recorte por objeto). */
  prefix: "frames" | "crops" = "frames",
  /**
   * Origen de la petición en curso. Lo necesita el proveedor `local`, que sirve
   * la imagen desde la propia app; los proveedores externos lo ignoran.
   */
  requestOrigin: string | null = null
): Promise<string | null> {
  const result = await publishPublicObject({
    hash: image.hash,
    buffer: image.buffer,
    mime: image.mime,
    prefix,
    requestOrigin,
    config: config.storage as StorageConfig | undefined,
  });

  if (!result.ok) {
    console.warn(`[visualSearch] Publicación del frame omitida: ${result.reason}`);
    return null;
  }
  return result.url;
}
