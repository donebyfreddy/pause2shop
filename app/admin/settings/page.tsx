import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { SettingsView } from "@/components/admin/SettingsView";

export const metadata: Metadata = { title: "Ajustes" };

export default function AdminSettingsPage() {
  return (
    <AdminShell
      title="Ajustes del servicio"
      description="Configuración efectiva de claves, almacenamiento, embeddings, matching y cumplimiento"
    >
      <SettingsView />
    </AdminShell>
  );
}
