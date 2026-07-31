"use client";

import { motion } from "motion/react";
import { ArrowUpRight, Check, EyeOff, ShieldQuestion } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { DemoMatch } from "@/lib/landing/demoScene";
import { cn } from "@/lib/ui/cn";

/**
 * Tarjeta de coincidencia de catálogo.
 *
 * La usan el hero (estática) y la demo interactiva (seleccionable). Lo que la
 * hace útil comercialmente no es el precio: es que muestra el ESTADO editorial.
 * Una tarjeta `withheld` sin precio y sin enlace comunica "ante la duda no se
 * publica" mejor que cualquier párrafo.
 */

const STATUS_ICON = {
  published: Check,
  review: ShieldQuestion,
  withheld: EyeOff,
} as const;

const STATUS_CLASS = {
  published: "border-success/30 bg-success/10 text-success",
  review: "border-warning/30 bg-warning/10 text-warning",
  withheld: "border-line-strong bg-white/[0.03] text-ink-subtle",
} as const;

export function MatchCard({
  match,
  timecode,
  active = false,
  onSelect,
  compact = false,
}: {
  match: DemoMatch;
  timecode: string;
  active?: boolean;
  onSelect?: () => void;
  compact?: boolean;
}) {
  const t = useTranslations("landing.demo");
  const format = useFormatter();
  const interactive = typeof onSelect === "function";
  const StatusIcon = STATUS_ICON[match.status];

  const body = (
    <>
      <div className="flex items-start gap-3">
        {/* Miniatura: bloque de catálogo, no una foto de marca. El recorte real
            del producto vive en el estudio; aquí sería inventar un asset. */}
        <span
          className={cn(
            "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-linear-to-br from-surface-3 to-surface-2",
            compact ? "size-10" : "size-14"
          )}
          aria-hidden
        >
          <span className="absolute inset-0 grid-backdrop opacity-40" />
          <span
            className={cn(
              "relative rounded-full",
              match.status === "withheld" ? "bg-ink-faint/40" : "bg-brand-bright/50",
              compact ? "size-3" : "size-4"
            )}
          />
        </span>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate font-medium text-ink",
              compact ? "text-[12px]" : "text-[13px]"
            )}
          >
            {t(`matches.${match.key}.title`)}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-ink-subtle">
            {t(`categories.${match.category}`)} · {t("source")}
          </p>
          {/* El timestamp por tarjeta solo en la variante ancha. En compacta es
              redundante —la barra del panel ya dice la escena— y son 14 px por
              tarjeta, que es justo lo que decide si el panel del hero cabe en el
              primer viewport. */}
          {!compact && (
            <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
              {t("atTimecode", { timecode })}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p
            className={cn(
              "font-semibold text-ink tabular-nums",
              compact ? "text-[12px]" : "text-[13px]"
            )}
          >
            {match.priceEur === null
              ? t("noPrice")
              : format.number(match.priceEur, "eurPrice")}
          </p>
          <p className="mt-0.5 text-[10px] text-ink-subtle tabular-nums">
            {t("scoreShort", { score: Math.round(match.score * 100) })}
          </p>
        </div>
      </div>

      <div className={cn("flex items-center justify-between gap-2", compact ? "mt-1.5" : "mt-2.5")}>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
            STATUS_CLASS[match.status]
          )}
        >
          <StatusIcon className="size-2.5" aria-hidden />
          {t(`status.${match.status}`)}
        </span>

        {/* Solo lo publicado ofrece salida a producto: es la regla del umbral
            hecha interfaz, no una decoración. */}
        {match.status === "published" ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-medium transition-colors",
              active ? "text-accent" : "text-ink-muted"
            )}
          >
            {t("viewProduct")}
            <ArrowUpRight className="size-3" aria-hidden />
          </span>
        ) : (
          <span className="text-[10px] text-ink-faint">{t(`statusHint.${match.status}`)}</span>
        )}
      </div>
    </>
  );

  const shell = cn(
    "w-full rounded-xl border text-left transition-colors",
    compact ? "p-2.5" : "p-3",
    active
      ? "border-accent/60 bg-accent/[0.06]"
      : "border-line bg-surface-2/70 hover:border-line-strong"
  );

  if (!interactive) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      whileHover={{ x: 2 }}
      transition={{ type: "spring", stiffness: 340, damping: 26 }}
      className={cn(shell, "cursor-pointer")}
    >
      {body}
    </motion.button>
  );
}
