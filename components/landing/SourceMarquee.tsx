"use client";

import { Reveal } from "@/components/ui";

/**
 * Cinta de fuentes del registro de conectores. Los nombres llegan del servicio
 * real (server component → prop), así que la cinta no puede presumir de fuentes
 * que no estén registradas.
 *
 * Importante: se muestran como NOMBRES DE FUENTE del roadmap de ingesta, no
 * como clientes ni partners — el pie de la sección lo dice explícitamente.
 */
export function SourceMarquee({
  labels,
  total,
  verified,
  partnerRequired,
}: {
  labels: string[];
  total: number;
  verified: number;
  partnerRequired: number;
}) {
  if (labels.length === 0) return null;
  // Duplicamos la lista para que el bucle de la animación sea continuo.
  const track = [...labels, ...labels];

  return (
    <section className="relative border-y border-line bg-canvas-raised py-12">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-ink-faint uppercase">
            Registro de fuentes de moda
          </p>
          <p className="font-mono text-[11px] text-ink-subtle">
            <span className="text-ink">{total}</span> fuentes ·{" "}
            <span className="text-success">{verified}</span> verificadas con fixtures ·{" "}
            <span className="text-warning">{partnerRequired}</span> requieren acuerdo
          </p>
        </Reveal>
      </div>

      <div
        className="relative mt-7 overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)",
        }}
      >
        <div className="animate-marquee flex w-max gap-3">
          {track.map((label, i) => (
            <span
              key={`${label}-${i}`}
              className="rounded-full border border-line bg-surface-2/60 px-4 py-2 text-[13px] whitespace-nowrap text-ink-muted"
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      <p className="mx-auto mt-7 max-w-3xl px-4 text-center text-[11px] leading-relaxed text-ink-faint">
        Listado del registro de conectores del servicio de catálogo. Aparecer aquí indica que la
        fuente está registrada con su estado real de implementación y cumplimiento —{" "}
        <span className="text-ink-subtle">no implica relación comercial ni permiso concedido</span>.
      </p>
    </section>
  );
}
