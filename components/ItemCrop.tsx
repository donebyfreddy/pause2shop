"use client";

import type { BoundingBox } from "@/lib/types";

/**
 * Recorte visual de un item usando su bounding box normalizada (0..1) sobre
 * el frame analizado. Sin canvas: se recorta con background-position/size,
 * así no hay coste de CPU ni problemas de tainted canvas.
 */
export default function ItemCrop({
  frameUrl,
  box,
  alt,
  className = "h-16 w-16",
}: {
  frameUrl: string;
  box: BoundingBox;
  alt: string;
  className?: string;
}) {
  const w = Math.min(Math.max(box.width, 0.02), 1);
  const h = Math.min(Math.max(box.height, 0.02), 1);
  // background-position en % posiciona el punto p% de la imagen en el p% del
  // contenedor; para un recorte [x, x+w] la fórmula es x/(1-w).
  const posX = w >= 1 ? 0 : (box.x / (1 - w)) * 100;
  const posY = h >= 1 ? 0 : (box.y / (1 - h)) * 100;

  return (
    <div
      role="img"
      aria-label={alt}
      title={alt}
      className={`shrink-0 rounded-lg border border-line bg-surface-2 ${className}`}
      style={{
        backgroundImage: `url(${frameUrl})`,
        backgroundSize: `${100 / w}% ${100 / h}%`,
        backgroundPosition: `${posX}% ${posY}%`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
