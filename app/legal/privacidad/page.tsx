import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { absoluteUrl } from "@/lib/seo";

/**
 * Política de privacidad. Las secciones se resuelven aquí con claves literales
 * para que `next-intl` pueda verificarlas en tiempo de compilación (ver la nota
 * en `LegalDocument`).
 */

const CANONICAL = absoluteUrl("/legal/privacidad");

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy");
  return {
    title: t("heading"),
    description: t("intro"),
    alternates: { canonical: CANONICAL },
    openGraph: { title: t("heading"), description: t("intro"), url: CANONICAL },
  };
}

export default async function PrivacyPage() {
  const t = await getTranslations("legal.privacy");

  return (
    <LegalDocument
      heading={t("heading")}
      intro={t("intro")}
      sections={[
        {
          title: t("sections.whatWeProcess.title"),
          body: t("sections.whatWeProcess.body"),
        },
        {
          title: t("sections.noAccounts.title"),
          body: t("sections.noAccounts.body"),
        },
        { title: t("sections.content.title"), body: t("sections.content.body") },
        { title: t("sections.providers.title"), body: t("sections.providers.body") },
        { title: t("sections.retention.title"), body: t("sections.retention.body") },
        { title: t("sections.security.title"), body: t("sections.security.body") },
      ]}
    />
  );
}
