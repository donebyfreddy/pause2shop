import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { PublicHeader } from "@/components/shell/PublicHeader";
import { PublicFooter } from "@/components/shell/PublicFooter";
import { ButtonLink } from "@/components/ui";
import { APP_NAME, absoluteUrl } from "@/lib/seo";

/**
 * Arquitectura técnica.
 *
 * Esta página existe para que la landing no tenga que llevar la jerga. La
 * auditoría encontró `rVFC`, `scene diff`, `hash perceptual`, `NMS`, `pgvector`
 * y `matchStage` en la primera pantalla y media de la home, compitiendo con el
 * mensaje de negocio. Nada de eso se ha eliminado del producto ni del discurso:
 * se ha movido aquí, donde el lector que lo busca lo encuentra completo y el que
 * no, no se lo tropieza.
 *
 * Es el destino del botón "Ver arquitectura técnica" de `HowItWorks`.
 */

const CANONICAL = absoluteUrl("/arquitectura");

const STAGE_KEYS = ["capture", "detect", "dedupe", "match", "publish"] as const;

/**
 * Claves de los detalles, explícitas. Un `Array.from({ length: 4 })` produciría
 * la clave `details.d${number}`, que `next-intl` no puede verificar contra el
 * catálogo de mensajes; con literales, el compilador comprueba las veinte
 * combinaciones (5 etapas × 4 detalles) una por una.
 */
const DETAIL_KEYS = ["d1", "d2", "d3", "d4"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("architecture.meta");
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical: CANONICAL },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: CANONICAL,
    },
  };
}

export default async function ArchitecturePage() {
  const t = await getTranslations("architecture");

  return (
    <>
      <PublicHeader />

      <main id="contenido" className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <header>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">
              {t("label")}
            </p>
            <h1 className="display mt-3 text-3xl text-ink sm:text-4xl">{t("heading")}</h1>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-muted">{t("intro")}</p>
          </header>

          <ol className="mt-14 space-y-12">
            {STAGE_KEYS.map((key, index) => (
              <li key={key} className="relative">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[11px] text-ink-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2 className="text-lg font-semibold tracking-tight text-ink">
                    {t(`stages.${key}.title`)}
                  </h2>
                </div>

                <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
                  {t(`stages.${key}.body`)}
                </p>

                <ul className="mt-4 space-y-2 border-l border-line pl-4">
                  {DETAIL_KEYS.map((detail) => (
                    <li key={detail} className="text-[13px] leading-relaxed text-ink-subtle">
                      {t(`stages.${key}.details.${detail}`)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          {/* Nota de estado: separa lo implementado de lo que depende de una
              integración o de un acuerdo. Es la sección que evita que esta
              página se lea como una promesa. */}
          <section className="panel mt-14 p-6">
            <h2 className="text-base font-semibold text-ink">{t("status.title")}</h2>
            <dl className="mt-4 space-y-4">
              {(["works", "pilot", "requiresIntegration"] as const).map((key) => (
                <div key={key}>
                  <dt className="text-[13px] font-medium text-ink">{t(`status.${key}.term`)}</dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-ink-subtle">
                    {t(`status.${key}.body`)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="mt-12 flex flex-wrap gap-3">
            <ButtonLink href="/studio" variant="primary" size="md">
              {t("cta.studio")}
              <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href="/" variant="outline" size="md">
              {t("cta.back")}
            </ButtonLink>
          </div>
        </div>
      </main>

      <PublicFooter appName={APP_NAME} />
    </>
  );
}
