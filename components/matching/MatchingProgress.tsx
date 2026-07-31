"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * Skeleton de matching. Se muestra en el hueco EXACTO que ocupará el resultado
 * para que la tarjeta no salte de tamaño cuando llegue: el salto de layout es
 * lo que hace que el usuario pierda de vista el objeto que estaba mirando.
 */
export function MatchingProgress({
  stage,
  className,
}: {
  readonly stage: "catalog" | "external";
  readonly className?: string;
}) {
  const t = useTranslations("studio.matching.progress");
  const isCatalog = stage === "catalog";
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        isCatalog
          ? "border-brand/25 bg-brand/[0.06]"
          : "border-accent/25 bg-accent/[0.05]",
        className
      )}
      aria-busy="true"
      aria-live="polite"
    >
      <p
        className={cn(
          "mb-2 text-[11px] font-semibold",
          isCatalog ? "text-brand-bright" : "text-accent"
        )}
      >
        {t(isCatalog ? "catalog" : "external")}
      </p>
      <div className="flex gap-3">
        <div className="size-16 shrink-0 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="min-w-0 flex-1 space-y-2 py-1">
          <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.04]" />
        </div>
      </div>
    </div>
  );
}

export default MatchingProgress;
