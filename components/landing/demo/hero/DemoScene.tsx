"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import {
  HERO_DEMO_PRODUCTS,
  deriveBox,
  type HeroDemoProductId,
} from "@/lib/landing/heroDemo";

/**
 * La escena: un bodegón editorial con los tres recortes reales.
 *
 * No es una fotografía única —no existe una foto que contenga justo estos tres
 * productos— sino una composición por capas: fondo, halos de luz, sombra
 * proyectada bajo cada pieza y el recorte encima. Lo que la salva de parecer
 * "tres imágenes flotando" es que comparten dirección de luz (halo arriba a la
 * izquierda, sombra abajo a la derecha) y que las escalas son coherentes entre
 * sí, como en un flat-lay de ecommerce.
 *
 * Cada producto se coloca con las MISMAS coordenadas de las que se deriva su
 * caja de detección (`deriveBox`), así que la caja no puede desalinearse del
 * producto en ningún ancho de pantalla.
 */

export function DemoScene({
  activeId,
  dimInactive,
}: {
  /** Producto enfocado, para atenuar el resto. */
  readonly activeId: HeroDemoProductId | null;
  /** Atenuar los no activos. Se apaga con `prefers-reduced-motion`. */
  readonly dimInactive: boolean;
}) {
  const t = useTranslations("landing.heroDemo");

  return (
    /*
     * `isolate` + `pointer-events-none` no son cosmética.
     *
     * Los recortes llevan z-index propio para ordenar la profundidad del
     * bodegón, y sin `isolate` esos valores compiten con la capa de detección
     * que va encima: la imagen de los zapatos quedaba por delante y se comía
     * los clics de la caja del bolso, que se solapa con ella. `isolate` encierra
     * ese orden dentro de la escena.
     *
     * Y la escena es DECORATIVA: toda la interacción vive en el overlay, así que
     * no debe capturar puntero ni con los halos, que sobresalen del recorte.
     */
    <div className="pointer-events-none absolute inset-0 isolate overflow-hidden">
      {/* Fondo: degradado frío con una fuente de luz arriba a la izquierda.
          Es lo que da a los tres recortes una atmósfera común. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(120%_90%_at_18%_0%,#20223a_0%,#111220_45%,#07070d_100%)]"
      />
      {/* Suelo: separa el plano horizontal del fondo y sostiene las sombras. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[38%] bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.035))]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_50%,transparent_35%,rgba(0,0,0,0.55)_100%)]"
      />

      {HERO_DEMO_PRODUCTS.map((product, index) => {
        const box = deriveBox(product);
        const active = activeId === product.id;
        const dim = dimInactive && activeId !== null && !active;

        return (
          <div
            key={product.id}
            className="absolute transition-[opacity,filter] duration-500"
            style={{
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
              opacity: dim ? 0.4 : 1,
              filter: dim ? "saturate(0.6)" : "none",
              // El orden de apilado sigue la profundidad de la composición: el
              // abrigo es el fondo del bodegón y los accesorios van delante.
              zIndex: index + 1,
            }}
          >
            {/* Foco de luz DETRÁS de la pieza.
                No es decoración: el abrigo es negro sobre un fondo casi negro y
                sin este halo su silueta desaparece — en la primera captura solo
                se distinguía por el recuadro de detección. Además da a los tres
                recortes una fuente de luz común, que es lo que impide que la
                composición se lea como tres imágenes pegadas. */}
            <span
              aria-hidden
              className="absolute inset-[-18%] rounded-[50%] blur-2xl"
              style={{
                background: `radial-gradient(closest-side, rgba(148,163,214,${product.halo}), rgba(148,163,214,${(product.halo * 0.35).toFixed(3)}) 55%, transparent 78%)`,
              }}
            />

            {/* Sombra proyectada: elipse difuminada bajo la pieza. Sin ella los
                recortes levitan y la escena delata el montaje. */}
            <span
              aria-hidden
              className="absolute inset-x-[10%] bottom-[-3%] h-[10%] rounded-[50%] blur-lg"
              style={{ background: `rgba(0,0,0,${product.shadow})` }}
            />

            <Image
              src={product.src}
              alt={t(`products.${product.id}.alt`)}
              width={product.intrinsic.width}
              height={product.intrinsic.height}
              /* El abrigo es el LCP del hero: se carga en cuanto se descubre.
                 En Next 16 `priority` está deprecado — la forma correcta de
                 decir esto es `loading="eager"` + `fetchPriority`
                 (node_modules/next/dist/docs/…/components/image.md). */
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
              sizes="(max-width: 640px) 42vw, (max-width: 1024px) 32vw, 24vw"
              className={cn(
                "size-full object-contain transition-[filter] duration-500",
                active ? "brightness-110" : ""
              )}
              // Realce sutil bajo el objeto activo, en el propio elemento para
              // no repintar toda la capa.
              style={{
                filter: active
                  ? "drop-shadow(0 12px 26px rgba(0,0,0,0.55))"
                  : "drop-shadow(0 10px 20px rgba(0,0,0,0.45))",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
