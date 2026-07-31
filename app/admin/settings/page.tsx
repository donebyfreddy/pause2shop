import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { SettingsView } from "@/components/admin/SettingsView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.settings");
  return { title: t("title") };
}

export default async function AdminSettingsPage() {
  const t = await getTranslations("admin.settings");
  return (
    <AdminShell title={t("title")} description={t("description")}>
      <SettingsView />
    </AdminShell>
  );
}
