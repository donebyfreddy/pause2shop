import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { LogsView } from "@/components/admin/LogsView";

export const metadata: Metadata = { title: "Monitorización" };

export default function AdminLogsPage() {
  return (
    <AdminShell
      title="Monitorización"
      description="Eventos del servicio de catálogo con filtros por nivel, fuente y texto"
    >
      <LogsView />
    </AdminShell>
  );
}
