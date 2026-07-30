"use client";

import { useCallback, useEffect, useRef } from "react";
import { mapNormalizedBoxToRenderedVideo, isValidBox } from "@/lib/video/boxMapping";
import { presentationPriority } from "@/lib/priority";
import type { DetectedItem } from "@/lib/types";

/**
 * Canvas overlay sobre el reproductor: pinta bounding boxes de cada
 * DetectedItem. Las coordenadas normalizadas 0-1 se convierten a píxeles del
 * elemento con mapNormalizedBoxToRenderedVideo (única fuente de verdad:
 * object-fit contain + letterboxing + devicePixelRatio + resize).
 *
 * Labels: cortas sobre el vídeo ("Camisa floral · 95%"), con resolución de
 * colisiones (se desplazan si se solapan). El nombre completo vive en el
 * panel lateral. Las cajas de prioridad baja (plantas, barandillas…) no se
 * pintan por defecto.
 */

const BOX_COLORS = [
  "#6366f1", // indigo
  "#f43f5e", // rose
  "#10b981", // emerald
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f97316", // orange
];

type Props = {
  items: DetectedItem[];
  onItemClick?: (item: DetectedItem) => void;
  /** Relación de aspecto real del vídeo (videoWidth/videoHeight); 16/9 si se desconoce. */
  videoAspect?: number | null;
  /** Pintar también objetos de prioridad baja (debug). */
  showLowPriority?: boolean;
};

type Rect = { x: number; y: number; width: number; height: number };

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Etiqueta corta para el vídeo: 2-3 palabras + confianza. */
function shortLabel(item: DetectedItem): string {
  const words = item.name.split(/\s+/).slice(0, 3).join(" ");
  const name = words.length > 20 ? `${words.slice(0, 18)}…` : words;
  return `${name} · ${Math.round(item.confidence * 100)}%`;
}

export default function VideoOverlay({
  items,
  onItemClick,
  videoAspect,
  showLowPriority = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visibleItems = items.filter(
    (it) =>
      isValidBox(it.bounding_box) &&
      (showLowPriority || presentationPriority(it) !== "low")
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Tamaño físico = tamaño CSS × DPR (nítido en pantallas retina y estable
    // ante resize/fullscreen).
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (visibleItems.length === 0) return;

    const aspect = videoAspect && videoAspect > 0 ? videoAspect : 16 / 9;
    ctx.save();
    ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";

    const placedLabels: Rect[] = [];

    visibleItems.forEach((item, idx) => {
      const rect = mapNormalizedBoxToRenderedVideo(
        item.bounding_box!,
        aspect * 1000,
        1000,
        cssW,
        cssH,
        "contain"
      );
      if (rect.width <= 0 || rect.height <= 0) return;
      const color = BOX_COLORS[idx % BOX_COLORS.length];
      const { x: px, y: py, width: pw, height: ph } = rect;

      // Box stroke
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);

      // Corner accent
      const cs = Math.min(12, pw * 0.15, ph * 0.15);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py + cs); ctx.lineTo(px, py); ctx.lineTo(px + cs, py);
      ctx.moveTo(px + pw - cs, py); ctx.lineTo(px + pw, py); ctx.lineTo(px + pw, py + cs);
      ctx.moveTo(px + pw, py + ph - cs); ctx.lineTo(px + pw, py + ph); ctx.lineTo(px + pw - cs, py + ph);
      ctx.moveTo(px + cs, py + ph); ctx.lineTo(px, py + ph); ctx.lineTo(px, py + ph - cs);
      ctx.strokeStyle = color;
      ctx.stroke();

      // Label con resolución de colisiones: encima → debajo → desplazada.
      const label = shortLabel(item);
      const tw = ctx.measureText(label).width + 10;
      const lh = 16;
      let lx = Math.min(px, cssW - tw);
      let ly = py > lh + 2 ? py - lh - 2 : py + ph + 2;
      let attempts = 0;
      while (
        attempts < 6 &&
        placedLabels.some((r) => intersects(r, { x: lx, y: ly, width: tw, height: lh }))
      ) {
        ly += lh + 3;
        if (ly + lh > cssH) {
          ly = Math.max(0, py - lh - 2 - (attempts + 1) * (lh + 3));
          lx = Math.min(px + 12 * (attempts + 1), cssW - tw);
        }
        attempts++;
      }
      placedLabels.push({ x: lx, y: ly, width: tw, height: lh });

      ctx.fillStyle = `${color}d0`;
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw, lh, 3);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, lx + 5, ly + 11);
    });

    ctx.restore();
  }, [visibleItems, videoAspect]);

  // Redibuja al cambiar items y al redimensionar el elemento.
  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onItemClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const mx = e.clientX - bounds.left;
    const my = e.clientY - bounds.top;
    const aspect = videoAspect && videoAspect > 0 ? videoAspect : 16 / 9;

    for (const item of visibleItems) {
      const rect = mapNormalizedBoxToRenderedVideo(
        item.bounding_box!,
        aspect * 1000,
        1000,
        bounds.width,
        bounds.height,
        "contain"
      );
      if (
        mx >= rect.x &&
        mx <= rect.x + rect.width &&
        my >= rect.y &&
        my <= rect.y + rect.height
      ) {
        onItemClick(item);
        return;
      }
    }
  }

  if (visibleItems.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      title="Haz clic en un objeto para ver detalles"
      className="pointer-events-auto absolute inset-0 h-full w-full cursor-crosshair"
      style={{ zIndex: 10 }}
    />
  );
}
