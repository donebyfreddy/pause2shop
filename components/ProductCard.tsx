"use client";

import type { DetectedItem, ProductLink } from "@/lib/types";
import type { VisualMatch } from "@/lib/visualSearch/types";
import { cn } from "@/lib/utils";
import { IS_PRESENTATION } from "@/lib/presentation";
import ItemCrop from "./ItemCrop";

type Props = {
  item: DetectedItem;
  rank: number;
  onLinkClick: (item: DetectedItem, link: ProductLink) => void;
  /** Frame del que salió el item, para mostrar el recorte del producto. */
  frameUrl?: string | null;
};

/** Confianza de DETECCIÓN: el objeto y sus atributos, NO el producto web. */
function DetectionBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 75
      ? "bg-success/15 text-success border-success/30"
      : pct >= 55
        ? "bg-warning/15 text-warning border-warning/30"
        : "bg-ink-subtle/15 text-ink-muted border-ink-subtle/30";
  return (
    <span
      title="Confianza en que el objeto y sus atributos han sido identificados correctamente en el vídeo."
      className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", tone)}
    >
      {pct}% detección
    </span>
  );
}

/** Confianza de MATCHING: que el resultado web sea el mismo producto. */
function MatchConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span
      title="Confianza en que el resultado web corresponde al mismo producto."
      className="rounded-full border border-accent/30 bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent"
    >
      {pct}% coincidencia
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-white/5 px-2 py-0.5 text-[11px] text-ink-muted">
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
    ? "border-success/30 bg-success/10"
    : "border-info/20 bg-info/[0.07]";
  const badgeTone = match.exact_match_found
    ? "bg-success/20 text-success border-success/40"
    : "bg-info/15 text-info border-info/30";
  const image = match.product_images[0];

  return (
    <div className={cn("mb-3 rounded-xl border p-3", tone)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", badgeTone)}>
            {match.exact_match_found ? "🎯 " : "≈ "}
            {MATCH_LABEL[match.match_type]}
          </span>
          <MatchConfidenceBadge value={match.match_confidence} />
        </span>
        {match.brand && (
          <span className="text-[11px] font-semibold text-ink">{match.brand}</span>
        )}
      </div>

      <div className="flex gap-3">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- miniaturas externas de motores de shopping, dominios no enumerables
          <img
            src={image}
            alt={match.product_name}
            className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover"
            loading="lazy"
          />
        )}
        <div className="min-w-0">
          <p className="mb-1.5 line-clamp-2 text-xs font-semibold leading-snug text-ink">
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
                    ? "bg-gradient-to-br from-success to-accent text-white shadow-md shadow-success/20 hover:brightness-110"
                    : "border border-line bg-white/5 text-ink hover:border-line-strong hover:bg-white/10"
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

      {/* Evidencia del match: por qué afirmamos que coincide. */}
      {match.evidence.length > 0 && (
        <div className="mt-2 rounded-lg border border-line bg-black/20 px-2.5 py-1.5">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            Coincide en
          </p>
          <ul className="space-y-0.5 text-[11px] text-ink-muted">
            {match.evidence.slice(0, 5).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Panel técnico plegable: qué fuentes respaldan el match */}
      <details className="mt-2 text-[10px] text-ink-subtle">
        <summary className="cursor-pointer select-none transition hover:text-ink-muted">
          Fuentes de búsqueda
        </summary>
        {!IS_PRESENTATION && (
          <p className="mt-1">
            Score interno: {match.best_match_score} pts · motor: {match.best_match_source}
          </p>
        )}
        <SourcesBreakdown match={match} />
      </details>
    </div>
  );
}

/**
 * Panel de debug del matching por item (proveedor, fallback, cache,
 * latencia). Oculto en modo presentación; sin secretos.
 */
