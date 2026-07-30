import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { Skeleton } from "./Feedback";

/**
 * Tarjeta de métrica del overview. Deliberadamente contenida: número grande,
 * etiqueta pequeña y una sola pista de contexto. Sin gráficos decorativos que
 * no aporten dato.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  loading = false,
  children,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "accent";
  loading?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "text-ink-subtle",
    brand: "text-brand-bright",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    accent: "text-accent",
  }[tone];

  return (
    <div
      className={cn(
        "panel relative overflow-hidden px-4 py-3.5 transition-colors hover:border-line-strong",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
          {label}
        </p>
        {Icon && <Icon className={cn("size-4 shrink-0", tones)} aria-hidden />}
      </div>
      {loading ? (
        <Skeleton className="mt-2.5 h-7 w-20" />
      ) : (
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ink tabular-nums">
          {value}
        </p>
      )}
      {hint && <p className="mt-1 text-[11px] leading-snug text-ink-subtle">{hint}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
