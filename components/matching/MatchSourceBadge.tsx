"use client";

import { useTranslations } from "next-intl";
import { Database, Globe } from "lucide-react";
import type { MatchType, ProductCandidate } from "@/lib/matching/types";
import { cn } from "@/lib/utils";

/**
 * Badges de PROCEDENCIA y de FUERZA de la coincidencia.
 *
 * La procedencia no es decoración: un producto del catálogo propio está
 * indexado y verificado, uno de Internet viene de un motor de terceros y hay
 * que comprobarlo antes de publicarlo. Mezclarlos visualmente es exactamente
 * el problema que esta UI resuelve, así que el badge va SIEMPRE con el
 * candidato — nunca hay una tarjeta sin fuente visible.
 *
 * Código de color, deliberado y consistente en toda la app:
 *   catálogo → violeta (marca) / verde (éxito)
 *   Internet → cian / azul
 * Ningún estado usa rojo: "no hay coincidencia" o "pendiente de revisar" no es
 * un error, y pintarlo como tal hace que el usuario crea que algo se ha roto.
 */

const SOURCE_TONE = {
  catalog: "border-brand/40 bg-brand/12 text-brand-bright",
  external: "border-accent/40 bg-accent/10 text-accent",
} as const;

export function MatchSourceBadge({
  source,
  className,
}: {
  readonly source: ProductCandidate["source"];
  readonly className?: string;
}) {
  const t = useTranslations("studio.matching.badge");
  const isCatalog = source === "catalog";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        SOURCE_TONE[source],
        className
      )}
    >
      {isCatalog ? (
        <Database className="size-2.5 shrink-0" aria-hidden />
      ) : (
        <Globe className="size-2.5 shrink-0" aria-hidden />
      )}
      {isCatalog ? t("catalog") : t("external")}
    </span>
  );
}

const MATCH_TYPE_KEY = {
  exact: "exact",
  probable: "probable",
  similar: "similar",
} as const satisfies Record<MatchType, string>;

/**
 * Fuerza de la afirmación. `similar` usa un tono neutro a propósito: es un
 * resultado válido ("parecido"), no un fallo.
 */
export function MatchTypeBadge({
  matchType,
  source,
}: {
  readonly matchType: MatchType;
  readonly source: ProductCandidate["source"];
}) {
  const t = useTranslations("studio.matching.matchType");
  let tone: string;
  if (matchType === "similar") {
    tone = "border-line-strong bg-white/[0.04] text-ink-muted";
  } else if (source === "catalog") {
    tone = "border-success/40 bg-success/15 text-success";
  } else {
    tone = "border-info/40 bg-info/12 text-info";
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        tone
      )}
    >
      {t(MATCH_TYPE_KEY[matchType])}
    </span>
  );
}

/** Score de MATCHING en porcentaje (≠ confianza de detección). */
export function MatchScoreBadge({
  score,
  source,
}: {
  readonly score: number;
  readonly source: ProductCandidate["source"];
}) {
  const pct = Math.round(score * 100);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums",
        source === "catalog"
          ? "border-brand/30 bg-brand/10 text-brand-bright"
          : "border-accent/30 bg-accent/10 text-accent"
      )}
    >
      {pct}%
    </span>
  );
}
