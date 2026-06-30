"use client";

import type { DetectedItem, ProductLink } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  item: DetectedItem;
  rank: number;
  onLinkClick: (item: DetectedItem, link: ProductLink) => void;
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 75
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : pct >= 55
        ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
        : "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}>
      {pct}% confianza
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
      {children}
    </span>
  );
}

export default function ProductCard({ item, rank, onLinkClick }: Props) {
  const marketplace = item.productLinks?.filter((l) => l.type !== "verified_store") ?? [];
  const verified = item.productLinks?.filter((l) => l.type === "verified_store") ?? [];

  return (
    <article className="group rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-white/20 hover:bg-white/[0.06]">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30 text-[11px] font-bold text-indigo-200">
            {rank}
          </span>
          <h3 className="text-sm font-semibold leading-tight text-zinc-100">
            {item.name}
          </h3>
        </div>
        <ConfidenceBadge value={item.confidence} />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip>{item.category}</Chip>
        {item.style && <Chip>{item.style}</Chip>}
        {item.color && <Chip>{item.color}</Chip>}
        {item.visible_brand && (
          <span className="rounded-full border border-indigo-400/30 bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-200">
            marca: {item.visible_brand}
          </span>
        )}
      </div>

      {item.description && (
        <p className="mb-2 text-xs leading-relaxed text-zinc-400">{item.description}</p>
      )}

      {item.why_recommended && (
        <p className="mb-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs italic leading-relaxed text-zinc-300">
          💡 {item.why_recommended}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {marketplace.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onLinkClick(item, link)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:brightness-110"
          >
            {link.label} ↗
          </a>
        ))}
      </div>

      {verified.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer select-none text-zinc-400 transition hover:text-zinc-200">
            Ver tiendas verificadas ({verified.length})
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {verified.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onLinkClick(item, link)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-200 transition hover:border-white/25 hover:bg-white/10"
              >
                {link.provider}
                {link.trustLevel === "high" && (
                  <span className="text-emerald-400" title="Tienda verificada">
                    ✓
                  </span>
                )}
              </a>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
