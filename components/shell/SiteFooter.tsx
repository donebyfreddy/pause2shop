import Link from "next/link";
import { Logo } from "./Logo";

/**
 * Pie del producto público. Incluye la nota honesta sobre el origen de los
 * resultados: es parte del posicionamiento (no inventamos productos) y no
 * debería poder desaparecer sin que alguien lo decida explícitamente.
 */

const COLUMNS = [
  {
    title: "Producto",
    links: [
      { href: "/studio", label: "Estudio de análisis" },
      { href: "/catalog", label: "Catálogo detectado" },
      { href: "/demo", label: "Demo de vídeo" },
    ],
  },
  {
    title: "Operaciones",
    links: [
      { href: "/admin", label: "Panel de administración" },
      { href: "/admin/connectors", label: "Conectores" },
      { href: "/admin/jobs", label: "Jobs de ingesta" },
      { href: "/admin/logs", label: "Monitorización" },
    ],
  },
] as const;

export function SiteFooter({ appName = "Pause2Shop" }: { appName?: string }) {
  return (
    <footer className="mt-24 border-t border-line bg-canvas-raised">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-ink-subtle">
            Detección visual de productos en vídeo e imagen, con coincidencia contra catálogo
            propio y búsqueda visual inversa. Los resultados provienen de fuentes reales: no
            se inventan marcas, precios ni enlaces.
          </p>
        </div>

        {COLUMNS.map((column) => (
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
          <p>© {new Date().getFullYear()} {appName}. Demo técnica.</p>
          <p>
            Ingesta de catálogo con robots.txt respetado, rate limit por dominio y sin evasión
            anti-bot.
          </p>
        </div>
      </div>
    </footer>
  );
}
