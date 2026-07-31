"use client";

import {
  Eye,
  FileClock,
  KeyRound,
  Power,
  ShieldCheck,
  SplitSquareHorizontal,
  Timer,
  UserCog,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@/components/ui";
import { FadeIn, StaggerGroup, StaggerItem } from "@/components/motion";

/**
 * Seguridad y confianza.
 *
 * Sección compacta, deliberadamente sobria: aquí el diseño no debe llamar la
 * atención, debe dar la sensación de que alguien se lo ha pensado.
 *
 * Lo que NO hay: sellos, certificaciones ni logotipos de cumplimiento. No
 * tenemos ninguna certificación, y ponerla —o insinuarla con un icono de
 * candado con aire oficial— sería el tipo de afirmación que hunde una reunión
 * con el departamento legal del cliente. Cada punto de esta lista describe algo
 * que el sistema hace hoy o una decisión de diseño real.
 */

const ITEMS = [
  { key: "authorizedData", icon: ShieldCheck },
  { key: "separation", icon: SplitSquareHorizontal },
  { key: "secrets", icon: KeyRound },
  { key: "audit", icon: FileClock },
  { key: "roles", icon: UserCog },
  { key: "degradation", icon: Eye },
  { key: "killSwitch", icon: Power },
  { key: "retention", icon: Timer },
] as const;

export function SecuritySection() {
  const t = useTranslations("landing.security");

  return (
    <section id="seguridad" className="relative scroll-mt-20 border-y border-line bg-canvas-raised py-16 sm:py-20">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <FadeIn className="max-w-2xl">
          <SectionLabel className="text-accent">{t("label")}</SectionLabel>
          <h2 className="display mt-3 text-3xl text-ink sm:text-4xl">{t("heading")}</h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            {t("description")}
          </p>
        </FadeIn>

        <StaggerGroup className="mt-11 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <StaggerItem key={item.key}>
                <Icon className="size-4 text-brand-bright" aria-hidden />
                <h3 className="mt-3 text-[13px] font-semibold text-ink">
                  {t(`items.${item.key}.title`)}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">
                  {t(`items.${item.key}.body`)}
                </p>
              </StaggerItem>
            );
          })}
        </StaggerGroup>

        <FadeIn delay={0.1} className="mt-10">
          <p className="max-w-3xl border-t border-line pt-5 text-[11px] leading-relaxed text-ink-faint">
            {t("note")}
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
