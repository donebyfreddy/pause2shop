import { getTranslations } from "next-intl/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { OverviewView } from "@/components/admin/OverviewView";

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin.overview");
  return (
    <AdminShell title={t("title")} description={t("description")}>
      <OverviewView />
    </AdminShell>
  );
}
