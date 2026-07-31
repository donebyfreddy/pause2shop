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
import { APP_NAME, absoluteUrl } from "@/lib/seo";

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

const CANONICAL = absoluteUrl("/");

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.meta");
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

type LandingData = {
  stats: Array<{ value: string; label: string }>;
  sourceLabels: string[];
  totalSources: number;
  verifiedSources: number;
  partnerRequired: number;
  serviceOk: boolean;
};

async function loadLandingData(): Promise<LandingData> {
  // Ventana de revalidación corta: la landing no necesita datos al segundo,
  // pero tampoco queremos cachear un "servicio caído" durante minutos.
  const [overviewRes, connectorsRes, t, format] = await Promise.all([
    catalogService<Overview>("/overview", { revalidate: 30 }),
    catalogService<ConnectorsResponse>("/connectors", { revalidate: 30 }),
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
}

export default async function LandingPage() {
  const data = await loadLandingData();

  return (
    <>
      <ScrollProgress />
      <PublicHeader anchors />

      <main id="contenido" className="flex-1">
        <HeroSection />
        <TrustStrip stats={data.stats} />
        <HowItWorks />
        <InteractiveFrameDemo />
        <IntegrationDiagram />
        <ConfidenceSection />
        <UseCases />
        <Capabilities />
        <SourceMarquee
          labels={data.sourceLabels}
          total={data.totalSources}
          verified={data.verifiedSources}
          partnerRequired={data.partnerRequired}
        />
        <SecuritySection />
        <FinalCTA />
      </main>

      <PublicFooter appName={APP_NAME} serviceOk={data.serviceOk} />
    </>
  );
}
