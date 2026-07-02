"use client";

type CostData = {
  openaiVisionCalls: number;
  openaiVisionCostUsd: number;
  openaiProductCalls: number;
  openaiProductCostUsd: number;
  mockCalls: number;
  cacheHits: number;
  totalCostUsd: number;
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
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          💰 Costes IA
        </h3>
        {isDemo && (
          <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            modo demo
          </span>
        )}
        {!isDemo && costs && (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
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
          label="Matching productos"
          calls={data.openaiProductCalls}
          cost={data.openaiProductCostUsd}
        />
      </div>

      {data.mockCalls > 0 && (
        <p className="mt-2 text-[10px] text-zinc-600">
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
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] text-zinc-500">{label}</p>
      <p
        className={
          "mt-0.5 text-sm font-bold tabular-nums " +
          (highlight
            ? "text-fuchsia-300"
            : accent === "emerald"
              ? "text-emerald-300"
              : "text-zinc-200")
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
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div>
        <p className="text-[10px] text-zinc-500">{label}</p>
        <p className="text-xs font-medium text-zinc-300">{calls} llamadas</p>
      </div>
      <p className="text-xs font-bold tabular-nums text-zinc-200">{usd(cost)}</p>
    </div>
  );
}
