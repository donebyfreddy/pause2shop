import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";

/** Estados de carga, vacío y progreso — la parte de la UI que más se descuida. */

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("skeleton-sheen rounded-lg", className)}
      {...props}
    />
  );
}

/** Bloque de líneas de texto simuladas. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${100 - i * (60 / Math.max(lines, 1))}%` }}
        />
      ))}
    </div>
  );
}

/** Filas de tabla en carga: mantiene la altura para que no salte el layout. */
export function SkeletonRows({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-t border-line/70">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4 py-3.5">
              <Skeleton className="h-3" style={{ width: c === 0 ? "70%" : "45%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-2xl bg-brand/20 blur-xl" aria-hidden />
        <div className="relative grid size-12 place-items-center rounded-2xl border border-line-strong bg-surface-2">
          <Icon className="size-5 text-ink-subtle" aria-hidden />
        </div>
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-subtle">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Progress({
  value,
  tone = "brand",
  className,
  label,
}: {
  /** 0–100. Se satura al rango para que un backend inconsistente no rompa la UI. */
  value: number;
  tone?: "brand" | "success" | "warning" | "danger";
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const bar = {
    brand: "bg-linear-to-r from-brand to-accent",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];

  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", bar)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Aviso en línea (info/atención/error) con el mismo lenguaje que los badges. */
export function Callout({
  tone = "info",
  icon: Icon,
  title,
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success" | "brand";
  icon?: LucideIcon;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-info/25 bg-info/8 text-info",
    warning: "border-warning/25 bg-warning/8 text-warning",
    danger: "border-danger/25 bg-danger/8 text-danger",
    success: "border-success/25 bg-success/8 text-success",
    brand: "border-brand/30 bg-brand/10 text-brand-bright",
  }[tone];

  return (
    <div className={cn("rounded-xl border px-3.5 py-3 text-xs", tones, className)}>
      <div className="flex gap-2.5">
        {Icon && <Icon className="mt-px size-4 shrink-0" aria-hidden />}
        <div className="min-w-0 space-y-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className="leading-relaxed text-ink-muted">{children}</div>}
        </div>
      </div>
    </div>
  );
}
