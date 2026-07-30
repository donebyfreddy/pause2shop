import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { CatalogView } from "@/components/admin/CatalogView";

export const metadata: Metadata = { title: "Catálogo" };

export default function AdminCatalogPage() {
  return (
    <AdminShell
      title="Explorador de catálogo"
      description="Productos normalizados, estado de índices y búsqueda por texto o imagen"
    >
      <CatalogView />
    </AdminShell>
  );
}
