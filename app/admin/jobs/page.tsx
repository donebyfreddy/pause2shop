import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { JobsView } from "@/components/admin/JobsView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.jobs");
  return { title: t("title") };
}

export default async function AdminJobsPage() {
  const t = await getTranslations("admin.jobs");
  return (
    <AdminShell title={t("title")} description={t("description")}>
      <JobsView />
    </AdminShell>
  );
}
