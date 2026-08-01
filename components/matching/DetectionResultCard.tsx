"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { PackageSearch } from "lucide-react";
import type { DetectionMatchResult, ProductCandidate } from "@/lib/matching/types";
import type { DetectedItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import ItemCrop from "../ItemCrop";
import CatalogMatchSection from "./CatalogMatchSection";
import ExternalSearchSection from "./ExternalSearchSection";
import { MatchingProgress, type MatchingPhase } from "./MatchingProgress";

/**
 * Tarjeta de UNA detección: la unidad de la nueva UI de resultados.
 *
 * La jerarquía es deliberada y es el arreglo del problema de fondo:
 *
 *   1. la detección (qué objeto es, con qué confianza)
 *   2. la coincidencia principal del CATÁLOGO
 *   3. las alternativas del catálogo (plegadas)
 *   4. los resultados de INTERNET, separados
 *   5. los atributos detectados y la descripción de la IA, al final
 *
 * Antes el orden era casi el inverso: la descripción larga que genera la IA iba
 * arriba y el producto coincidente quedaba debajo o mezclado con resultados
 * externos. Eso hacía que un catálogo con el producto exacto pareciera no
 * tenerlo. La descripción sigue estando —es útil— pero como contexto, no como
 * respuesta.
 */

type Props = {
  item: DetectedItem;
  detection: DetectionMatchResult | null;
  /** Frame del que salió el objeto, para el recorte de la miniatura. */
  frameUrl?: string | null;
  /** true mientras el matching de este objeto está en vuelo. */
  loading?: boolean;
  /** true mientras una búsqueda externa pedida a mano está en vuelo. */
  externalLoading?: boolean;
  /**
   * Motivo por el que no hay resultado, cuando el matching ya terminó. Se
   * muestra en vez del skeleton para que un fallo no parezca una carga eterna.
   */
  failureDetail?: string | null;
  /**
   * Estado de la cola de matching. `undefined` significa que este objeto NUNCA
   * se encoló, que no es lo mismo que haber fallado.
   */
  matchingStatus?: DetectedItem["matchingStatus"];
  /** Etapa en curso del matching, para que el progreso no sea mudo. */
  matchingPhase?: MatchingPhase;
  /** Inicio del intento (`Date.now()`), para cronometrar la espera. */
  matchingStartedAt?: number;
  /** Resaltada por sincronización con el bounding box. */
  selected?: boolean;
  /** Clic en la tarjeta: resalta su bounding box en la imagen/vídeo. */
  onSelect?: (item: DetectedItem) => void;
  /** El usuario pide buscar también en Internet para esta detección. */
  onSearchExternal?: (detectionId: string) => void;
  onSelectCandidate?: (candidate: ProductCandidate) => void;
  maxVisibleCandidates?: number;
};

/** Confianza de DETECCIÓN: el objeto, no el producto. */
function DetectionConfidence({ value }: { readonly value: number }) {
  const t = useTranslations("studio.matching.detection");
  const pct = Math.round(value * 100);
  let tone: string;
  if (pct >= 75) tone = "border-success/30 bg-success/15 text-success";
  else if (pct >= 55) tone = "border-warning/30 bg-warning/15 text-warning";
  else tone = "border-ink-subtle/30 bg-ink-subtle/15 text-ink-muted";
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums",
        tone
      )}
    >
      {t("confidencePct", { pct })}
    </span>
  );
}

/**
 * Atributos visuales detectados, como bloque SECUNDARIO.
 * Es la información que antes ocupaba la cabecera de la tarjeta.
 */
function DetectedAttributes({ item }: { readonly item: DetectedItem }) {
  const t = useTranslations("studio.matching.detection");
  const parts = [
    item.color,
    item.pattern,
    item.type ?? item.subcategory,
    item.material_guess,
    item.visible_brand,
  ].filter((v): v is string => Boolean(v && v.trim()));
  if (parts.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {t("attributes")}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-muted">{parts.join(" · ")}</p>
    </div>
  );
}

