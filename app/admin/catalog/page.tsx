import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { CatalogView } from "@/components/admin/CatalogView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.catalog");
  return { title: t("title") };
}

export default async function AdminCatalogPage() {
  const t = await getTranslations("admin.catalog");
  return (
    <AdminShell title={t("title")} description={t("description")}>
      <CatalogView />
    </AdminShell>
  );
}
