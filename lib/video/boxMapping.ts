import type { BoundingBox, DetectedItem } from "@/lib/types";

/**
 * Geometría PURA de bounding boxes sobre el vídeo renderizado: mapping con
 * object-fit (letterboxing), validación, supresión de cajas absurdas y NMS.
 * Sin DOM → test/boxMapping.test.ts.
 */

export type RenderedRect = { x: number; y: number; width: number; height: number };

/**
 * Mapea una box normalizada (0-1 sobre el FRAME del vídeo) a píxeles del
 * elemento renderizado, teniendo en cuenta `object-fit` (contain = barras,
 * cover = recorte). Este es el punto ÚNICO de conversión: el overlay nunca
 * debe multiplicar por width/height directamente.
 */
export function mapNormalizedBoxToRenderedVideo(
  box: BoundingBox,
  videoWidth: number,
  videoHeight: number,
  elementWidth: number,
  elementHeight: number,
  objectFit: "contain" | "cover" = "contain"
): RenderedRect {
  if (!videoWidth || !videoHeight || !elementWidth || !elementHeight) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const videoRatio = videoWidth / videoHeight;
  const elementRatio = elementWidth / elementHeight;

  // Escala del frame dentro del elemento según object-fit.
  const scale =
    objectFit === "contain"
      ? videoRatio > elementRatio
        ? elementWidth / videoWidth
        : elementHeight / videoHeight
      : videoRatio > elementRatio
        ? elementHeight / videoHeight
        : elementWidth / videoWidth;

  const renderedW = videoWidth * scale;
  const renderedH = videoHeight * scale;
  // contain → barras (offset positivo); cover → recorte (offset negativo).
  const offsetX = (elementWidth - renderedW) / 2;
  const offsetY = (elementHeight - renderedH) / 2;

  return {
    x: offsetX + box.x * renderedW,
    y: offsetY + box.y * renderedH,
    width: box.width * renderedW,
    height: box.height * renderedH,
  };
}

/** ¿La box normalizada es geométricamente válida (dentro de [0,1], área > 0)? */
export function isValidBox(box: BoundingBox | null | undefined): box is BoundingBox {
  if (!box) return false;
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= 1.001 &&
    box.y + box.height <= 1.001
  );
}

/**
 * ¿Caja absurdamente grande? Una "camisa" que cubre el 90% de la escena es
 * casi seguro un error de encuadre del modelo (persona/escena completa).
 */
export function isOversizedBox(box: BoundingBox, maxAreaFraction = 0.85): boolean {
  return box.width * box.height > maxAreaFraction;
}

/** Intersection-over-Union de dos boxes normalizadas. */
export function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const iw = Math.max(0, x2 - x1);
  const ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Non-Maximum Suppression entre items de la MISMA categoría gruesa: cuando
 * dos detecciones se solapan mucho, sobrevive la de mayor confianza.
 * Devuelve los items supervivientes en el orden original.
 */
export function suppressDuplicateBoxes<
  T extends Pick<DetectedItem, "bounding_box" | "confidence" | "category">,
>(items: T[], iouThreshold = 0.65): T[] {
  const survivors: T[] = [];
  const sorted = [...items].sort((a, b) => b.confidence - a.confidence);
  const kept: T[] = [];
  for (const item of sorted) {
    if (!isValidBox(item.bounding_box)) {
      kept.push(item);
      continue;
    }
    const duplicate = kept.some(
      (k) =>
        isValidBox(k.bounding_box) &&
        normCat(k.category) === normCat(item.category) &&
        iou(k.bounding_box, item.bounding_box!) >= iouThreshold
    );
    if (!duplicate) kept.push(item);
  }
  for (const item of items) if (kept.includes(item)) survivors.push(item);
  return survivors;
}

function normCat(c?: string | null): string {
  return (c ?? "").toLowerCase().trim();
}
