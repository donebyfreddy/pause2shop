import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { absoluteUrl } from "@/lib/seo";

/**
 * Metadatos de `/demo`.
 *
 * Van en un layout y no en la página porque `app/demo/page.tsx` es un client
 * component (arrastra el reproductor, la captura de frames y el sondeo del job):
 * un client component no puede exportar `generateMetadata`.
 *
 * Antes no había ninguno, así que la pestaña y las previsualizaciones de esta
 * ruta mostraban el título por defecto del layout raíz, idéntico al de la home.
 */

const CANONICAL = absoluteUrl("/demo");

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("demo.page");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: CANONICAL },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: CANONICAL,
    },
  };
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
