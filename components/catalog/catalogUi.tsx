import type { CatalogItem, ItemStatus, ItemType } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

export const TYPE_LABELS: Record<ItemType, string> = {
  clothing: "Ropa",
  footwear: "Calzado",
  accessory: "Accesorio",
  electronics: "Electrónica",
  home: "Hogar",
  beauty: "Belleza",
  other: "Otro",
};

export const STATUS_LABELS: Record<ItemStatus, string> = {
  detected: "Detectado",
  reviewed: "Revisado",
  matched: "Con productos",
  ignored: "Ignorado",
};

const STATUS_TONES: Record<ItemStatus, string> = {
  detected: "border-indigo-400/30 bg-indigo-500/15 text-indigo-200",
  reviewed: "border-sky-400/30 bg-sky-500/15 text-sky-200",
  matched: "border-emerald-400/30 bg-emerald-500/15 text-emerald-200",
  ignored: "border-zinc-500/30 bg-zinc-500/15 text-zinc-400",
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        STATUS_TONES[status]
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 75
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : pct >= 55
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}>
      {pct}%
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
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

/**
 * Miniatura del item. No guardamos la imagen del frame (privacidad), así que
 * mostramos un tile con el color detectado + icono del tipo. Si en el futuro se
 * activa Supabase Storage, se usa imageCropUrl/frameImageUrl.
 */
export function ItemThumb({
  item,
  className,
}: {
  item: Pick<CatalogItem, "type" | "color" | "imageCropUrl" | "frameImageUrl" | "name">;
  className?: string;
}) {
  const img = item.imageCropUrl || item.frameImageUrl;
  if (img) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={img} alt={item.name} className={cn("object-cover", className)} />;
  }
  const hex = colorToHex(item.color);
  const icon = TYPE_ICONS[(item.type as ItemType) ?? "other"] ?? "🛍️";
  return (
    <div
      className={cn("flex items-center justify-center text-3xl", className)}
      style={{
        background: `linear-gradient(135deg, ${hex}40, rgba(9,9,11,0.9))`,
      }}
      aria-hidden
    >
      <span>{icon}</span>
    </div>
  );
}
