"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Database,
  LayoutDashboard,
  ListChecks,
  Menu,
  Plug,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { LogoMark } from "@/components/shell/Logo";
import { ServiceStatusPill } from "./ServiceStatusPill";

/**
 * Chrome del admin: barra lateral fija + barra superior pegajosa.
 *
 * Comparte tokens y componentes con el producto público: es el MISMO producto
 * visto desde operaciones, no una herramienta aparte.
 */

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** `/admin` solo está activo en coincidencia exacta: si no, lo estaría siempre. */
  exact?: boolean;
};

const NAV: NavItem[] = [
  { href: "/admin", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/admin/connectors", label: "Conectores", icon: Plug },
  { href: "/admin/jobs", label: "Jobs", icon: ListChecks },
  { href: "/admin/catalog", label: "Catálogo", icon: Database },
  { href: "/admin/logs", label: "Monitorización", icon: ScrollText },
  { href: "/admin/settings", label: "Ajustes", icon: Settings },
];

export function AdminShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  // El menú móvil se cierra al pulsar un enlace (en el propio evento, no en un
  // efecto sobre `pathname`: eso provocaría un render en cascada).
  const closeNav = () => setNavOpen(false);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* ------------------------- sidebar ------------------------- */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-canvas-raised transition-transform duration-300 lg:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-line px-4">
          <Link href="/admin" className="flex items-center gap-2.5">
            <LogoMark />
            <span className="flex flex-col leading-none">
              <span className="text-[13px] font-semibold text-ink">Pause2Shop</span>
              <span className="mt-0.5 text-[10px] tracking-[0.12em] text-ink-faint uppercase">
                Operaciones
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Cerrar navegación"
            className="rounded-md p-1.5 text-ink-faint lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Secciones del admin">
          {NAV.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeNav}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
                  active ? "text-ink" : "text-ink-subtle hover:bg-white/[0.04] hover:text-ink"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="admin-nav-active"
                    className="absolute inset-0 rounded-lg border border-brand/30 bg-brand/12"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <item.icon
                  className={cn("relative size-4", active ? "text-brand-bright" : "")}
                  aria-hidden
                />
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <ServiceStatusPill />
          <Link
            href="/"
            onClick={closeNav}
            className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-ink-subtle transition-colors hover:bg-white/[0.04] hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Volver al producto
          </Link>
        </div>
      </aside>

      {/* backdrop del menú móvil */}
      {navOpen && (
        <button
          type="button"
          aria-label="Cerrar navegación"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      {/* ------------------------- contenido ------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                aria-label="Abrir navegación"
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-ink-muted lg:hidden"
              >
                <Menu className="size-4" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-semibold text-ink">{title}</h1>
                {description && (
                  <p className="truncate text-xs text-ink-subtle">{description}</p>
                )}
              </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
