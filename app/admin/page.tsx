import { AdminShell } from "@/components/admin/AdminShell";
import { OverviewView } from "@/components/admin/OverviewView";

export default function AdminOverviewPage() {
  return (
    <AdminShell
      title="Resumen de operaciones"
      description="Estado del catálogo, conectores, cola de ingesta y actividad reciente"
    >
      <OverviewView />
    </AdminShell>
  );
}
