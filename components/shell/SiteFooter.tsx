"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "./Logo";

/**
 * Pie del producto público. Incluye la nota honesta sobre el origen de los
 * resultados: es parte del posicionamiento (no inventamos productos) y no
 * debería poder desaparecer sin que alguien lo decida explícitamente.
 */

export function SiteFooter({ appName = "Pause2Shop" }: { appName?: string }) {
  const t = useTranslations("landing.footer");

  const columns = [
    {
      title: t("product.title"),
      links: [
        { href: "/studio", label: t("product.studio") },
        { href: "/catalog", label: t("product.catalog") },
        { href: "/demo", label: t("product.demo") },
      ],
    },
    {
      title: t("operations.title"),
      links: [
        { href: "/admin", label: t("operations.admin") },
        { href: "/admin/connectors", label: t("operations.connectors") },
        { href: "/admin/jobs", label: t("operations.jobs") },
        { href: "/admin/logs", label: t("operations.logs") },
      ],
    },
  ];

  return (
    <footer className="mt-24 border-t border-line bg-canvas-raised">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-ink-subtle">
            {t("description")}
          </p>
        </div>

        {columns.map((column) => (
          <div key={column.title}>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
              {column.title}
            </p>
            <ul className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[13px] text-ink-muted transition-colors hover:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 text-[11px] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>{t("copyright", { year: new Date().getFullYear(), appName })}</p>
          <p>{t("complianceNote")}</p>
        </div>
      </div>
    </footer>
  );
}
