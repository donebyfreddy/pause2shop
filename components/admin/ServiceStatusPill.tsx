"use client";

import { Database, HardDrive, WifiOff } from "lucide-react";
import { useAdminResource } from "@/lib/admin/client";

type Health = {
  status: string;
  db: "postgres" | "file";
  embeddings: { provider: string; model: string; dimension: number };
  products: number;
  uptimeSeconds: number;
};

/**
 * Estado del servicio de catálogo en la barra lateral. Dice la verdad sobre el
 * backend activo: si está en modo fichero (sin DATABASE_URL válida) se muestra
 * como aviso, no como "todo bien".
 */
export function ServiceStatusPill() {
  const { data, error } = useAdminResource<Health>("health", { pollMs: 20_000 });

  if (error || !data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger/8 px-3 py-2">
        <WifiOff className="size-3.5 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-danger">Servicio no disponible</p>
          <p className="truncate text-[10px] text-ink-faint">
            {error?.message ?? "comprobando…"}
          </p>
        </div>
      </div>
    );
  }

  const isPostgres = data.db === "postgres";
  const Icon = isPostgres ? Database : HardDrive;

  return (
    <div
      className={
        "flex items-center gap-2 rounded-lg border px-3 py-2 " +
        (isPostgres
          ? "border-success/25 bg-success/8"
          : "border-warning/25 bg-warning/8")
      }
    >
      <Icon
        className={"size-3.5 shrink-0 " + (isPostgres ? "text-success" : "text-warning")}
        aria-hidden
      />
      <div className="min-w-0">
        <p
          className={
            "text-[11px] font-medium " + (isPostgres ? "text-success" : "text-warning")
          }
        >
          {isPostgres ? "Postgres + pgvector" : "Store en fichero"}
        </p>
        <p className="truncate text-[10px] text-ink-faint">
          {data.products.toLocaleString("es-ES")} productos ·{" "}
          {data.embeddings.provider} {data.embeddings.dimension}d
        </p>
      </div>
    </div>
  );
}
