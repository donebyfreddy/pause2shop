import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import CatalogClient from "@/components/catalog/CatalogClient";
import { PublicHeader } from "@/components/shell/PublicHeader";
import { PublicFooter } from "@/components/shell/PublicFooter";
import { absoluteUrl } from "@/lib/seo";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

const CANONICAL = absoluteUrl("/catalog");

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicCatalog.meta");
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

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp.videoId;
  const videoId = typeof raw === "string" ? raw : null;

  return (
    <>
      <PublicHeader />
      <div id="contenido" className="flex-1">
        <CatalogClient initialVideoId={videoId} appName={APP_NAME} />
      </div>
      <PublicFooter appName={APP_NAME} />
    </>
  );
}
