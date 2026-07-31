import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { absoluteUrl } from "@/lib/seo";

/**
 * Términos de uso. Igual que en privacidad: las claves se escriben literales
 * para que el compilador las valide contra el catálogo de mensajes.
 */

const CANONICAL = absoluteUrl("/legal/terminos");

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.terms");
  return {
    title: t("heading"),
    description: t("intro"),
    alternates: { canonical: CANONICAL },
    openGraph: { title: t("heading"), description: t("intro"), url: CANONICAL },
  };
}

export default async function TermsPage() {
  const t = await getTranslations("legal.terms");

  return (
    <LegalDocument
      heading={t("heading")}
      intro={t("intro")}
      sections={[
        { title: t("sections.scope.title"), body: t("sections.scope.body") },
        { title: t("sections.pilotNature.title"), body: t("sections.pilotNature.body") },
        {
          title: t("sections.acceptableUse.title"),
          body: t("sections.acceptableUse.body"),
        },
        { title: t("sections.content.title"), body: t("sections.content.body") },
        { title: t("sections.availability.title"), body: t("sections.availability.body") },
        { title: t("sections.changes.title"), body: t("sections.changes.body") },
      ]}
    />
  );
}
