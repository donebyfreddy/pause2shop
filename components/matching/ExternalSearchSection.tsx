"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Globe, Search } from "lucide-react";
import type { DetectionMatchResult } from "@/lib/matching/types";
import { cn } from "@/lib/utils";
import ExternalCandidateCard from "./ExternalCandidateCard";
import { MatchingProgress } from "./MatchingProgress";

/**
 * Bloque de INTERNET: fuente secundaria, visualmente separada del catálogo.
 *
 * Cuando el estado es `not_requested` NO hay resultados y no se ha gastado
 * nada: solo el botón. Ese es el estado normal en `catalog_first` cuando el
 * catálogo ha resuelto, y es la razón por la que el modo ahorra dinero.
 *
 * Un resultado externo nunca se presenta como producto verificado del
 * catálogo: lleva su propio aviso de comprobación antes de publicar.
 */

type Props = {
  block: DetectionMatchResult["external"];
  /** Lanza la búsqueda externa para esta detección. */
  onSearch?: () => void;
  /** true mientras la búsqueda pedida a mano está en vuelo. */
  loading?: boolean;
  maxVisible?: number;
};

export default function ExternalSearchSection({
  block,
  onSearch,
  loading,
  maxVisible = 4,
}: Props) {
  const t = useTranslations("studio.matching.external");

  // `disabled` = no hay motor externo configurado. Se dice claramente en vez de
  // ofrecer un botón que no puede funcionar.
  if (block.status === "disabled") {
    return (
      <section className="rounded-xl border border-line bg-white/[0.02] p-3">
        <Header muted />
        <p className="text-[11px] text-ink-faint">{t("disabled")}</p>
      </section>
    );
  }

  const isLoading = loading || block.status === "loading";
  const selected = block.selected;
  const others = block.candidates
    .filter((c) => c.id !== selected?.id)
    .slice(0, maxVisible);

  return (
    <section
      className={cn(
        "rounded-xl border p-3",
        selected
          ? "border-accent/35 bg-accent/[0.06]"
          : "border-line-strong bg-white/[0.02]"
      )}
    >
      <Header active={Boolean(selected)} />

      {isLoading ? <MatchingProgress stage="external" /> : null}

      {!isLoading && block.status === "not_requested" ? (
        <>
          <p className="mb-2 text-[11px] text-ink-faint">{t("notRequested")}</p>
          {onSearch ? (
            <button
              type="button"
              onClick={onSearch}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/12 px-3 py-1.5",
                "text-[11px] font-semibold text-accent transition-colors hover:bg-accent/22"
              )}
            >
              <Search className="size-3" aria-hidden />
              {t("search")}
            </button>
          ) : null}
        </>
      ) : null}

      {!isLoading && selected ? (
        <>
          <ExternalCandidateCard
            candidate={selected}
            variant="primary"
            provider={block.provider}
          />
          {/* Aviso obligatorio: esto NO es catálogo verificado. */}
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/25 bg-warning/[0.07] p-2 text-[11px] text-warning">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{t("warning")}</span>
          </p>
        </>
      ) : null}

      {!isLoading &&
      (block.status === "unresolved" || block.status === "error") &&
      !selected ? (
        <p className="text-[11px] text-ink-muted">
          {block.status === "error"
            ? block.unresolvedReason ?? t("error")
            : block.unresolvedReason ?? t("unresolved")}
        </p>
      ) : null}

      {!isLoading && others.length > 0 ? (
        <div className="mt-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("otherResults")}
          </p>
          <ul className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
            {others.map((candidate) => (
              <li key={candidate.id} className="contents">
                <ExternalCandidateCard candidate={candidate} variant="alternative" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Header({ active, muted }: { active?: boolean; muted?: boolean }) {
  const t = useTranslations("studio.matching.external");
  return (
    <header className="mb-2 flex items-center gap-1.5">
      <h4
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide",
          active && !muted ? "text-accent" : "text-ink-muted"
        )}
      >
        <Globe className="size-3 shrink-0" aria-hidden />
        {t("title")}
      </h4>
    </header>
  );
}
