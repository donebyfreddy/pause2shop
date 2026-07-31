"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";

/**
 * Controles de reproducción de la demo.
 *
 * El botón de pausa detiene el TEMPORIZADOR, no solo la animación CSS: pausar
 * en apariencia mientras el guion sigue avanzando por debajo es peor que no
 * ofrecer pausa, porque al reanudar la escena ha saltado.
 *
 * `aria-label` explícito y no solo el texto interno: por debajo de `sm` la
 * etiqueta se oculta para que la barra quepa y el icono es `aria-hidden`, así
 * que sin él los botones se quedarían sin nombre accesible en móvil.
 */
export function DemoPlaybackControls({
  playing,
  onToggle,
  onRestart,
  className,
}: {
  readonly playing: boolean;
  readonly onToggle: () => void;
  readonly onRestart: () => void;
  readonly className?: string;
}) {
  const t = useTranslations("landing.heroDemo");

  const buttonClass = cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 py-1",
    "text-[10px] font-medium text-ink-muted transition-colors",
    "hover:border-line-strong hover:text-ink",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
  );

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        type="button"
        onClick={onRestart}
        aria-label={t("restart")}
        className={buttonClass}
      >
        <RotateCcw className="size-3" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onToggle}
        aria-pressed={playing}
        aria-label={playing ? t("pause") : t("play")}
        className={buttonClass}
      >
        {playing ? (
          <>
            <Pause className="size-3" aria-hidden />
            <span className="hidden sm:inline">{t("pause")}</span>
          </>
        ) : (
          <>
            <Play className="size-3" aria-hidden />
            <span className="hidden sm:inline">{t("play")}</span>
          </>
        )}
      </button>
    </div>
  );
}
