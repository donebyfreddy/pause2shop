"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useScroll, useMotionValueEvent } from "motion/react";
import { LayoutDashboard, Menu, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import { ButtonLink } from "@/components/ui";
import { LanguageSelector } from "@/components/i18n/LanguageSelector";
import { Logo } from "./Logo";

/**
 * Cabecera única del producto público (landing, estudio, catálogo).
 *
 * Se vuelve opaca al hacer scroll — sobre el hero flota transparente para no
 * cortar la composición, y a partir de ahí gana fondo para que el contenido no
 * se lea por debajo.
 */

const NAV = [
  { href: "/studio", labelKey: "studio" },
  { href: "/catalog", labelKey: "catalog" },
  { href: "/demo", labelKey: "demoVideo" },
] as const;

export function SiteHeader({ transparentOnTop = false }: { transparentOnTop?: boolean }) {
  const t = useTranslations("navigation");
  const tActions = useTranslations("actions");
  const pathname = usePathname();
  const [solid, setSolid] = useState(!transparentOnTop);
  const [menuOpen, setMenuOpen] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => {
    if (transparentOnTop) setSolid(y > 24);
  });

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
      className={cn(
        "sticky top-0 z-50 w-full transition-colors duration-300",
        solid ? "border-b border-line bg-canvas/85 backdrop-blur-xl" : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label={t("mainNav")}>
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                  active ? "text-ink" : "text-ink-subtle hover:text-ink"
                )}
              >
                {t(item.labelKey)}
                {active && (
                  <motion.span
                    layoutId="site-nav-active"
                    className="absolute inset-x-3 -bottom-px h-px bg-linear-to-r from-transparent via-brand-bright to-transparent"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSelector />
          <ButtonLink
            href="/admin"
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            title={tActions("viewCatalogPanel")}
          >
            <LayoutDashboard className="size-4" aria-hidden />
            {t("admin")}
          </ButtonLink>
          <ButtonLink href="/studio" variant="primary" size="sm">
            <Sparkles className="size-4" aria-hidden />
            {tActions("tryNow")}
          </ButtonLink>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={menuOpen}
            className="grid size-9 place-items-center rounded-lg border border-line text-ink-muted md:hidden"
          >
            {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <motion.nav
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="overflow-hidden border-t border-line bg-canvas/95 backdrop-blur-xl md:hidden"
          aria-label={t("mobileNav")}
        >
          <div className="flex flex-col gap-1 px-4 py-3">
            {[...NAV, { href: "/admin", labelKey: "admin" as const }].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-ink-muted transition-colors hover:bg-white/[0.04] hover:text-ink"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </div>
        </motion.nav>
      )}
    </motion.header>
  );
}
