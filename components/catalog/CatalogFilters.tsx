"use client";

import { useTranslations } from "next-intl";
import type { ItemStatus, ItemType } from "@/lib/catalog/types";
import { useSourceTypeLabels, useStatusLabels, useTypeLabels } from "./catalogUi";

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

const SOURCE_TYPE_VALUES = [
  "youtube",
  "dailymotion",
  "vimeo",
  "direct_mp4",
  "hls",
  "uploaded",
  "image_upload",
  "screen_capture",
] as const;

const selectClass =
  "rounded-lg border border-line bg-white/5 px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-bright/60 focus:bg-white/10";
const inputClass = selectClass + " placeholder:text-ink-subtle";

export default function CatalogFilters({
  value,
  total,
  persisted,
  videoFilter,
  onChange,
  onClear,
  onClearVideo,
}: Readonly<Props>) {
  const t = useTranslations("publicCatalog.filters");
  const sourceTypeLabels = useSourceTypeLabels();
  const typeLabels = useTypeLabels();
  const statusLabels = useStatusLabels();
  const hasFilters =
    value.q || value.category || value.color || value.type || value.status || value.sourceType || videoFilter;

  return (
    <div className="rounded-2xl border border-line bg-white/[0.02] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <div className="relative flex-1 md:min-w-[220px]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle">
            🔍
          </span>
          <input
            value={value.q}
            onChange={(e) => onChange({ q: e.target.value })}
            placeholder={t("searchPlaceholder")}
            className={inputClass + " w-full pl-9"}
          />
        </div>

        <select
          value={value.type}
          onChange={(e) => onChange({ type: e.target.value })}
          className={selectClass}
          aria-label={t("typeAriaLabel")}
        >
          <option value="">{t("allTypes")}</option>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {typeLabels[ty]}
            </option>
          ))}
        </select>

        <select
          value={value.status}
          onChange={(e) => onChange({ status: e.target.value })}
          className={selectClass}
          aria-label={t("statusAriaLabel")}
        >
          <option value="">{t("anyStatus")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s]}
            </option>
          ))}
        </select>

        <select
          value={value.sourceType}
          onChange={(e) => onChange({ sourceType: e.target.value })}
          className={selectClass}
          aria-label={t("originAriaLabel")}
        >
          <option value="">{t("anyOrigin")}</option>
          {SOURCE_TYPE_VALUES.map((v) => (
            <option key={v} value={v}>
              {sourceTypeLabels[v]}
            </option>
          ))}
        </select>

        <input
          value={value.category}
          onChange={(e) => onChange({ category: e.target.value })}
          placeholder={t("categoryPlaceholder")}
          className={inputClass + " md:w-36"}
        />
        <input
          value={value.color}
          onChange={(e) => onChange({ color: e.target.value })}
          placeholder={t("colorPlaceholder")}
          className={inputClass + " md:w-32"}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        <span>{t("itemCount", { count: total })}</span>
        {!persisted && (
          <span
            className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-warning"
            title={t("localSaveTitle")}
          >
            {t("localSaveBadge")}
          </span>
        )}
        {videoFilter && (
          <button
            onClick={onClearVideo}
            className="rounded-full border border-brand-bright/30 bg-brand/15 px-2 py-0.5 text-brand-bright transition hover:bg-brand/25"
          >
            {t("videoBadge", { id: videoFilter.slice(0, 8) })} ✕
          </button>
        )}
        {hasFilters && (
          <button
            onClick={onClear}
            className="ml-auto text-ink-muted transition hover:text-ink"
          >
            {t("clearFilters")}
          </button>
        )}
      </div>
    </div>
  );
}
