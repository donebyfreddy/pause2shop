"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import {
  ACCENT_CLASSES,
  HERO_DEMO_MATCHES,
  HERO_DEMO_THRESHOLD,
  heroProductById,
  type HeroDemoMatch,
  type HeroDemoProductId,
} from "@/lib/landing/heroDemo";
import { ProductMatchCard } from "./ProductMatchCard";

/**
 * Panel de coincidencias del catálogo.
 *
 * `aria-live="polite"`: el panel cambia solo con la secuencia, y sin esto quien
 * usa lector de pantalla no se entera de que ha aparecido una coincidencia a
 * menos que vaya a buscarla.
 *
 * El pie con el umbral no es decorativo: es lo que explica por qué la tercera
 * tarjeta está apagada. Sin ese número a la vista, "no se publica" parece un
 * fallo del sistema en lugar de una decisión suya.
 */
export function ProductMatchPanel({
  resolved,
  activeId,
  searchingId,
  onSelect,
}: {
  /** Productos cuya coincidencia ya se ha resuelto en el guion. */
  readonly resolved: readonly HeroDemoProductId[];
  readonly activeId: HeroDemoProductId | null;
  /** Producto en fase "buscando", para el estado intermedio de su tarjeta. */
  readonly searchingId: HeroDemoProductId | null;
  readonly onSelect: (id: HeroDemoProductId) => void;
}) {
  const t = useTranslations("landing.heroDemo");

  const visible = HERO_DEMO_MATCHES.filter(
    (m) => resolved.includes(m.productId) || searchingId === m.productId
  );
  // En móvil se pinta UNA tarjeta: la activa, o la última que haya entrado.
  const shown =
    visible.find((m) => m.productId === activeId) ?? visible[visible.length - 1];

  return (
    <div className="flex min-w-0 flex-col gap-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
          {t("matchesTitle")}
        </p>
        <span className="shrink-0 font-mono text-[10px] text-ink-faint">
          {visible.length}/{HERO_DEMO_MATCHES.length}
        </span>
      </div>

      {/* MÓVIL: selector horizontal + la tarjeta activa debajo.
          Apilar las tres tarjetas en vertical funcionaba, pero alargaba el
          panel lo bastante para empujar la escena —que es lo que tiene que
          dominar el hero— fuera de la primera pantalla. */}
      <div
        data-testid="hero-matches-mobile"
        className="lg:hidden"
        aria-live="polite"
        aria-atomic="false"
      >
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[11px] text-ink-faint">
            {t("detecting")}
          </p>
        ) : (
          <>
            <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
              {visible.map((match) => (
                <li key={match.productId} className="contents">
                  <ProductChip
                    match={match}
                    active={activeId === match.productId}
                    onSelect={() => onSelect(match.productId)}
                  />
                </li>
              ))}
            </ul>
            {shown && (
              <ProductMatchCard
                match={shown}
                active
                searching={searchingId === shown.productId}
                onSelect={() => onSelect(shown.productId)}
              />
            )}
          </>
        )}
      </div>

      {/* ESCRITORIO: la lista completa, que aquí sí cabe. */}
      <div
        data-testid="hero-matches-desktop"
        className="hidden flex-col gap-1.5 lg:flex"
        aria-live="polite"
        aria-atomic="false"
      >
        {visible.map((match) => (
          <ProductMatchCard
            key={match.productId}
            match={match}
            active={activeId === match.productId}
            searching={searchingId === match.productId}
            onSelect={() => onSelect(match.productId)}
          />
        ))}

        {/* Hueco reservado mientras la secuencia aún no ha resuelto nada: sin
            él, el panel crece de golpe y empuja el layout del hero. */}
        {visible.length === 0 && (
          <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[11px] text-ink-faint">
            {t("detecting")}
          </p>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
        <span className="truncate text-[10px] text-ink-subtle">
          {t("thresholdLabel")}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-ink">
          {t("thresholdValue", { value: HERO_DEMO_THRESHOLD })}
        </span>
      </div>
    </div>
  );
}

/**
 * Pastilla del selector móvil: miniatura, nombre corto y score.
 *
 * Lleva el punto de color del acento además del borde: en una fila estrecha el
 * borde activo se distingue mal, y el estado no puede depender solo del color.
 */
function ProductChip({
  match,
  active,
  onSelect,
}: {
  readonly match: HeroDemoMatch;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  const t = useTranslations("landing.heroDemo");
  const product = heroProductById(match.productId);
  const tone = ACCENT_CLASSES[product.accent];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        active
          ? cn("border-transparent bg-white/[0.07] ring-1", tone.ring)
          : "border-line bg-white/[0.02]"
      )}
    >
      <Image
        src={product.src}
        alt=""
        width={product.intrinsic.width}
        height={product.intrinsic.height}
        loading="lazy"
        sizes="24px"
        className="size-6 shrink-0 object-contain"
      />
      <span className="max-w-[92px] truncate text-[10px] font-medium text-ink">
        {t(`products.${match.productId}.label`)}
      </span>
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full transition-opacity",
          tone.dot,
          active ? "opacity-100" : "opacity-40"
        )}
      />
    </button>
  );
}
