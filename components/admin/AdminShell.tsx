"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  Database,
  LayoutDashboard,
  ListChecks,
  Menu,
  Plug,
  ScrollText,
  Settings,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import { LogoMark } from "@/components/shell/Logo";
import { LanguageSelector } from "@/components/i18n/LanguageSelector";
import { ServiceStatusPill } from "./ServiceStatusPill";

/**
 * Chrome del admin: barra lateral fija + barra superior pegajosa.
 *
 * Comparte tokens y componentes con el producto público: es el MISMO producto
 * visto desde operaciones, no una herramienta aparte.
 *
 * Los estilos direccionales de este componente (posición/transform de la
 * barra lateral, padding del contenido) usan propiedades lógicas (`start-`,
 * `ps-`) y las variantes `rtl:`/`ltr:` de Tailwind para funcionar en árabe.
 *
 * El translate que oculta la barra en móvil va SIEMPRE bajo `max-lg:`. Tailwind
 * v4 emite `ltr:`/`rtl:` como variantes incondicionales (sin media query) y
 * `lg:` como una regla dentro de `@media`; con la misma especificidad, dos
 * reglas que fijan la propiedad `translate` se resuelven por orden de
 * aparición en la hoja generada, no por "cuál aplica en este viewport" — así
 * que un `ltr:-translate-x-full` sin acotar ganaba siempre a `lg:translate-x-0`
 * y la barra quedaba fuera de pantalla también en escritorio (con el
 * contenido ya desplazado por el `ps-64`, dejando el hueco vacío a la
 * izquierda). Acotando el estado oculto a `max-lg:` las dos reglas dejan de
 * solaparse en cualquier viewport: no hay orden de cascada que desempatar.
 */

const SIDEBAR_COLLAPSED_KEY = "p2s.admin.sidebarCollapsed";

type NavItem = {
  href: string;
  labelKey: "overview" | "connectors" | "jobs" | "catalog" | "logs" | "settings";
  icon: typeof LayoutDashboard;
  /** `/admin` solo está activo en coincidencia exacta: si no, lo estaría siempre. */
  exact?: boolean;
};

const NAV: NavItem[] = [
  { href: "/admin", labelKey: "overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/connectors", labelKey: "connectors", icon: Plug },
  { href: "/admin/jobs", labelKey: "jobs", icon: ListChecks },
  { href: "/admin/catalog", labelKey: "catalog", icon: Database },
  { href: "/admin/logs", labelKey: "logs", icon: ScrollText },
  { href: "/admin/settings", labelKey: "settings", icon: Settings },
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
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // El ancho persistido es una preferencia de escritorio (localStorage no
  // existe en el render de servidor): se lee tras montar, así el primer
  // pintado siempre coincide entre servidor y cliente y no hay parpadeo de
  // hidratación.
  useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
      setCollapsed(true);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

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
          "fixed inset-y-0 start-0 z-50 flex flex-col border-e border-line bg-canvas-raised transition-[translate,width] duration-300 lg:translate-x-0",
          collapsed ? "w-64 lg:w-[76px]" : "w-64",
          // El estado "oculto" (móvil, drawer cerrado) va SIEMPRE bajo `max-lg:`
          // — ver nota de arriba sobre por qué NO puede ser una variante
          // incondicional a la vez que existe `lg:translate-x-0`.
          navOpen ? "translate-x-0" : "max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full"
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center gap-2 border-b border-line px-4",
            collapsed ? "justify-between lg:justify-center lg:px-0" : "justify-between"
          )}
        >
          <Link href="/admin" className="flex items-center gap-2.5 overflow-hidden">
            <LogoMark />
            <span className={cn("flex flex-col leading-none", collapsed && "lg:hidden")}>
              <span className="text-[13px] font-semibold whitespace-nowrap text-ink">Pause2Shop</span>
              <span className="mt-0.5 text-[10px] whitespace-nowrap tracking-[0.12em] text-ink-faint uppercase">
                {t("operationsLabel")}
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label={t("closeNav")}
            className="rounded-md p-1.5 text-ink-faint lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label={t("sectionsNav")}>
          {NAV.map((item) => {
            const active = isActive(item);
            const label = t(`nav.${item.labelKey}`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeNav}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
                  collapsed && "lg:justify-center lg:px-2",
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
                  className={cn("relative size-4 shrink-0", active ? "text-brand-bright" : "")}
                  aria-hidden
                />
                <span className={cn("relative whitespace-nowrap", collapsed && "lg:hidden")}>
                  {label}
                </span>
                {collapsed && (
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute start-full top-1/2 z-50 ms-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-canvas-raised px-2 py-1 text-[12px] text-ink opacity-0 shadow-panel transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 lg:group-hover:block lg:group-focus-visible:block"
                  >
                    {label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t("expandNav") : t("collapseNav")}
            title={collapsed ? t("expandNav") : t("collapseNav")}
            className={cn(
              "hidden w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-ink-subtle transition-colors hover:bg-white/[0.04] hover:text-ink lg:flex",
              collapsed && "justify-center"
            )}
          >
            {collapsed ? (
              <ChevronsRight className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronsLeft className="size-3.5 shrink-0" aria-hidden />
            )}
            {!collapsed && <span className="whitespace-nowrap">{t("collapseNav")}</span>}
          </button>
          <div className={cn(collapsed && "lg:hidden")}>
            <ServiceStatusPill />
          </div>
          <Link
            href="/"
            onClick={closeNav}
            title={collapsed ? t("backToProduct") : undefined}
            className={cn(
              "mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-ink-subtle transition-colors hover:bg-white/[0.04] hover:text-ink",
              collapsed && "lg:justify-center"
            )}
          >
            <ArrowLeft className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
            <span className={cn(collapsed && "lg:hidden")}>{t("backToProduct")}</span>
          </Link>
        </div>
      </aside>

      {/* backdrop del menú móvil */}
      {navOpen && (
        <button
          type="button"
          aria-label={t("closeNav")}
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
        />
      )}

      {/* ------------------------- contenido ------------------------- */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-300",
          collapsed ? "lg:ps-[76px]" : "lg:ps-64"
        )}
      >
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                aria-label={t("openNav")}
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
            <div className="flex flex-wrap items-center gap-2">
              {actions}
              <LanguageSelector />
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
