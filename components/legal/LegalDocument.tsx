import { getTranslations } from "next-intl/server";
import { Info } from "lucide-react";
import { PublicHeader } from "@/components/shell/PublicHeader";
import { PublicFooter } from "@/components/shell/PublicFooter";
import { ButtonLink } from "@/components/ui";
import { APP_NAME } from "@/lib/seo";

/**
 * Armazón compartido de las páginas legales.
 *
 * Estas páginas existen porque el pie tiene que enlazar a algo real: un footer
 * con `Privacidad` y `Términos` que devuelven 404 es peor que no tenerlos.
 *
 * Llevan un aviso destacado, arriba, diciendo que el texto describe el
 * comportamiento del sistema y está PENDIENTE de revisión legal. Es deliberado
 * en las dos direcciones: no se inventa razón social, domicilio ni cláusulas de
 * responsabilidad —eso no lo puede redactar quien construye el producto—, y
 * tampoco se publica un texto con apariencia de definitivo que nadie ha
 * validado. Lo que sí es exacto y verificable es la descripción técnica: qué
 * datos toca el sistema y dónde.
 *
 * El componente recibe las secciones YA TRADUCIDAS. La alternativa —pasarle el
 * espacio de nombres y que resolviera `sections.${clave}.title` por su cuenta—
 * no compila: `next-intl` valida las claves contra el catálogo de mensajes y una
 * plantilla con un `string` dentro no es verificable. Resolviéndolas en cada
 * página con claves literales, el compilador comprueba que existen todas.
 */

export interface LegalSection {
  title: string;
  body: string;
}

export async function LegalDocument({
  heading,
  intro,
  sections,
}: {
  heading: string;
  intro: string;
  sections: readonly LegalSection[];
}) {
  const t = await getTranslations("legal.common");

  return (
    <>
      <PublicHeader />

      <main id="contenido" className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <header>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">
              {t("label")}
            </p>
            <h1 className="display mt-3 text-3xl text-ink sm:text-4xl">{heading}</h1>
            <p className="mt-4 text-[13px] text-ink-faint">{t("lastUpdated")}</p>
          </header>

          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/[0.07] px-5 py-4">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-[13px] leading-relaxed text-ink-muted">{t("draftNotice")}</p>
          </div>

          <p className="mt-8 text-[15px] leading-relaxed text-ink-muted">{intro}</p>

          <div className="mt-12 space-y-10">
            {sections.map((section, index) => (
              <section key={section.title}>
                <h2 className="text-base font-semibold tracking-tight text-ink">
                  {index + 1}. {section.title}
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{section.body}</p>
              </section>
            ))}
          </div>

          <div className="mt-14 border-t border-line pt-8">
            <ButtonLink href="/" variant="outline" size="md">
              {t("back")}
            </ButtonLink>
          </div>
        </div>
      </main>

      <PublicFooter appName={APP_NAME} />
    </>
  );
}