function MatchingDebugPanel({ debug }: { debug: DetectedItem["matching_debug"] }) {
  if (!debug || IS_PRESENTATION) return null;
  return (
    <details className="mt-2 text-[10px] text-ink-faint">
      <summary className="cursor-pointer select-none transition hover:text-ink-muted">
        Debug del matching
      </summary>
      <div className="mt-1 space-y-0.5">
        <p>Reverse image search: sí (crop enviado, búsqueda visual pura primero)</p>
        <p>Proveedor: {debug.providerUsed ?? "—"}</p>
        <p>Fallback usado: {debug.fallbackUsed ? "sí" : "no"}</p>
        <p>Cache hit: {debug.cached ? "sí" : "no"}</p>
        {debug.totalMs != null && <p>Latencia: {debug.totalMs} ms</p>}
        {debug.detail && <p>Detalle: {debug.detail}</p>}
        <p>DataForSEO: solo enriquecimiento de precio/tiendas (no identidad)</p>
      </div>
    </details>
  );
}

/** Desglose de proveedores que aportaron candidatos (sin datos sensibles). */
function SourcesBreakdown({ match }: { match: VisualMatch }) {
  const bySource = new Map<string, number>();
  for (const c of match.ranked_candidates) {
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
  }
  const LABEL: Record<string, string> = {
    searchapi_google_lens: "Google Lens",
    serpapi_google_lens: "Google Lens (fallback)",
    serpapi_google_shopping: "Google Shopping",
    dataforseo_google_shopping: "Google Shopping (DataForSEO)",
  };
  // "Confirmado por N fuentes" solo si el MISMO dominio del mejor candidato
  // aparece respaldado por más de un proveedor — sin falsear consenso.
  const best = match.ranked_candidates[0];
  const confirmingSources = best?.domain
    ? new Set(
        match.ranked_candidates
          .filter((c) => c.domain === best.domain)
          .map((c) => c.source)
      ).size
    : 0;
  return (
    <div className="mt-1.5 space-y-0.5">
      {[...bySource.entries()].map(([source, count]) => (
        <p key={source}>
          {LABEL[source] ?? source}: {count} candidato{count === 1 ? "" : "s"}
        </p>
      ))}
      {confirmingSources >= 2 && (
        <p className="text-success">✓ Confirmado por {confirmingSources} fuentes</p>
      )}
    </div>
  );
}

/**
 * Estado progresivo del matching por objeto (Fase 11): la card aparece con la
 * detección y este bloque se actualiza cuando la cola de matching resuelve.
 */
function MatchingStatusLine({ status }: { status?: DetectedItem["matchingStatus"] }) {
  if (!status || status === "matched" || status === "similar_only") return null;
  if (status === "searching" || status === "pending") {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-info/15 bg-info/[0.06] px-3 py-2 text-[11px] text-info">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
        {status === "pending"
          ? "Esperando un encuadre mejor…"
          : "Buscando por imagen (Google Lens)…"}
      </div>
    );
  }
  const MSG: Record<string, string> = {
    no_match:
      "Sin coincidencia exacta — abajo se muestran los productos visualmente más parecidos.",
    budget_exhausted: "Sin búsqueda externa (límite de consumo alcanzado).",
    provider_error: "Búsqueda visual no disponible ahora mismo.",
  };
  return (
    <p className="mb-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-[11px] text-ink-subtle">
      {MSG[status] ?? status}
    </p>
  );
}

/** Evidencia que justifica la marca mostrada (nunca se afirma sin evidencia). */
function brandEvidence(item: DetectedItem): string | null {
  if (!item.visible_brand) return null;
  if (item.visible_text) return `texto visible: “${item.visible_text}”`;
  if (item.logo_description) return `logo: ${item.logo_description}`;
  if (item.logo_visible) return "logo reconocible en el producto";
  return null;
}

