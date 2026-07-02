"use client";

import type { DetectedItem, ProductLink } from "@/lib/types";
import type { VisualMatch } from "@/lib/visualSearch/types";
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

const MATCH_LABEL: Record<VisualMatch["match_type"], string> = {
  exact: "Producto exacto",
  near_exact: "Casi exacto",
  similar: "Similar",
};

/**
 * Match del Visual Matching Engine: producto real encontrado por reverse
 * image search / shopping, con tiendas y precios reales.
 */
function VisualMatchBlock({
  item,
  match,
  onLinkClick,
}: {
  item: DetectedItem;
  match: VisualMatch;
  onLinkClick: Props["onLinkClick"];
}) {
  const tone = match.exact_match_found
    ? "border-emerald-400/30 bg-emerald-500/10"
    : "border-sky-400/20 bg-sky-500/[0.07]";
  const badgeTone = match.exact_match_found
    ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/40"
    : "bg-sky-500/15 text-sky-200 border-sky-400/30";
  const image = match.product_images[0];

  return (
    <div className={cn("mb-3 rounded-xl border p-3", tone)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", badgeTone)}>
          {match.exact_match_found ? "🎯 " : "≈ "}
          {MATCH_LABEL[match.match_type]} · {match.best_match_score} pts
        </span>
        {match.brand && (
          <span className="text-[11px] font-semibold text-zinc-200">{match.brand}</span>
        )}
      </div>

      <div className="flex gap-3">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- miniaturas externas de motores de shopping, dominios no enumerables
          <img
            src={image}
            alt={match.product_name}
            className="h-16 w-16 shrink-0 rounded-lg border border-white/10 object-cover"
            loading="lazy"
          />
        )}
        <div className="min-w-0">
          <p className="mb-1.5 line-clamp-2 text-xs font-semibold leading-snug text-zinc-100">
            {match.product_name}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {match.purchase_links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  onLinkClick(item, {
                    provider: link.store,
                    type: link.type === "exact" ? "marketplace" : "shopping_search",
                    url: link.url,
                    label: link.store,
                    trustLevel: "high",
                  })
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                  link.type === "exact"
                    ? "bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/20 hover:brightness-110"
                    : "border border-white/10 bg-white/5 text-zinc-200 hover:border-white/25 hover:bg-white/10"
                )}
              >
                {link.store}
                {link.price != null && (
                  <span className="font-normal opacity-90">
                    · {link.price.toLocaleString("es-ES")} {link.currency === "USD" ? "$" : "€"}
                  </span>
                )}
                {" ↗"}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
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
            🏷 {item.visible_brand}
          </span>
        )}
        {!item.visible_brand && item.brand_guess && (
          <span className="rounded-full border border-zinc-400/20 bg-zinc-500/10 px-2 py-0.5 text-[11px] text-zinc-400">
            ≈ {item.brand_guess}?
          </span>
        )}
        {item.logo_visible && !item.visible_brand && !item.brand_guess && (
          <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
            logo visible
          </span>
        )}
        {item.seenCount != null && item.seenCount > 1 && (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
            ×{item.seenCount} visto
          </span>
        )}
      </div>

      {item.visual_match && (
        <VisualMatchBlock item={item} match={item.visual_match} onLinkClick={onLinkClick} />
      )}

      {item.description && (
        <p className="mb-2 text-xs leading-relaxed text-zinc-400">{item.description}</p>
      )}

      {item.visible_text && (
        <p className="mb-2 rounded-md border border-white/5 bg-white/[0.03] px-2.5 py-1.5 font-mono text-[11px] text-zinc-300">
          Texto: &ldquo;{item.visible_text}&rdquo;
        </p>
      )}

      {item.logo_description && !item.visible_text && (
        <p className="mb-2 text-[11px] italic text-zinc-500">
          Logo: {item.logo_description}
        </p>
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
