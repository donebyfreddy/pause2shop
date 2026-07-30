import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { JobsView } from "@/components/admin/JobsView";

export const metadata: Metadata = { title: "Jobs" };

export default function AdminJobsPage() {
  return (
    <AdminShell
      title="Jobs de ingesta"
      description="Progreso, errores y reintento desde checkpoint de cada job del servicio"
    >
      <JobsView />
    </AdminShell>
  );
}
