import { createHash } from "node:crypto";
import type { VisualSearchConfig } from "./config";

/**
 * Publicación del frame en Supabase Storage. Google Lens (vía SearchAPI o
 * SerpAPI) exige una URL pública de la imagen: no acepta base64. Subimos el
 * frame una sola vez por hash (idempotente con x-upsert) a un bucket público.
 *
 * Privacidad: solo se sube el frame que el usuario ha decidido analizar, con
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

function extensionFor(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

/**
 * Sube el frame al bucket y devuelve su URL pública, o null si no hay storage
 * configurado o la subida falla (el engine continúa sin Lens en ese caso).
 */
export async function uploadFramePublic(
  image: DecodedImage,
  config: VisualSearchConfig
): Promise<string | null> {
  const storage = config.storage;
  if (!storage) return null;

  const path = `frames/${image.hash}.${extensionFor(image.mime)}`;
  const uploadUrl = `${storage.supabaseUrl}/storage/v1/object/${storage.bucket}/${path}`;
  const publicUrl = `${storage.supabaseUrl}/storage/v1/object/public/${storage.bucket}/${path}`;

  try {
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${storage.serviceRoleKey}`,
        "Content-Type": image.mime,
        "x-upsert": "true",
      },
      body: new Uint8Array(image.buffer),
    });
    // 409 = ya existe (carrera con otro upload del mismo hash): la URL vale igual.
    if (!res.ok && res.status !== 409) {
      console.warn(
        `[visualSearch] Subida de frame falló (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`
      );
      return null;
    }
    return publicUrl;
  } catch (err) {
    console.warn("[visualSearch] Subida de frame falló:", err);
    return null;
  }
}
