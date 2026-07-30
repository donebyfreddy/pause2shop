import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * Botón del sistema. Un único juego de variantes para landing, estudio y admin.
 * `ButtonLink` comparte exactamente los mismos estilos sobre `next/link` para
 * que un CTA y una navegación no se vean nunca distintos.
 */

export const buttonStyles = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "font-medium transition-all duration-200 select-none",
    "disabled:pointer-events-none disabled:opacity-45",
    "active:translate-y-px",
  ],
  {
    variants: {
      variant: {
        /** Acción principal. Gradiente de marca + glow contenido. */
        primary: [
          "bg-linear-to-b from-brand-bright to-brand text-white",
          "shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset,0_8px_24px_-8px_rgba(109,94,252,0.7)]",
          "hover:from-brand-bright hover:to-brand-bright hover:shadow-[0_1px_0_0_rgba(255,255,255,0.3)_inset,0_10px_32px_-8px_rgba(109,94,252,0.85)]",
        ],
        /** Acción secundaria sobre superficie oscura. */
        secondary: [
          "bg-surface-2 text-ink border border-line-strong",
          "hover:bg-surface-3 hover:border-ink-faint",
        ],
        /** Borde fino, fondo translúcido: la más usada en barras de herramientas. */
        outline: [
          "border border-line bg-white/[0.02] text-ink-muted",
          "hover:border-line-strong hover:bg-white/[0.05] hover:text-ink",
        ],
        ghost: "text-ink-muted hover:bg-white/[0.06] hover:text-ink",
        danger: [
          "border border-danger/30 bg-danger/10 text-danger",
          "hover:bg-danger/20 hover:border-danger/50",
        ],
        success: [
          "border border-success/30 bg-success/10 text-success",
          "hover:bg-success/20 hover:border-success/50",
        ],
        warning: [
          "border border-warning/30 bg-warning/10 text-warning",
          "hover:bg-warning/20 hover:border-warning/50",
        ],
      },
      size: {
        xs: "h-7 rounded-lg px-2.5 text-xs",
        sm: "h-9 rounded-lg px-3.5 text-[13px]",
        md: "h-11 rounded-xl px-5 text-sm",
        lg: "h-13 rounded-xl px-7 text-[15px]",
      },
      block: { true: "w-full", false: "" },
      /** Botón sólo icono: cuadrado, sin padding lateral extra. */
      icon: { true: "aspect-square px-0", false: "" },
    },
    defaultVariants: { variant: "secondary", size: "md", block: false, icon: false },
  }
);

type ButtonBaseProps = VariantProps<typeof buttonStyles> & {
  loading?: boolean;
  children?: ReactNode;
};

export type ButtonProps = ComponentProps<"button"> & ButtonBaseProps;

export function Button({
  className,
  variant,
  size,
  block,
  icon,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={props.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonStyles({ variant, size, block, icon }), className)}
      {...props}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export type ButtonLinkProps = ComponentProps<typeof Link> & ButtonBaseProps;

export function ButtonLink({
  className,
  variant,
  size,
  block,
  icon,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={cn(buttonStyles({ variant, size, block, icon }), className)} {...props}>
      {children}
    </Link>
  );
}
