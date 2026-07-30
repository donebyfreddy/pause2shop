import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Tarjeta/panel del sistema. `interactive` añade el estado hover que usan las
 * rejillas navegables (conectores, productos, casos de uso).
 */

export function Card({
  className,
  interactive = false,
  glow = false,
  ...props
}: ComponentProps<"div"> & { interactive?: boolean; glow?: boolean }) {
  return (
    <div
      className={cn(
        "panel relative",
        interactive &&
          "transition-all duration-200 hover:border-line-strong hover:bg-surface-2 focus-within:border-line-strong",
        glow && "ring-brand",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  actions,
  children,
  ...props
}: ComponentProps<"div"> & { actions?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-line px-5 py-4",
        className
      )}
      {...props}
    >
      <div className="min-w-0">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("truncate text-sm font-semibold text-ink", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-1 text-xs leading-relaxed text-ink-subtle", className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-line px-5 py-3",
        className
      )}
      {...props}
    />
  );
}

/** Etiqueta de sección en versalitas — separador ligero dentro de un panel. */
export function SectionLabel({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase",
        className
      )}
      {...props}
    />
  );
}