/**
 * Estado sin bloque de catálogo: o no se buscó, o la búsqueda falló.
 *
 * Son cosas distintas y decirlas igual es mentir: "no se pudo consultar el
 * catálogo" en un objeto que ni siquiera se encoló hace pensar que el catálogo
 * está caído cuando no lo está.
 */
function NoCatalogBlock({
  reason,
  detail,
}: {
  readonly reason: "not_searched" | "failed";
  readonly detail?: string | null;
}) {
  const t = useTranslations("studio.matching.catalog");
  const text =
    reason === "not_searched" ? t("notSearched") : detail?.trim() || t("error");
  return (
    <section className="rounded-xl border border-line-strong bg-white/[0.02] p-3">
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        <PackageSearch className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden />
        <span>{text}</span>
      </p>
    </section>
  );
}

export default function DetectionResultCard({
  item,
  detection,
  frameUrl,
  loading,
  externalLoading,
  failureDetail,
  matchingStatus,
  matchingPhase,
  matchingStartedAt,
  selected,
  onSelect,
  onSearchExternal,
  onSelectCandidate,
  maxVisibleCandidates = 4,
}: Props) {
  const ref = useRef<HTMLElement | null>(null);

  // Al seleccionarse desde el bounding box, la tarjeta se trae a la vista: si
  // no, un clic en un recuadro del vídeo no parece hacer nada porque su tarjeta
  // está fuera de pantalla.
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selected]);

  const detectionId = detection?.detectionId;

  /**
   * Bloque de catálogo, o el estado honesto cuando no hay resultado. Son TRES
   * casos distintos y cada uno pide al usuario algo diferente:
   *
   *   buscando            → skeleton
   *   nunca se buscó      → no hay nada roto; este objeto no entró en la cola
   *                         (prioridad baja, o el tope de búsquedas del frame)
   *   se buscó y falló    → el motivo real (timeout, catálogo caído)
   *
   * Antes los tres caían en el mismo mensaje de fallo, así que un objeto que ni
   * se intentó buscar acusaba al catálogo de estar caído.
   */
  function renderCatalog() {
    if (detection) {
      return (
        <CatalogMatchSection
          block={detection.catalog}
          maxVisible={maxVisibleCandidates}
          loading={loading}
          phase={matchingPhase}
          startedAt={matchingStartedAt}
          onSelectCandidate={onSelectCandidate}
        />
      );
    }
    if (loading) return <MatchingProgress stage="catalog" />;
    // Sin estado de matching no hubo intento: el objeto nunca se encoló.
    if (!matchingStatus) return <NoCatalogBlock reason="not_searched" />;
    return <NoCatalogBlock reason="failed" detail={failureDetail} />;
  }

  return (
    <article
      ref={ref}
      onClick={onSelect ? () => onSelect(item) : undefined}
      className={cn(
        "rounded-2xl border bg-surface-2/60 p-3 transition-colors",
        selected
          ? "border-brand-bright/60 ring-1 ring-brand-bright/40"
          : "border-line hover:border-line-strong",
        onSelect ? "cursor-pointer" : ""
      )}
    >
      {/* 1. La detección. */}
      <header className="flex items-start gap-2.5">
        {frameUrl && item.bounding_box ? (
          <ItemCrop
            frameUrl={frameUrl}
            box={item.bounding_box}
            alt={item.name}
            className="size-12 shrink-0"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-ink">{item.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <DetectionConfidence value={item.confidence} />
            {item.category ? (
              <span className="rounded-full border border-line bg-white/5 px-2 py-0.5 text-[10px] text-ink-muted">
                {item.category}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* 2-3. Catálogo: coincidencia principal + alternativas. */}
      <div className="mt-3 space-y-2">
        {renderCatalog()}

        {/* 4. Internet, en su propio bloque. */}
        {detection ? (
          <ExternalSearchSection
            block={detection.external}
            maxVisible={maxVisibleCandidates}
            loading={externalLoading}
            onSearch={
              onSearchExternal && detectionId
                ? () => onSearchExternal(detectionId)
                : undefined
            }
          />
        ) : null}
      </div>

      {/* 5. Contexto visual, al final. */}
      <DetectedAttributes item={item} />
      {item.description ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          {item.description}
        </p>
      ) : null}
    </article>
  );
}
