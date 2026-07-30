import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ConnectorsView } from "@/components/admin/ConnectorsView";

export const metadata: Metadata = { title: "Conectores" };

export default function AdminConnectorsPage() {
  return (
    <AdminShell
      title="Conectores de catálogo"
      description="Registro de fuentes de moda con su madurez de implementación y su estado operativo real"
    >
      <ConnectorsView />
    </AdminShell>
  );
}
