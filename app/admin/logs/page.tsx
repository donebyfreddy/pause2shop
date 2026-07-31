import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { LogsView } from "@/components/admin/LogsView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.logs");
  return { title: t("title") };
}

export default async function AdminLogsPage() {
  const t = await getTranslations("admin.logs");
  return (
    <AdminShell title={t("title")} description={t("description")}>
      <LogsView />
    </AdminShell>
  );
}
