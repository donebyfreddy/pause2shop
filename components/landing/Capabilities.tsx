"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Gauge, Layers, ScanSearch, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@/components/ui";
import { FadeIn, StaggerGroup, StaggerItem } from "@/components/motion";

/**
 * Capacidades del piloto.
 *
 * Tres correcciones respecto a la versión auditada:
 *
 *  1. **El titular deja de ser defensivo.** "Todo lo que ya funciona, con enlace
 *     directo para comprobarlo" invitaba a desconfiar. Ahora se enuncia como lo
 *     que es: la base técnica de un piloto.
 *  2. **Fuera "CLIP local o proveedor hash determinista para demo".** Admitir en
 *     la landing comercial que el motor de embeddings puede ser un sustituto de
 *     demostración no aporta nada y resta mucho. Se describe la capacidad
 *     —representaciones visuales para comparar— que es cierta en cualquier caso.
 *  3. **Los enlaces dejan de ir al admin.** Cuatro de seis bloques llevaban a
 *     `/admin/*`: la prueba que se ofrecía al visitante era el panel de
 *     operaciones. Ahora solo se enlaza a superficies públicas (`/studio`,
 *     `/catalog`, `/arquitectura`), y las capacidades que solo se ven desde
 *     dentro simplemente no llevan enlace.
 *
 * Composición: no son diez tarjetas. Es una hoja de especificaciones en tres
 * columnas — otra forma más de romper la repetición de la página.
 *
 * Los textos de las capacidades viven planos en `landing.capabilities.items.*`
 * y no anidados bajo su grupo. Es un requisito del tipado de `next-intl`:
 * `t(\`groups.${grupo}.items.${item}.title\`)` produce el producto cartesiano de
 * grupos × items —con combinaciones que no existen— y no compila. Con las claves
 * planas, el tipo resultante es la lista exacta de las doce capacidades. El
 * agrupamiento visual lo decide `GROUPS`, aquí abajo.
 */

const GROUPS = [
  {
    key: "analysis",
    icon: ScanSearch,
    items: [
      { key: "video", href: "/studio" },
      { key: "image", href: "/studio" },
      { key: "detection", href: null },
      { key: "timestamp", href: null },
    ],
  },
  {
    key: "catalog",
    icon: Layers,
    items: [
      { key: "normalized", href: "/catalog" },
      { key: "embeddings", href: null },
      { key: "matching", href: "/arquitectura" },
      { key: "connectors", href: null },
    ],
  },
  {
    key: "operation",
    icon: Gauge,
    items: [
      { key: "jobs", href: null },
      { key: "cost", href: null },
      { key: "observability", href: null },
      { key: "exceptions", href: null },
    ],
  },
] as const;

function ComplianceCode({ children }: Readonly<{ children: ReactNode }>) {
  return <code className="font-mono text-[11px] text-ink-muted">{children}</code>;
}

export function Capabilities() {
  const t = useTranslations("landing.capabilities");

  return (
    <section id="capacidades" className="relative scroll-mt-20 py-16 sm:py-24">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-line-strong to-transparent"
      />

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="max-w-2xl">
          <SectionLabel className="text-accent">{t("label")}</SectionLabel>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">{t("heading")}</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            {t("description")}
          </p>
        </FadeIn>

        <StaggerGroup className="mt-12 grid gap-x-10 gap-y-10 lg:grid-cols-3">
          {GROUPS.map((group) => {
            const Icon = group.icon;
            return (
              <StaggerItem key={group.key}>
                <div className="flex items-center gap-2.5 border-b border-line pb-3">
                  <span className="grid size-8 place-items-center rounded-lg border border-brand/30 bg-brand/10">
                    <Icon className="size-3.5 text-brand-bright" aria-hidden />
                  </span>
                  <h3 className="text-[13px] font-semibold tracking-wide text-ink uppercase">
                    {t(`groups.${group.key}.title`)}
                  </h3>
                </div>

                <dl className="mt-4 space-y-4">
                  {group.items.map((item) => {
                    const title = t(`items.${item.key}.title`);
                    const body = t(`items.${item.key}.body`);

                    return (
                      <div key={item.key}>
                        <dt className="text-[13px] font-medium text-ink">
                          {item.href ? (
                            <Link
                              href={item.href}
                              className="group inline-flex items-center gap-1 transition-colors hover:text-brand-bright"
                            >
                              {title}
                              <ArrowUpRight
                                className="size-3 text-ink-faint transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand-bright"
                                aria-hidden
                              />
                            </Link>
                          ) : (
                            title
                          )}
                        </dt>
                        <dd className="mt-1 text-xs leading-relaxed text-ink-subtle">{body}</dd>
                      </div>
                    );
                  })}
                </dl>
              </StaggerItem>
            );
          })}
        </StaggerGroup>

        <FadeIn delay={0.1} className="mt-12">
          <div className="panel flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
            <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-muted">
              <span className="font-medium text-ink">{t("complianceNote.lead")}</span>{" "}
              {t.rich("complianceNote.body", {
                code: (chunks) => <ComplianceCode>{chunks}</ComplianceCode>,
              })}
            </p>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
