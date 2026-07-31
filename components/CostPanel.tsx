"use client";

import { useFormatter, useTranslations } from "next-intl";

type CostData = {
  openaiVisionCalls: number;
  openaiVisionCostUsd: number;
  openaiProductCalls: number;
  openaiProductCostUsd: number;
  lensSearchCalls?: number;
  lensSearchCostUsd?: number;
  shoppingSearchCalls?: number;
  shoppingSearchCostUsd?: number;
  callsByProvider?: Record<string, number>;
  fallbacksUsed?: number;
  mockCalls: number;
  cacheHits: number;
  totalCostUsd: number;
};

const PROVIDER_LABEL: Record<string, string> = {
  searchapi_google_lens: "SearchAPI (Lens)",
  serpapi_google_lens: "SerpAPI (Lens)",
  serpapi_google_shopping: "SerpAPI (Shopping)",
  dataforseo_google_shopping: "DataForSEO",
};

type Props = {
  costs: CostData | null;
  itemsDetected: number;
};

export default function CostPanel({ costs, itemsDetected }: Props) {
  const t = useTranslations("studio.cost");
  const format = useFormatter();

  function usd(n: number) {
    if (n < 0.001 && n !== 0) {
      return `${format.number(n * 1000, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      })}m`;
    }
    return format.number(n, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
  }

  const data = costs ?? {
    openaiVisionCalls: 0,
    openaiVisionCostUsd: 0,
    openaiProductCalls: 0,
    openaiProductCostUsd: 0,
    mockCalls: 0,
    cacheHits: 0,
    totalCostUsd: 0,
  };

  const totalCalls = data.openaiVisionCalls + data.openaiProductCalls;
  const isDemo = data.openaiVisionCalls === 0 && data.mockCalls > 0;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
          {t("heading")}
        </h3>
        {isDemo && (
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
            {t("demoMode")}
          </span>
        )}
        {!isDemo && costs && (
          <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
            {t("real")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("totalCost")} value={usd(data.totalCostUsd)} highlight />
        <Stat label={t("apiCalls")} value={String(totalCalls)} />
        <Stat label={t("cacheHits")} value={String(data.cacheHits)} accent="emerald" />
        <Stat label={t("itemsDetected")} value={String(itemsDetected)} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <SubStat
          label={t("openaiVision")}
          calls={data.openaiVisionCalls}
          cost={usd(data.openaiVisionCostUsd)}
        />
        <SubStat
          label={t("aiSuggestions")}
          calls={data.openaiProductCalls}
          cost={usd(data.openaiProductCostUsd)}
        />
        <SubStat
          label={t("reverseSearch")}
          calls={data.lensSearchCalls ?? 0}
          cost={usd(data.lensSearchCostUsd ?? 0)}
        />
        <SubStat
          label={t("shopping")}
          calls={data.shoppingSearchCalls ?? 0}
          cost={usd(data.shoppingSearchCostUsd ?? 0)}
        />
      </div>

      {(Object.keys(data.callsByProvider ?? {}).length > 0 ||
        (data.fallbacksUsed ?? 0) > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-subtle">
          {Object.entries(data.callsByProvider ?? {}).map(([p, n]) => (
            <span key={p}>
              {PROVIDER_LABEL[p] ?? p}: <span className="text-ink-muted">{n}</span>
            </span>
          ))}
          {(data.fallbacksUsed ?? 0) > 0 && (
            <span className="text-warning">{t("fallbacksUsed", { count: data.fallbacksUsed ?? 0 })}</span>
          )}
        </div>
      )}

      {data.mockCalls > 0 && (
        <p className="mt-2 text-[10px] text-ink-faint">
          {t("mockCallsNote", { count: data.mockCalls })}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
  accent,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  accent?: "emerald";
}) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] text-ink-subtle">{label}</p>
      <p
        className={
          "mt-0.5 text-sm font-bold tabular-nums " +
          (highlight
            ? "text-accent"
            : accent === "emerald"
              ? "text-success"
              : "text-ink")
        }
      >
        {value}
      </p>
    </div>
  );
}

function SubStat({
  label,
  calls,
  cost,
}: {
  label: string;
  calls: number;
  /** Coste ya formateado (moneda) por el padre — ver `usd()` en CostPanel. */
  cost: string;
}) {
  const t = useTranslations("studio.cost");
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] px-3 py-2">
      <div>
        <p className="text-[10px] text-ink-subtle">{label}</p>
        <p className="text-xs font-medium text-ink-muted">{t("callsCount", { count: calls })}</p>
      </div>
      <p className="text-xs font-bold tabular-nums text-ink">{cost}</p>
    </div>
  );
}