export default function ProductCard({ item, rank, onLinkClick, frameUrl }: Props) {
  const evidence = brandEvidence(item);
  // Similares del reverse image search que no están ya en el match principal.
  const bestLink = item.visual_match?.ranked_candidates?.[0]?.link;
  const similars = (item.similar_candidates ?? []).filter((c) => c.link !== bestLink);

  return (
    <article className="group rounded-2xl border border-line bg-white/[0.04] p-4 transition hover:border-line-strong hover:bg-white/[0.06]">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {frameUrl && item.bounding_box ? (
            <ItemCrop
              frameUrl={frameUrl}
              box={item.bounding_box}
              alt={item.name}
              className="h-14 w-14"
            />
          ) : (
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand/30 to-magenta/30 text-[11px] font-bold text-brand-bright">
              {rank}
            </span>
          )}
          <h3 className="text-sm font-semibold leading-tight text-ink">
            {item.name}
          </h3>
        </div>
        <DetectionBadge value={item.confidence} />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip>{item.category}</Chip>
        {item.style && <Chip>{item.style}</Chip>}
        {item.color && <Chip>{item.color}</Chip>}
        {item.visible_brand && (
          <span
            title={evidence ? `Marca afirmada por evidencia — ${evidence}` : undefined}
            className="rounded-full border border-brand-bright/30 bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand-bright"
          >
            🏷 {item.visible_brand}
            {evidence && <span className="text-brand-bright/70"> ✓</span>}
          </span>
        )}
        {!item.visible_brand && item.brand_guess && (
          <span className="rounded-full border border-ink-muted/20 bg-ink-subtle/10 px-2 py-0.5 text-[11px] text-ink-muted">
            ≈ {item.brand_guess}?
          </span>
        )}
        {item.logo_visible && !item.visible_brand && !item.brand_guess && (
          <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
            logo visible
          </span>
        )}
        {item.seenCount != null && item.seenCount > 1 && (
          <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[11px] text-success">
            ×{item.seenCount} visto
          </span>
        )}
      </div>

      {item.visual_match ? (
        <VisualMatchBlock item={item} match={item.visual_match} onLinkClick={onLinkClick} />
      ) : (
        <MatchingStatusLine status={item.matchingStatus} />
      )}

      {item.description && (
        <p className="mb-2 text-xs leading-relaxed text-ink-muted">{item.description}</p>
      )}

      {item.visible_text && (
        <p className="mb-2 rounded-md border border-line bg-white/[0.03] px-2.5 py-1.5 font-mono text-[11px] text-ink-muted">
          Texto: &ldquo;{item.visible_text}&rdquo;
        </p>
      )}

      {item.logo_description && !item.visible_text && (
        <p className="mb-2 text-[11px] italic text-ink-subtle">
          Logo: {item.logo_description}
        </p>
      )}

      {item.why_recommended && (
        <p className="mb-3 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-xs italic leading-relaxed text-ink-muted">
          💡 {item.why_recommended}
        </p>
      )}

      {/* RESULTADO PRINCIPAL: los más similares del reverse image search.
          Sin enlaces manuales a Amazon ni "tiendas verificadas". */}
      {similars.length > 0 && (
        <div className="mt-1">
          <p className="mb-1.5 text-[11px] font-medium text-ink-subtle">
            {item.visual_match ? "También similares:" : "Productos visualmente similares:"}
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {similars.slice(0, 5).map((c) => (
              <a
                key={c.link}
                href={c.link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  onLinkClick(item, {
                    provider: c.store ?? "web",
                    type: "marketplace",
                    url: c.link,
                    label: c.title,
                    trustLevel: "medium",
                  })
                }
                title={c.title}
                className="w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-white/[0.03] transition hover:border-line-strong"
              >
                {c.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.imageUrl}
                    alt={c.title}
                    loading="lazy"
                    className="h-20 w-full bg-black/40 object-cover"
                  />
                )}
                <div className="px-1.5 py-1">
                  <p className="line-clamp-2 text-[10px] leading-tight text-ink-muted">
                    {c.title}
                  </p>
                  <p className="mt-0.5 text-[10px] text-ink-subtle">
                    {c.store ?? ""}
                    {c.price != null && (
                      <span className="ml-1 font-semibold text-success">
                        {c.price.toLocaleString("es-ES")} {c.currency === "USD" ? "$" : "€"}
                      </span>
                    )}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      <MatchingDebugPanel debug={item.matching_debug} />
    </article>
  );
}
