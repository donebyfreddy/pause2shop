"use client";

import Link from "next/link";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/ui/cn";
import { ButtonLink } from "@/components/ui";
import { LanguageSelector } from "@/components/i18n/LanguageSelector";
import { Logo } from "./Logo";

/**
 * Cabecera pública.
 *
 * Tres cosas que corrige respecto a la versión auditada:
 *
 *  1. **`Admin` ya no existe aquí.** Ni en escritorio ni en el menú móvil. El
 *     panel de operaciones no es una función del producto que se vende: es la
 *     trastienda, está detrás de Basic auth (`proxy.ts`) y no se promociona a un
 *     visitante. La ruta sigue accesible para quien la conoce.
 *  2. **Se acabó el desbordamiento en móvil.** La versión anterior metía
 *     selector de idioma + CTA + hamburguesa en 390 px y se salía 16 px de la
 *     pantalla. Ahora, por debajo de `sm`, a la derecha SOLO va la hamburguesa;
 *     idioma y CTA viven dentro del panel del menú, donde caben y se pulsan
 *     mejor.
 *  3. **Navegación por anclas con sección activa.** En la landing los enlaces
 *     apuntan a secciones y el indicador sigue al scroll mediante
 *     `IntersectionObserver`; fuera de la landing, los mismos huecos pasan a ser
 *     rutas de producto.
 */

/**
 * Secciones de la landing, EN ORDEN DE DOCUMENTO.
 *
 * El orden importa: el indicador de sección activa se calcula eligiendo la
 * sección visible más alta, así que una lista desordenada respecto al DOM haría
 * que el subrayado saltase hacia atrás al bajar.
 *
 * Cada `id` tiene que existir en `app/page.tsx`; si se renombra una sección allí,
 * el enlace deja de resolver y el indicador nunca se activa.
 */
const ANCHORS = [
  { id: "como-funciona", labelKey: "howItWorks" },
  { id: "demo", labelKey: "demo" },
  { id: "integracion", labelKey: "integration" },
  { id: "casos-de-uso", labelKey: "useCases" },
] as const;

/** Rutas de producto, para las páginas que no son la landing. */
const ROUTES = [
  { href: "/studio", labelKey: "studio" },
  { href: "/catalog", labelKey: "catalog" },
  { href: "/demo", labelKey: "demoVideo" },
] as const;

export function PublicHeader({
  /** Landing: navegación por anclas + cabecera transparente sobre el hero. */
  anchors = false,
}: {
  anchors?: boolean;
}) {
  const t = useTranslations("navigation");
  const tActions = useTranslations("actions");
  const [solid, setSolid] = useState(!anchors);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => {
    if (anchors) setSolid(y > 24);
  });

  // Sección activa. Se elige la sección más alta que esté cruzando la banda
  // superior del viewport: con `entries[0]` a secas, dos secciones visibles a la
  // vez hacen parpadear el indicador.
  useEffect(() => {
    if (!anchors) return;
    const targets = ANCHORS.map((a) => document.getElementById(a.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      // La banda excluye la cabecera (64 px) y los dos tercios inferiores: así
      // "activa" significa "la que estás leyendo", no "la que se asoma".
      { rootMargin: "-64px 0px -66% 0px", threshold: 0 }
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [anchors]);

  // Cerrar el menú con Escape y bloquear el scroll de fondo mientras está
  // abierto: en móvil es un panel a pantalla casi completa.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const navItems = anchors
    ? ANCHORS.map((a) => ({
        key: a.id,
        href: `#${a.id}`,
        label: t(a.labelKey),
        active: activeId === a.id,
      }))
    : ROUTES.map((r) => ({
        key: r.href,
        href: r.href,
        label: t(r.labelKey),
        active: false,
      }));

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-colors duration-300",
        solid || menuOpen
          ? "border-b border-line bg-canvas/85 backdrop-blur-xl"
          : "border-b border-transparent"
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />

        <nav className="ml-auto hidden items-center gap-0.5 md:flex" aria-label={t("mainNav")}>
          {navItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={item.active ? "true" : undefined}
              className={cn(
                "relative rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                item.active ? "text-ink" : "text-ink-subtle hover:text-ink"
              )}
            >
              {item.label}
              {item.active && (
                <motion.span
                  layoutId="public-nav-active"
                  className="absolute inset-x-3 -bottom-px h-px bg-linear-to-r from-transparent via-brand-bright to-transparent"
                />
              )}
            </Link>
          ))}
        </nav>

        {/* En móvil este bloque solo contiene la hamburguesa: es la causa del
            desbordamiento que se arregla aquí. */}
        <div className={cn("flex items-center gap-2", !anchors && "ml-auto md:ml-4")}>
          <div className="hidden sm:block">
            <LanguageSelector />
          </div>
          <ButtonLink
            href="/studio"
            variant="primary"
            size="sm"
            className="hidden sm:inline-flex"
          >
            {tActions("tryNow")}
            <ArrowRight className="size-3.5" aria-hidden />
          </ButtonLink>

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={menuOpen}
            aria-controls="public-mobile-menu"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-line text-ink-muted transition-colors hover:text-ink md:hidden"
          >
            {menuOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            id="public-mobile-menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
            className="overflow-hidden border-t border-line bg-canvas/97 backdrop-blur-xl md:hidden"
            aria-label={t("mobileNav")}
          >
            <div className="flex flex-col gap-1 px-4 pt-3 pb-5">
              {navItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={item.active ? "true" : undefined}
                  className={cn(
                    // min-h de 44 px: objetivo táctil cómodo, no un enlace de texto.
                    "flex min-h-11 items-center rounded-lg px-3 text-[15px] transition-colors",
                    item.active
                      ? "bg-brand/12 text-ink"
                      : "text-ink-muted hover:bg-white/[0.04] hover:text-ink"
                  )}
                >
                  {item.label}
                </Link>
              ))}

              <div className="mt-3 flex items-center gap-3 border-t border-line pt-4">
                <LanguageSelector align="start" />
                <ButtonLink
                  href="/studio"
                  variant="primary"
                  size="md"
                  className="flex-1"
                  onClick={() => setMenuOpen(false)}
                >
                  {tActions("tryNow")}
                  <ArrowRight className="size-4" aria-hidden />
                </ButtonLink>
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
