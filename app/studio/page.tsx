import type { Metadata } from "next";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";
import StudioExperience from "@/components/studio/StudioExperience";

/**
 * Estudio a pantalla completa. Misma herramienta que la sección `#studio` de la
 * landing, con su propia URL para enlaces directos y demos.
 */

export const metadata: Metadata = {
  title: "Estudio de análisis",
  description:
    "Analiza vídeo o imagen y obtén los productos detectados con sus coincidencias en catálogo.",
};

const appName = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

export default function StudioPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-6">
            <h1 className="display text-3xl text-ink sm:text-4xl">Estudio de análisis</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              Detecta productos en vídeo o imagen y encuéntralos en el catálogo. Configura qué
              categorías buscar y con qué intensidad antes de empezar.
            </p>
          </header>
          <StudioExperience variant="page" />
        </div>
      </main>
      <SiteFooter appName={appName} />
    </>
  );
}
