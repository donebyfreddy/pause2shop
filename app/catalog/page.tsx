import type { Metadata } from "next";
import CatalogClient from "@/components/catalog/CatalogClient";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

export const metadata: Metadata = {
  title: "Catálogo",
  description:
    "Catálogo interno de elementos detectados al analizar vídeos: prendas, accesorios y objetos comprables, con sus coincidencias de producto.",
};

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
      <SiteHeader />
      <div className="flex-1">
        <CatalogClient initialVideoId={videoId} appName={APP_NAME} />
      </div>
      <SiteFooter appName={APP_NAME} />
    </>
  );
}
