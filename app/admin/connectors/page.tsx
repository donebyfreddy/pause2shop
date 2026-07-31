import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConnectorsView } from "@/components/admin/ConnectorsView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.connectors");
  return { title: t("title") };
}

export default async function AdminConnectorsPage() {
  const t = await getTranslations("admin.connectors");
  return (
    <AdminShell title={t("title")} description={t("description")}>
      <ConnectorsView />
    </AdminShell>
  );
}
