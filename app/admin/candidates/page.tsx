import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/AdminShell";
import { ExternalCandidatesView } from "@/components/admin/ExternalCandidatesView";

export const metadata: Metadata = { title: "Candidatos externos" };

export default function AdminCandidatesPage() {
  return (
    <AdminShell title="Candidatos externos" description="Revisa procedencia, score y oferta antes de enriquecer el catálogo.">
      <ExternalCandidatesView />
    </AdminShell>
  );
}
