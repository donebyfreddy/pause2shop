import { getFormatter, getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { Hero } from "@/components/landing/Hero";
import { SourceMarquee } from "@/components/landing/SourceMarquee";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { UseCases } from "@/components/landing/UseCases";
import { Capabilities } from "@/components/landing/Capabilities";
import { CtaBridge } from "@/components/landing/CtaBridge";
import { StudioSection } from "@/components/landing/StudioSection";
import { catalogService } from "@/lib/catalogService/server";
import type { ConnectorsResponse, Overview } from "@/lib/catalogService/types";

/**
 * Landing. Server component: las cifras y los nombres de fuentes salen del
 * servicio de catálogo REAL, no de constantes en el código. Si el servicio no
 * está levantado, la página se sirve igual con los valores marcados como no
 * disponibles ("—") — nunca con números inventados.
 */

const appName = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

type LandingData = {
  stats: Array<{ value: string; label: string }>;
  sourceLabels: string[];
  totalSources: number;
  verifiedSources: number;
  partnerRequired: number;
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
      { label: t("connectors.kpi.registered"), value: num(connectors?.summary.total) },
      { label: t("landing.stats.catalogProducts"), value: num(overview?.catalog.totalProducts) },
      {
        label: t("landing.stats.visualEmbeddingCoverage"),
        value: overview ? `${overview.embeddings.coverage}%` : "—",
      },
      { label: t("landing.stats.detectableCategories"), value: "8" },
    ],
    sourceLabels: (connectors?.connectors ?? []).map((c) => c.label),
    totalSources: connectors?.summary.total ?? 0,
    verifiedSources: connectors?.summary.verifiedWithFixtures ?? 0,
    partnerRequired: connectors?.summary.byLifecycle.partner_required ?? 0,
  };
}

export default async function LandingPage() {
  const data = await loadLandingData();

  return (
    <>
      <SiteHeader transparentOnTop />
      <main className="flex-1">
        <Hero stats={data.stats} />
        <SourceMarquee
          labels={data.sourceLabels}
          total={data.totalSources}
          verified={data.verifiedSources}
          partnerRequired={data.partnerRequired}
        />
        <HowItWorks />
        <UseCases />
        <Capabilities />
        <CtaBridge />
        <StudioSection />
      </main>
      <SiteFooter appName={appName} />
    </>
  );
}
