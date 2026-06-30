"use client";

import { useEffect, useRef } from "react";
import type { DetectedItem } from "@/lib/types";

/**
 * Canvas overlay rendered absolutely on top of a video player.
 * Draws bounding boxes for each DetectedItem that has a bounding_box.
 * Bounding box coords are normalized 0..1 (fraction of frame width/height).
 * Clicking a box fires onItemClick with the corresponding item.
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
};

export default function VideoOverlay({ items, onItemClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Redraw whenever items change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const itemsWithBox = items.filter((it) => it.bounding_box);
    if (itemsWithBox.length === 0) return;

    ctx.save();
    ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";

    itemsWithBox.forEach((item, idx) => {
      const bb = item.bounding_box!;
      const color = BOX_COLORS[idx % BOX_COLORS.length];

      const px = bb.x * W;
      const py = bb.y * H;
      const pw = bb.width * W;
      const ph = bb.height * H;

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

      // Label
      const name = item.name.length > 22 ? item.name.slice(0, 20) + "…" : item.name;
      const conf = `${Math.round(item.confidence * 100)}%`;
      const label = `${name}  ${conf}`;
      const tw = ctx.measureText(label).width;
      const lh = 16;
      const lx = px;
      const ly = py > lh + 2 ? py - lh - 2 : py + ph + 2;

      ctx.fillStyle = `${color}d0`;
      ctx.beginPath();
      ctx.roundRect(lx, ly, tw + 10, lh, 3);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, lx + 5, ly + 11);
    });

    ctx.restore();
  }, [items]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!onItemClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    for (const item of items) {
      if (!item.bounding_box) continue;
      const { x, y, width, height } = item.bounding_box;
      if (mx >= x && mx <= x + width && my >= y && my <= y + height) {
        onItemClick(item);
        return;
      }
    }
  }

  const hasBoxes = items.some((it) => it.bounding_box);
  if (!hasBoxes) return null;

  return (
    <canvas
      ref={canvasRef}
      width={1280}
      height={720}
      onClick={handleClick}
      title="Haz clic en un objeto para ver detalles"
      className="pointer-events-auto absolute inset-0 h-full w-full cursor-crosshair"
      style={{ zIndex: 10 }}
    />
  );
}
