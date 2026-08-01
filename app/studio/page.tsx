import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicHeader } from "@/components/shell/PublicHeader";
import { PublicFooter } from "@/components/shell/PublicFooter";
import StudioExperience from "@/components/studio/StudioExperience";
import { requestMetadataBase, socialCardUrl } from "@/lib/requestMetadata";

/**
 * Estudio a pantalla completa. Misma herramienta que la sección `#studio` de la
 * landing, con su propia URL para enlaces directos y demos.
 */

export async function generateMetadata(): Promise<Metadata> {
  const [t, metadataBase] = await Promise.all([
    getTranslations("studio.page"),
    requestMetadataBase(),
  ]);
  const canonical = new URL("/studio", metadataBase).toString();
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: canonical,
      images: [socialCardUrl(metadataBase)],
    },
  };
}

const appName = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

export default async function StudioPage() {
  const t = await getTranslations("studio.page");

  return (
    <>
      <PublicHeader />
      <main id="contenido" className="flex-1">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
          <header className="mb-6">
            <h1 className="display text-3xl text-ink sm:text-4xl">{t("title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              {t("description")}
            </p>
          </header>
          <StudioExperience variant="page" />
        </div>
      </main>
      <PublicFooter appName={appName} />
    </>
  );
}
