import { Suspense, cache } from "react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PublicHeader } from "@/components/shell/PublicHeader";
import { PublicFooter } from "@/components/shell/PublicFooter";
import { ScrollProgress } from "@/components/motion";
import { HeroSection } from "@/components/landing/HeroSection";
import { TrustStrip } from "@/components/landing/TrustStrip";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { InteractiveFrameDemo } from "@/components/landing/demo/InteractiveFrameDemo";
import { IntegrationDiagram } from "@/components/landing/IntegrationDiagram";
import { ConfidenceSection } from "@/components/landing/ConfidenceSection";
import { UseCases } from "@/components/landing/UseCases";
import { Capabilities } from "@/components/landing/Capabilities";
import { SourceMarquee } from "@/components/landing/SourceMarquee";
import { SecuritySection } from "@/components/landing/SecuritySection";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { catalogService } from "@/lib/catalogService/server";
import type { ConnectorsResponse, Overview } from "@/lib/catalogService/types";
import { requestMetadataBase, socialCardUrl } from "@/lib/requestMetadata";
import { APP_NAME } from "@/lib/seo";

/**
 * Landing pública.
 *
 * Server component. Las cifras y los nombres de fuentes salen del servicio de
 * catálogo REAL, no de constantes: si el servicio no responde, la página se
 * sirve igual con los valores como no disponibles (`—`), nunca con números
 * inventados. Ese principio venía de la versión anterior y se mantiene.
 *
 * El recorrido es una narración, no un catálogo de features:
 *
 *   promesa + demo  →  prueba  →  cómo funciona  →  demuéstralo  →  cómo encaja
 *   →  qué pasa si duda  →  para qué sirve  →  qué hay dentro  →  de dónde sale
 *   →  cómo se opera  →  pruébalo
 *
 * El estudio ya NO se monta aquí. Lo hacía la versión auditada y tenía dos
 * costes: la landing terminaba en un panel técnico —justo la impresión que hay
 * que evitar— y arrastraba el reproductor y los hooks de captura a una página
 * que la mayoría solo va a leer. El CTA final lleva a `/studio`, que es la
 * pantalla real y completa.
 */

export async function generateMetadata(): Promise<Metadata> {
  const [t, metadataBase] = await Promise.all([
    getTranslations("landing.meta"),
    requestMetadataBase(),
  ]);
  const canonical = new URL("/", metadataBase).toString();
  return {
    title: t("title"),
    description: t("description"),
    alternates: { canonical },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: canonical,
      images: [socialCardUrl(metadataBase)],
    },
  };
}

type LandingData = {
  stats: Array<{ value: string; label: string }>;
  sourceLabels: string[];
  totalSources: number;
  verifiedSources: number;
  partnerRequired: number;
  serviceOk: boolean;
};

/**
 * Datos del servicio de catálogo, memoizados POR PETICIÓN con `cache()`.
 *
 * Dos componentes distintos los necesitan (la franja de confianza y la cinta de
 * fuentes) y cada uno vive tras su propio `Suspense`. Sin `cache()` se
 * ejecutarían las consultas dos veces por visita; con él, la primera llamada
 * hace el trabajo y la segunda recibe la misma promesa.
 *
 * Nota importante: `catalogService` habla con el motor de ingesta EN PROCESO
 * (`internal://catalog`), no por HTTP. Eso significa que el `revalidate` que
 * aceptaba esta llamada no cacheaba nada —no hay `fetch` que Next pueda
 * interceptar— y cada visita reejecutaba las consultas. Se ha quitado el
 * parámetro para no dar una falsa sensación de caché. La memoización real entre
 * peticiones tendría que vivir en `lib/catalogService`, que es de otra parte del
 * sistema.
 */
const loadLandingData = cache(async (): Promise<LandingData> => {
  const [overviewRes, connectorsRes, t, format] = await Promise.all([
    catalogService<Overview>("/overview"),
    catalogService<ConnectorsResponse>("/connectors"),
    getTranslations(),
    getFormatter(),
  ]);

  const overview = overviewRes.ok ? overviewRes.data : null;
  const connectors = connectorsRes.ok ? connectorsRes.data : null;
  const num = (value: number | undefined) => (value == null ? "—" : format.number(value));

  return {
    stats: [
      { label: t("landing.trust.stats.sources"), value: num(connectors?.summary.total) },
      { label: t("landing.trust.stats.products"), value: num(overview?.catalog.totalProducts) },
      {
        label: t("landing.trust.stats.embeddingCoverage"),
        value: overview ? `${overview.embeddings.coverage}%` : "—",
      },
      { label: t("landing.trust.stats.categories"), value: "8" },
    ],
    sourceLabels: (connectors?.connectors ?? []).map((c) => c.label),
    totalSources: connectors?.summary.total ?? 0,
    verifiedSources: connectors?.summary.verifiedWithFixtures ?? 0,
    partnerRequired: connectors?.summary.byLifecycle.partner_required ?? 0,
    serviceOk: overviewRes.ok && connectorsRes.ok,
  };
});

/* --- Islas que dependen del servicio de catálogo --------------------------
 *
 * Van cada una tras su propio `Suspense` para que NINGUNA bloquee el shell.
 * Motivo medido: el servicio de catálogo tardaba ~3 s, y como la página lo
 * esperaba antes de emitir una sola etiqueta, el TTFB de `/` era de 3,04 s
 * mientras el resto de rutas respondía en ~10 ms. El hero no necesita esos
 * datos para nada: son cuatro números de una franja y una lista de nombres.
 */

async function TrustStripData() {
  const { stats } = await loadLandingData();
  return <TrustStrip stats={stats} />;
}

async function SourceMarqueeData() {
  const data = await loadLandingData();
  return (
    <SourceMarquee
      labels={data.sourceLabels}
      total={data.totalSources}
      verified={data.verifiedSources}
      partnerRequired={data.partnerRequired}
    />
  );
}

export default function LandingPage() {
  return (
    <>
      <ScrollProgress />
      <PublicHeader anchors />

      <main id="contenido" className="flex-1">
        <HeroSection />
        {/* Skeleton con la MISMA rejilla y altura: al llegar los números no hay
            salto de layout (CLS medido: 0). */}
        <Suspense fallback={<TrustStrip />}>
          <TrustStripData />
        </Suspense>
        <HowItWorks />
        <InteractiveFrameDemo />
        <IntegrationDiagram />
        <ConfidenceSection />
        <UseCases />
        <Capabilities />
        <Suspense fallback={null}>
          <SourceMarqueeData />
        </Suspense>
        <SecuritySection />
        <FinalCTA />
      </main>

      <PublicFooter appName={APP_NAME} />
    </>
  );
}
