import type { BoundingBox } from "./types";

/**
 * Geometría PURA del crop (sin canvas/DOM): a partir de una bounding box
 * normalizada (0-1) calcula el rectángulo en píxeles del frame, con padding
 * configurable y clamp a los límites de la imagen. Extraída de lib/crop.ts
 * para poder testearla en Node (ver test/cropBox.test.ts).
 */

export type PixelRect = { sx: number; sy: number; sw: number; sh: number };

/** Clampa la box normalizada a [0,1] por si el modelo se sale de rango. */
export function clampNormalizedBox(box: BoundingBox): BoundingBox {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  const width = Math.min(1 - x, Math.max(0, box.width));
  const height = Math.min(1 - y, Math.max(0, box.height));
  return { x, y, width, height };
}

/**
 * Aplica el padding porcentual (sobre el tamaño de la box) y devuelve el
 * rectángulo fuente en píxeles del frame, sin salirse nunca de la imagen.
 */
export function paddedCropRect(
  box: BoundingBox,
  imageWidth: number,
  imageHeight: number,
  paddingPercent: number
): PixelRect {
  const b = clampNormalizedBox(box);
  const pad = Math.max(0, paddingPercent) / 100;
  const px = b.width * pad;
  const py = b.height * pad;
  const x = Math.max(0, b.x - px);
  const y = Math.max(0, b.y - py);
  const w = Math.min(1 - x, b.width + px * 2);
  const h = Math.min(1 - y, b.height + py * 2);
  return {
    sx: x * imageWidth,
    sy: y * imageHeight,
    sw: w * imageWidth,
    sh: h * imageHeight,
  };
}

/** Escala para no superar el lado máximo permitido (nunca amplía). */
export function cropScale(rect: PixelRect, maxSide: number): number {
  return Math.min(1, maxSide / Math.max(rect.sw, rect.sh));
}

/**
 * Gate de calidad para búsqueda visual: un crop demasiado pequeño (lado o
 * área) no aporta señal para identificar el producto — no merece gastar API.
 */
export function cropIsSearchable(
  rect: PixelRect,
  minSidePx: number,
  minAreaPx: number
): boolean {
  return (
    rect.sw >= minSidePx && rect.sh >= minSidePx && rect.sw * rect.sh >= minAreaPx
  );
}
