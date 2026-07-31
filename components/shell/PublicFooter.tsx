"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import { LanguageSelector } from "@/components/i18n/LanguageSelector";
import { Logo } from "./Logo";

/**
 * Pie público.
 *
 * Cambios respecto a la versión auditada:
 *
 *  - **Fuera la columna "Operaciones"** (`/admin`, conectores, jobs, logs). Eran
 *     cuatro enlaces a la trastienda en el pie de una página comercial.
 *  - **Legal y documentación reales**, no decorativas: `/legal/privacidad`,
 *     `/legal/terminos` y `/arquitectura` existen como rutas.
 *  - **Selector de idioma** también aquí: quien llega al final de la página es
 *     justo quien puede necesitar cambiarlo y no quiere volver arriba.
 *
 * `contactEmail` llega por configuración (`NEXT_PUBLIC_CONTACT_EMAIL`). Si no
 * está definida, el enlace de contacto NO se renderiza: es preferible un pie con
 * un hueco menos que un `mailto:` inventado en una landing que se va a enseñar a
 * un cliente.
 *
 * `serviceOk` es opcional y solo lo pasa la landing, que ya consulta el servicio
 * de catálogo en servidor. Cuando no se pasa, no se muestra indicador — no se
 * afirma "operativo" sin haberlo comprobado.
 */

export function PublicFooter({
  appName = "Pause2Shop",
  serviceOk,
}: {
  appName?: string;
  serviceOk?: boolean;
}) {
  const t = useTranslations("landing.footer");
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

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
      title: t("resources.title"),
      links: [
        { href: "/arquitectura", label: t("resources.architecture") },
        { href: "/#como-funciona", label: t("resources.howItWorks") },
        { href: "/#capacidades", label: t("resources.capabilities") },
      ],
    },
    {
      title: t("legal.title"),
      links: [
        { href: "/legal/privacidad", label: t("legal.privacy") },
        { href: "/legal/terminos", label: t("legal.terms") },
        ...(contactEmail
          ? [{ href: `mailto:${contactEmail}`, label: t("legal.contact") }]
          : []),
      ],
    },
  ];

  return (
    <footer className="mt-20 border-t border-line bg-canvas-raised">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.6fr_1fr_1fr_1fr] lg:px-8">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-ink-muted">
            {t("description")}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <LanguageSelector align="start" />
            {serviceOk !== undefined && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-ink-muted">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    serviceOk ? "bg-success" : "bg-warning"
                  )}
                />
                {serviceOk ? t("status.ok") : t("status.degraded")}
              </span>
            )}
          </div>
        </div>

        {columns.map((column) => (
          <div key={column.title}>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
              {column.title}
            </p>
            <ul className="mt-3.5 space-y-2.5">
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
          <p className="max-w-xl sm:text-right">{t("complianceNote")}</p>
        </div>
      </div>
    </footer>
  );
}
