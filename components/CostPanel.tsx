"use client";

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

function usd(n: number) {
  if (n === 0) return "$0.0000";
  if (n < 0.001) return `$${(n * 1000).toFixed(3)}m`;
  return `$${n.toFixed(4)}`;
}

export default function CostPanel({ costs, itemsDetected }: Props) {
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
          Consumo y coste de IA
        </h3>
        {isDemo && (
          <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
            modo demo
          </span>
        )}
        {!isDemo && costs && (
          <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
            real
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Coste total" value={usd(data.totalCostUsd)} highlight />
        <Stat label="Llamadas API" value={String(totalCalls)} />
        <Stat label="Cache hits" value={String(data.cacheHits)} accent="emerald" />
        <Stat label="Items detectados" value={String(itemsDetected)} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <SubStat
          label="OpenAI Vision"
          calls={data.openaiVisionCalls}
          cost={data.openaiVisionCostUsd}
        />
        <SubStat
          label="Sugerencias IA"
          calls={data.openaiProductCalls}
          cost={data.openaiProductCostUsd}
        />
        <SubStat
          label="Reverse search (Lens)"
          calls={data.lensSearchCalls ?? 0}
          cost={data.lensSearchCostUsd ?? 0}
        />
        <SubStat
          label="Shopping"
          calls={data.shoppingSearchCalls ?? 0}
          cost={data.shoppingSearchCostUsd ?? 0}
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
            <span className="text-warning">fallbacks: {data.fallbacksUsed}</span>
          )}
        </div>
      )}

      {data.mockCalls > 0 && (
        <p className="mt-2 text-[10px] text-ink-faint">
          {data.mockCalls} llamada{data.mockCalls === 1 ? "" : "s"} en modo demo (sin coste)
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
  cost: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] px-3 py-2">
      <div>
        <p className="text-[10px] text-ink-subtle">{label}</p>
        <p className="text-xs font-medium text-ink-muted">{calls} llamadas</p>
      </div>
      <p className="text-xs font-bold tabular-nums text-ink">{usd(cost)}</p>
    </div>
  );
}
