import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ProcessedVideosView } from "@/components/admin/ProcessedVideosView";

export const metadata: Metadata = { title: "Vídeos procesados" };

export default function AdminVideosPage() {
  return (
    <AdminShell title="Vídeos procesados" description="Contenido VOD reutilizable, productos únicos y ahorro por caché.">
      <ProcessedVideosView />
    </AdminShell>
  );
}
