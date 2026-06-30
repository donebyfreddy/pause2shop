"use client";

import type { CatalogItem, FrameSourceType } from "@/lib/catalog/types";
import { formatTimestamp } from "@/lib/utils";
import { Chip, ConfidenceBadge, ItemThumb, StatusBadge, TYPE_LABELS } from "./catalogUi";

const SOURCE_LABELS: Partial<Record<FrameSourceType, string>> = {
  youtube: "YouTube",
  dailymotion: "Dailymotion",
  vimeo: "Vimeo",
  direct_mp4: "MP4 directo",
  hls: "HLS / Stream",
  image_upload: "Imagen subida",
  screen_capture: "Captura de pantalla",
  uploaded: "Vídeo local",
};

function originLabel(sourceType: FrameSourceType | null, timestampSeconds: number): string {
  if (sourceType === "image_upload") return "🖼️ imagen subida";
  if (sourceType === "screen_capture") return "🖥️ captura de pantalla";
  return `⏱ ${formatTimestamp(timestampSeconds)}`;
}

function OriginChip({ sourceType }: Readonly<{ sourceType: FrameSourceType }>) {
  const label = SOURCE_LABELS[sourceType];
  if (!label) return null;
  return <Chip>{label}</Chip>;
}

type Props = {
  item: CatalogItem;
  busy?: boolean;
  onOpen: (item: CatalogItem) => void;
  onIgnore: (item: CatalogItem) => void;
  onReview: (item: CatalogItem) => void;
};

export default function CatalogItemCard({ item, busy, onOpen, onIgnore, onReview }: Props) {
  return (
    <article
      className={
        "group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-white/20 hover:bg-white/[0.05]" +
        (item.status === "ignored" ? " opacity-60" : "")
      }
    >
      <button
        onClick={() => onOpen(item)}
        className="relative block aspect-square w-full overflow-hidden text-left"
        title="Ver detalle y recomendaciones"
      >
        <ItemThumb item={item} className="h-full w-full transition group-hover:scale-[1.03]" />
        <span className="absolute left-2 top-2">
          <StatusBadge status={item.status} />
        </span>
        <span className="absolute right-2 top-2">
          <ConfidenceBadge value={item.confidence} />
        </span>
        {item.detectionCount > 1 && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-zinc-300">
            ×{item.detectionCount}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight text-zinc-100">
          {item.name}
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {item.type && <Chip>{TYPE_LABELS[item.type] ?? item.type}</Chip>}
          <Chip>{item.category}</Chip>
          {item.color && <Chip>{item.color}</Chip>}
          {item.style && <Chip>{item.style}</Chip>}
        </div>

        <p className="text-[11px] text-zinc-500">
          {originLabel(item.sourceType, item.timestampSeconds)}
          {item.visibleBrand ? ` · marca: ${item.visibleBrand}` : ""}
        </p>
        {item.sourceType && item.sourceType !== "uploaded" && item.sourceType !== "external_url" && (
          <OriginChip sourceType={item.sourceType} />
        )}

        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <button
            onClick={() => onOpen(item)}
            className="rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:brightness-110"
          >
            Ver recomendaciones
          </button>
          {item.status !== "reviewed" && (
            <button
              onClick={() => onReview(item)}
              disabled={busy}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-200 transition hover:bg-white/10 disabled:opacity-40"
            >
              Marcar revisado
            </button>
          )}
          {item.status !== "ignored" ? (
            <button
              onClick={() => onIgnore(item)}
              disabled={busy}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-40"
            >
              Ignorar
            </button>
          ) : (
            <button
              onClick={() => onReview(item)}
              disabled={busy}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:text-zinc-200 disabled:opacity-40"
            >
              Reactivar
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
