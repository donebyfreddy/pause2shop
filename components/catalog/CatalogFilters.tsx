"use client";

import type { ItemStatus, ItemType } from "@/lib/catalog/types";
import { STATUS_LABELS, TYPE_LABELS } from "./catalogUi";

export type FilterState = {
  q: string;
  category: string;
  color: string;
  type: string;
  status: string;
  sourceType: string;
};

type Props = {
  value: FilterState;
  total: number;
  persisted: boolean;
  videoFilter?: string | null;
  onChange: (patch: Partial<FilterState>) => void;
  onClear: () => void;
  onClearVideo: () => void;
};

const TYPES: ItemType[] = [
  "clothing",
  "footwear",
  "accessory",
  "electronics",
  "home",
  "beauty",
  "other",
];
const STATUSES: ItemStatus[] = ["detected", "reviewed", "matched", "ignored"];

const SOURCE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "dailymotion", label: "Dailymotion" },
  { value: "vimeo", label: "Vimeo" },
  { value: "direct_mp4", label: "MP4 directo" },
  { value: "hls", label: "HLS / Stream" },
  { value: "uploaded", label: "Vídeo local" },
  { value: "image_upload", label: "Imagen subida" },
  { value: "screen_capture", label: "Captura de pantalla" },
];

const selectClass =
  "rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 outline-none transition focus:border-indigo-400/60 focus:bg-white/10";
const inputClass = selectClass + " placeholder:text-zinc-500";

export default function CatalogFilters({
  value,
  total,
  persisted,
  videoFilter,
  onChange,
  onClear,
  onClearVideo,
}: Props) {
  const hasFilters =
    value.q || value.category || value.color || value.type || value.status || value.sourceType || videoFilter;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <div className="relative flex-1 md:min-w-[220px]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">
            🔍
          </span>
          <input
            value={value.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder="Buscar por nombre, descripción, estilo…"
            className={inputClass + " w-full pl-9"}
          />
        </div>

        <select
          value={value.type}
          onChange={(e) => onChange({ type: e.target.value })}
          className={selectClass}
          aria-label="Tipo"
        >
          <option value="">Todos los tipos</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        <select
          value={value.status}
          onChange={(e) => onChange({ status: e.target.value })}
          className={selectClass}
          aria-label="Estado"
        >
          <option value="">Cualquier estado</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <select
          value={value.sourceType}
          onChange={(e) => onChange({ sourceType: e.target.value })}
          className={selectClass}
          aria-label="Origen"
        >
          <option value="">Cualquier origen</option>
          {SOURCE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          value={value.category}
          onChange={(e) => onChange({ category: e.target.value })}
          placeholder="Categoría"
          className={inputClass + " md:w-36"}
        />
        <input
          value={value.color}
          onChange={(e) => onChange({ color: e.target.value })}
          placeholder="Color"
          className={inputClass + " md:w-32"}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>
          {total} elemento{total === 1 ? "" : "s"}
        </span>
        {!persisted && (
          <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-amber-200">
            catálogo en memoria
          </span>
        )}
        {videoFilter && (
          <button
            onClick={onClearVideo}
            className="rounded-full border border-indigo-400/30 bg-indigo-500/15 px-2 py-0.5 text-indigo-200 transition hover:bg-indigo-500/25"
          >
            vídeo: {videoFilter.slice(0, 8)}… ✕
          </button>
        )}
        {hasFilters && (
          <button
            onClick={onClear}
            className="ml-auto text-zinc-400 transition hover:text-zinc-200"
          >
            Limpiar filtros
          </button>
        )}
      </div>
    </div>
  );
}
