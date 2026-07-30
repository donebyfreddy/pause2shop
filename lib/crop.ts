"use client";

import { cropIsSearchable, cropScale, paddedCropRect } from "./cropBox";
import type { BoundingBox } from "./types";

/**
 * Crop REAL de un objeto a partir del frame (cliente, canvas). Es la imagen
 * "detectada en el vídeo" del catálogo y la que se envía a la búsqueda visual
 * inversa (el servidor la publica y la consulta contra Google Lens).
 * La geometría (padding + clamp) vive en lib/cropBox.ts (pura y testeada).
 */

const CROP_PADDING_PERCENT = Number(
  process.env.NEXT_PUBLIC_CROP_PADDING_PERCENT ?? "10"
);
/** Lado máximo del crop resultante: suficiente para Lens sin pesar de más. */
const MAX_CROP_SIDE = 640;
/** Crops más pequeños que esto no aportan señal visual utilizable. */
const MIN_CROP_SIDE_PX = 48;
/** Área mínima (px²) para que el crop merezca una búsqueda externa. */
const MIN_PRODUCT_PIXEL_AREA = Number(
  process.env.NEXT_PUBLIC_MIN_PRODUCT_PIXEL_AREA ?? "18000"
);

export function cropFromDataUrl(
  frameDataUrl: string,
  box: BoundingBox
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const rect = paddedCropRect(
          box,
          img.naturalWidth,
          img.naturalHeight,
          CROP_PADDING_PERCENT
        );

        if (!cropIsSearchable(rect, MIN_CROP_SIDE_PX, MIN_PRODUCT_PIXEL_AREA)) {
          resolve(null);
          return;
        }

        const scale = cropScale(rect, MAX_CROP_SIDE);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(rect.sw * scale);
        canvas.height = Math.round(rect.sh * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(
          img,
          rect.sx,
          rect.sy,
          rect.sw,
          rect.sh,
          0,
          0,
          canvas.width,
          canvas.height
        );
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = frameDataUrl;
  });
}
