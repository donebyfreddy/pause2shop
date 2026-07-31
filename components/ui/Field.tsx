import type { ComponentProps, ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/ui/cn";

/** Controles de formulario del sistema: input, select, buscador y etiqueta. */

const control = [
  "h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-ink",
  "transition-colors placeholder:text-ink-faint",
  "hover:border-line-strong focus:border-brand/60 focus:bg-surface-3 focus:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ");

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(control, "cursor-pointer appearance-none pe-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 end-2.5 size-3.5 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
    </div>
  );
}

/** Input con icono de lupa: el patrón de búsqueda repetido en todo el admin. */
export function SearchInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 start-3 size-3.5 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
      <input type="search" className={cn(control, "ps-9")} {...props} />
    </div>
  );
}

export function Label({
  className,
  hint,
  children,
  ...props
}: ComponentProps<"label"> & { hint?: ReactNode }) {
  return (
    <label className={cn("block", className)} {...props}>
      <span className="text-[11px] font-medium text-ink-muted">{children}</span>
      {hint && <span className="ms-2 text-[10px] text-ink-faint">{hint}</span>}
    </label>
  );
}

/** Fila etiqueta → valor, usada en detalles y ajustes. */
export function DataRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line/60 py-2 last:border-0">
      <span className="shrink-0 text-[11px] text-ink-subtle">{label}</span>
      <span
        className={cn(
          "min-w-0 text-end text-[12px] break-words text-ink",
          mono && "font-mono text-[11px]"
        )}
      >
        {children}
      </span>
    </div>
  );
}
