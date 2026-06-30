import type { Metadata } from "next";
import CatalogClient from "@/components/catalog/CatalogClient";

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

export const metadata: Metadata = {
  title: `Catálogo — ${APP_NAME}`,
  description:
    "Catálogo interno de elementos detectados al pausar tus vídeos: prendas, accesorios y objetos comprables, con recomendaciones de producto.",
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp.videoId;
  const videoId = typeof raw === "string" ? raw : null;

  return <CatalogClient initialVideoId={videoId} appName={APP_NAME} />;
}
