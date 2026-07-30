import type { ConnectorSpec } from "../base/types";

/**
 * Constructores de specs con valores por defecto conservadores. El catálogo de
 * fuentes (sources/*.ts) es DATOS, no código: así añadir una tienda es una
 * entrada declarativa y no una clase nueva.
 */

type SpecInput = Partial<ConnectorSpec> &
  Pick<ConnectorSpec, "id" | "label" | "brand" | "homeUrl">;

const BASE: Omit<ConnectorSpec, "id" | "label" | "brand" | "homeUrl"> = {
  group: null,
  sitemapUrls: [],
  productUrlPattern: "$^", // no matchea nada: obliga a declararlo explícitamente
  productIdPattern: null,
  region: "EU",
  markets: ["ES"],
  tier: "fast_fashion",
  segments: ["women", "men"],
  categories: ["clothing"],
  implementation: "declarative",
  access: "sitemap_jsonld",
  compliance: "public_structured_data",
  lifecycle: "ready_to_configure",
  verification: "live_unverified",
  syncModes: ["full", "incremental"],
  requiresEnv: [],
  notes: "",
  docsUrl: null,
  // --- Scraper modular ---
  productUrlPatterns: [],
  // Por defecto: sitemap (declarado o descubierto vía robots.txt). Las fuentes
  // que necesiten recorrer categorías lo declaran explícitamente.
  discoveryStrategies: [{ kind: "sitemap" }],
  selectors: null,
  robotsPolicy: "respect",
  extraction: {
    // Renderizar e invocar a la IA están PERMITIDOS por defecto, pero el
    // pipeline solo los usa si los datos estructurados no bastan.
    allowBrowser: true,
    allowAi: true,
  },
  requiresAgreement: false,
  enabled: true,
};

/**
 * Fuente con implementación real por el motor genérico (sitemap/robots +
 * JSON-LD). `lifecycle: ready_to_configure` y `verification: live_unverified`
 * por defecto: el código existe y es real, pero no afirmamos haberlo validado
 * contra esa tienda concreta hasta que un test con fixtures lo demuestre.
 */
export function declarative(input: SpecInput): ConnectorSpec {
  return { ...BASE, ...input };
}

/** Fuente con subclase propia verificada contra fixtures reales. */
export function bespoke(input: SpecInput): ConnectorSpec {
  return {
    ...BASE,
    implementation: "bespoke",
    lifecycle: "implemented",
    verification: "fixtures",
    ...input,
  };
}

/**
 * Fuente reservada sin vía de acceso legítima activa. `notes` es obligatorio:
 * el admin muestra literalmente qué falta.
 *
 * `requiresAgreement` se deriva del modo de cumplimiento: si hace falta firmar
 * algo, el estado efectivo es `partner_required` y no sincroniza nunca.
 */
export function scaffold(
  input: SpecInput & Pick<ConnectorSpec, "notes" | "compliance" | "access" | "lifecycle">
): ConnectorSpec {
  const requiresAgreement =
    input.requiresAgreement ??
    (input.compliance === "partner_agreement" || input.compliance === "affiliate_agreement");
  return {
    ...BASE,
    implementation: "scaffold",
    verification: "none",
    syncModes: [],
    discoveryStrategies: [],
    // Un scaffold no renderiza ni llama al modelo: no hay vía de acceso
    // todavía, y gastar tokens en eso es tirar dinero.
    extraction: { allowBrowser: false, allowAi: false },
    ...input,
    requiresAgreement,
  };
}
