import sharp from "sharp";
import { cropIsSearchable, cropScale, paddedCropRect } from "@/lib/cropBox";
import type { BoundingBox } from "@/lib/types";

/**
 * Recorte de un objeto EN EL SERVIDOR, a partir del frame y su bounding box.
 *
 * El análisis de imagen entra por el backend con el frame completo: sin esto,
 * el modo catálogo tendría que buscar la imagen entera contra el índice, y una
 * foto con cuatro objetos no se parece a ningún producto concreto. La geometría
 * (padding + clamp + escala) es la MISMA que usa el cliente en lib/crop.ts —
 * vive en lib/cropBox.ts para que ambos caminos recorten igual.
 */

const CROP_PADDING_PERCENT = Number(process.env.CROP_PADDING_PERCENT ?? "10");
/** Lado máximo del recorte: suficiente para el índice sin pesar de más. */
const MAX_CROP_SIDE = 640;
const MIN_CROP_SIDE_PX = 48;
const MIN_PRODUCT_PIXEL_AREA = Number(
  process.env.MIN_PRODUCT_PIXEL_AREA ?? "18000"
);

function decodeDataUrl(dataUrl: string): Buffer | null {
  const idx = dataUrl.indexOf("base64,");
  if (!dataUrl.startsWith("data:image/") || idx === -1) return null;
  try {
    return Buffer.from(dataUrl.slice(idx + "base64,".length), "base64");
  } catch {
    return null;
  }
}

/**
 * Devuelve el recorte como data URL JPEG, o null si el objeto es demasiado
 * pequeño para aportar señal visual (no se gasta una búsqueda en un recorte
 * de 20×20 px que no identifica nada).
 */
export async function cropFromFrameServer(
  frameDataUrl: string,
  box: BoundingBox
): Promise<string | null> {
  const input = decodeDataUrl(frameDataUrl);
  if (!input) return null;

  try {
    const image = sharp(input, { failOn: "none" });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return null;

    const rect = paddedCropRect(box, meta.width, meta.height, CROP_PADDING_PERCENT);
    if (!cropIsSearchable(rect, MIN_CROP_SIDE_PX, MIN_PRODUCT_PIXEL_AREA)) {
      return null;
    }

    const scale = cropScale(rect, MAX_CROP_SIDE);
    const out = await image
      .extract({
        left: Math.round(rect.sx),
        top: Math.round(rect.sy),
        width: Math.round(rect.sw),
        height: Math.round(rect.sh),
      })
      .resize({
        width: Math.max(1, Math.round(rect.sw * scale)),
        height: Math.max(1, Math.round(rect.sh * scale)),
        fit: "fill",
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    // Un frame corrupto no debe tumbar el análisis: se sigue sin recorte.
    return null;
  }
}
