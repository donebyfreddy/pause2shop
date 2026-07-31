"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { itemImageCandidates } from "@/lib/catalog/images";
import type {
  CatalogItem,
  FrameSourceType,
  ItemStatus,
  ItemType,
  RecommendationMatchType,
} from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/**
 * Hooks de traducción para los labels de tipo/estado/match. Se exponen como
 * hooks (no como Record estático) porque dependen del locale activo.
 */
export function useTypeLabels(): Record<ItemType, string> {
  const t = useTranslations("publicCatalog.itemTypes");
  return {
    clothing: t("clothing"),
    footwear: t("footwear"),
    accessory: t("accessory"),
    electronics: t("electronics"),
    home: t("home"),
    beauty: t("beauty"),
    other: t("other"),
  };
}

export function useStatusLabels(): Record<ItemStatus, string> {
  const t = useTranslations("publicCatalog.itemStatus");
  return {
    detected: t("detected"),
    reviewed: t("reviewed"),
    matched: t("matched"),
    ignored: t("ignored"),
  };
}

export function useSourceTypeLabels(): Partial<Record<FrameSourceType, string>> {
  const t = useTranslations("publicCatalog.sourceTypes");
  return {
    youtube: t("youtube"),
    dailymotion: t("dailymotion"),
    vimeo: t("vimeo"),
    direct_mp4: t("directMp4"),
    hls: t("hls"),
    uploaded: t("uploaded"),
    image_upload: t("imageUpload"),
    screen_capture: t("screenCapture"),
  };
}

const STATUS_TONES: Record<ItemStatus, string> = {
  detected: "border-brand-bright/30 bg-brand/15 text-brand-bright",
  reviewed: "border-info/30 bg-info/15 text-info",
  matched: "border-success/30 bg-success/15 text-success",
  ignored: "border-ink-subtle/30 bg-ink-subtle/15 text-ink-muted",
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  const labels = useStatusLabels();
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        STATUS_TONES[status]
      )}
    >
      {labels[status]}
    </span>
  );
}

export function useMatchTypeLabels(): Record<RecommendationMatchType, string> {
  const t = useTranslations("publicCatalog.matchType");
  return {
    exact: t("exact"),
    near_exact: t("nearExact"),
    similar: t("similar"),
  };
}

const MATCH_TYPE_TONES: Record<RecommendationMatchType, string> = {
  exact: "border-success/30 bg-success/15 text-success",
  near_exact: "border-accent/30 bg-accent/15 text-accent",
  similar: "border-warning/30 bg-warning/15 text-warning",
};

/** Badge del tipo de coincidencia visual (exact / near_exact / similar). */
export function MatchTypeBadge({
  matchType,
}: {
  matchType: RecommendationMatchType | null;
}) {
  const labels = useMatchTypeLabels();
  if (!matchType) return null;
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        MATCH_TYPE_TONES[matchType]
      )}
    >
      {labels[matchType]}
    </span>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 75
      ? "bg-success/15 text-success border-success/30"
      : pct >= 55
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-ink-subtle/15 text-ink-muted border-ink-subtle/30";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}>
      {pct}%
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-white/5 px-2 py-0.5 text-[11px] text-ink-muted">
      {children}
    </span>
  );
}

const TYPE_ICONS: Record<ItemType, string> = {
  clothing: "👕",
  footwear: "👟",
  accessory: "🕶️",
  electronics: "🎧",
  home: "🛋️",
  beauty: "💄",
  other: "🛍️",
};

/** Icono de placeholder por CATEGORÍA (más específico que el tipo grueso). */
function placeholderIcon(item: Pick<CatalogItem, "type" | "category">): string {
  const cat = (item.category ?? "").toLowerCase();
  if (/coche|car|vehic|automo|suv|deportivo|moto/.test(cat)) return "🚗";
  if (/reloj|watch/.test(cat)) return "⌚";
  if (/mueble|silla|sofa|sofá|lampara|lámpara/.test(cat)) return "🛋️";
  return TYPE_ICONS[(item.type as ItemType) ?? "other"] ?? "🛍️";
}

export function colorToHex(color?: string | null): string {
  const map: Record<string, string> = {
    negro: "#27272a", blanco: "#a1a1aa", gris: "#52525b", azul: "#3b82f6",
    rojo: "#ef4444", verde: "#22c55e", amarillo: "#eab308", rosa: "#ec4899",
    morado: "#8b5cf6", marron: "#92400e", beige: "#d6d3d1", naranja: "#f97316",
    denim: "#1e3a8a", crema: "#e7e5e4", plateado: "#9ca3af", dorado: "#ca8a04",
  };
  const key = (color ?? "").toLowerCase();
  for (const [name, hex] of Object.entries(map)) if (key.includes(name)) return hex;
  return "#6366f1";
}

type ThumbItem = Pick<
  CatalogItem,
  "type" | "color" | "imageCropUrl" | "frameImageUrl" | "name" | "category"
>;

/**
 * Miniatura del item con la IMAGEN REAL detectada. Orden de fallback:
 * crop detectado → frame de origen → imagen del mejor match → placeholder por
 * categoría. Si una URL (p. ej. externa) falla al cargar, avanza a la
 * siguiente candidata en vez de dejar la tarjeta vacía.
 */
export function ItemThumb({
  item,
  matchImageUrl,
  className,
}: {
  item: ThumbItem;
  /** Imagen del producto encontrado, como último recurso visual. */
  matchImageUrl?: string | null;
  className?: string;
}) {
  const candidates = itemImageCandidates(item, matchImageUrl);
  const [failed, setFailed] = useState<Set<string>>(new Set());

  // Si cambian las imágenes del item, reintenta desde la primera candidata.
  // Patrón "adjust state during render" recomendado por React (sin efecto).
  const candidatesKey = candidates.join("|");
  const [prevKey, setPrevKey] = useState(candidatesKey);
  if (prevKey !== candidatesKey) {
    setPrevKey(candidatesKey);
    setFailed(new Set());
  }

  const src = candidates.find((c) => !failed.has(c));
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={item.name}
        loading="lazy"
        className={cn("object-cover", className)}
        onError={() =>
          setFailed((prev) => {
            const next = new Set(prev);
            next.add(src);
            return next;
          })
        }
      />
    );
  }

  // Fallback FINAL: placeholder por categoría (solo si no hay ninguna imagen).
  const hex = colorToHex(item.color);
  return (
    <div
      className={cn("flex items-center justify-center text-3xl", className)}
      style={{
        background: `linear-gradient(135deg, ${hex}40, rgba(9,9,11,0.9))`,
      }}
      aria-hidden
    >
      <span>{placeholderIcon(item)}</span>
    </div>
  );
}
