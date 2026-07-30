import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Primitivas de tabla. La jerarquía la dan la cabecera pegajosa en versalitas,
 * las filas con hover y el scroll horizontal contenido: en el admin hay tablas
 * anchas y nunca deben provocar scroll horizontal de página.
 */

export function TableWrap({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("w-full overflow-x-auto", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <table
      className={cn("w-full min-w-[720px] border-collapse text-left text-[13px]", className)}
      {...props}
    />
  );
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      className={cn("sticky top-0 z-10 bg-surface/95 backdrop-blur-sm", className)}
      {...props}
    />
  );
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-line px-4 py-2.5 text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase",
        className
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line/70", className)} {...props} />;
}

export function TR({
  className,
  interactive = false,
  ...props
}: ComponentProps<"tr"> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "transition-colors",
        interactive && "cursor-pointer hover:bg-white/[0.03]",
        className
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle text-ink-muted", className)} {...props} />;
}

/** Fila de estado vacío que respeta el ancho de la tabla. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        {children}
      </td>
    </tr>
  );
}
