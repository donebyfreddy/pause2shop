import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Píldora de estado. Los `tone` son SEMÁNTICOS, no colores: así el mapa
 * estado→tono vive en un único sitio (ver lib/admin/status.ts) y la UI no
 * decide por su cuenta qué es "bueno" o "malo".
 */

export const badgeStyles = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium",
  {
    variants: {
      tone: {
        neutral: "border-line-strong bg-white/[0.04] text-ink-muted",
        brand: "border-brand/40 bg-brand/15 text-brand-bright",
        success: "border-success/30 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/12 text-warning",
        danger: "border-danger/30 bg-danger/12 text-danger",
        info: "border-info/30 bg-info/12 text-info",
        accent: "border-accent/30 bg-accent/12 text-accent",
        /** Estados aún sin medir/decidir: deliberadamente apagado. */
        muted: "border-line bg-transparent text-ink-faint",
      },
      size: {
        sm: "px-2 py-0.5 text-[10px]",
        md: "px-2.5 py-1 text-[11px]",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  }
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeStyles>["tone"]>;

export function Badge({
  className,
  tone,
  size,
  dot = false,
  pulse = false,
  children,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeStyles> & { dot?: boolean; pulse?: boolean }) {
  return (
    <span className={cn(badgeStyles({ tone, size }), className)} {...props}>
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && (
            <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-60" />
          )}
          <span className="relative size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
