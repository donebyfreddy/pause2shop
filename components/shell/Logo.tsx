import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";

/**
 * Marca. Isotipo oficial (public/logo-mark.png): recorte del logo suministrado
 * sin el wordmark, que ya lo pone el propio texto de al lado — así no se
 * duplica en ningún sitio donde se use el icono solo (admin, favicons futuros…).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative grid size-8 shrink-0 place-items-center", className)}>
      <Image
        src="/logo-mark.png"
        alt=""
        width={243}
        height={255}
        priority
        className="size-full object-contain"
      />
    </span>
  );
}

export function Logo({
  href = "/",
  label = "Pause2Shop",
  suffix,
  className,
}: {
  href?: string;
  label?: string;
  /** Sufijo contextual: "Admin", "Estudio"… */
  suffix?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("group inline-flex items-center gap-2.5", className)}
      aria-label={suffix ? `${label} ${suffix}` : label}
    >
      <LogoMark className="transition-transform duration-300 group-hover:scale-105" />
      <span className="flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold tracking-tight text-ink">{label}</span>
        {suffix && (
          <span className="rounded-md border border-line bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-subtle uppercase">
            {suffix}
          </span>
        )}
      </span>
    </Link>
  );
}
