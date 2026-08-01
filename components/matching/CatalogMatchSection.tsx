"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Database, PackageSearch } from "lucide-react";
import type { DetectionMatchResult, ProductCandidate } from "@/lib/matching/types";
import { cn } from "@/lib/utils";
import CatalogCandidateCard from "./CatalogCandidateCard";
import { MatchingProgress, type MatchingPhase } from "./MatchingProgress";

/**
 * Bloque del CATÁLOGO PROPIO: la fuente principal.
 *
 * Va primero y siempre, incluso cuando no resuelve — un "no hay coincidencia
 * fiable en tu catálogo" es información útil (dice qué indexar), y esconderlo
 * hacía que el usuario no supiera si el catálogo se había consultado.
 *
 * Las alternativas empiezan plegadas: la coincidencia principal es la respuesta,
 * y ocho tarjetas más al mismo nivel la diluyen.
 */

type Props = {
  block: DetectionMatchResult["catalog"];
  /** Cuántas alternativas se pintan (CATALOG_MATCH_MAX_VISIBLE). */
  maxVisible?: number;
  /** true mientras la consulta al catálogo está en vuelo. */
  loading?: boolean;
  phase?: MatchingPhase;
  startedAt?: number;
  onSelectCandidate?: (candidate: ProductCandidate) => void;
};

export default function CatalogMatchSection({
  block,
  maxVisible = 4,
  loading,
  phase,
  startedAt,
  onSelectCandidate,
}: Props) {
  const t = useTranslations("studio.matching.catalog");
  const [showAlternatives, setShowAlternatives] = useState(false);

  if (loading) {
    return <MatchingProgress stage="catalog" phase={phase} startedAt={startedAt} />;
  }
  if (block.status === "not_requested") return null;

  const selected = block.selected;
  // Alternativas = todo menos el seleccionado. Cuando no hay seleccionado, los
  // candidatos por debajo del umbral son lo único que hay que ofrecer.
  const alternatives = block.candidates
    .filter((c) => c.id !== selected?.id)
    .slice(0, maxVisible);

  return (
    <section
      className={cn(
        "rounded-xl border p-3",
        selected
          ? "border-brand/35 bg-brand/[0.08]"
          : "border-line-strong bg-white/[0.02]"
      )}
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4
          className={cn(
            "flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide",
            selected ? "text-brand-bright" : "text-ink-muted"
          )}
        >
          <Database className="size-3 shrink-0" aria-hidden />
          {selected ? t("title") : t("unresolvedTitle")}
        </h4>
        <span className="text-[10px] text-ink-faint tabular-nums">
          {t("threshold", { pct: Math.round(block.threshold * 100) })}
        </span>
      </header>

      {selected ? (
        <CatalogCandidateCard candidate={selected} variant="primary" />
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-ink-muted">
          <PackageSearch className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden />
          <span>
            {block.status === "empty"
              ? t("empty")
              : block.status === "error"
                ? block.unresolvedReason ?? t("error")
                : t("unresolved")}
          </span>
        </p>
      )}

      {alternatives.length > 0 ? (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowAlternatives((v) => !v)}
            aria-expanded={showAlternatives}
            className="text-[11px] font-semibold text-brand-bright underline-offset-2 hover:underline"
          >
            {showAlternatives
              ? t("hideAlternatives")
              : t("showAlternatives", { count: alternatives.length })}
          </button>

          {showAlternatives ? (
            <>
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {t("alternativesTitle")}
              </p>
              {/* Lista horizontal desplazable: las alternativas no deben
                  empujar hacia abajo la coincidencia principal ni el bloque
                  de Internet. */}
              <ul className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
                {alternatives.map((candidate) => (
                  <li key={candidate.id} className="contents">
                    <CatalogCandidateCard
                      candidate={candidate}
                      variant="alternative"
                      onSelect={onSelectCandidate}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
