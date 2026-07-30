import {
  DeclarativeConnector,
  ScaffoldConnector,
  type CatalogConnector,
} from "./base/BaseConnector";
import type { ConnectorMetadata, ConnectorSpec } from "./base/types";
import { SOURCE_SPECS, assertSourcesValid } from "./sources/index";
import { ZaraConnector } from "./zara/index";
import { MangoConnector } from "./mango/index";
import { HmConnector } from "./hm/index";
import { AsosConnector } from "./asos/index";
import { ZalandoConnector } from "./zalando/index";
import { logger } from "../observability/logger";

/**
 * Registro de conectores.
 *
 * El catálogo de fuentes vive en `sources/` como DATOS; aquí solo se decide qué
 * clase materializa cada spec:
 *
 *  - `bespoke`     → subclase registrada en BESPOKE (extracción específica)
 *  - `declarative` → DeclarativeConnector (sitemap/robots + JSON-LD)
 *  - `scaffold`    → ScaffoldConnector (o subclase si ya hay hueco reservado)
 *
 * Instancias únicas por proceso: el circuit breaker, la caché de robots y los
 * sitemaps descubiertos viven en la instancia.
 */

/** Subclases con extracción específica, por id de spec. */
const BESPOKE: Record<string, new () => CatalogConnector> = {
  zara: ZaraConnector,
  mango: MangoConnector,
  hm: HmConnector,
};

/** Scaffolds con clase propia reservada (ahí irá el cliente del feed/API). */
const SCAFFOLD_CLASSES: Record<string, new () => CatalogConnector> = {
  asos: AsosConnector,
  zalando: ZalandoConnector,
};

const connectors = new Map<string, CatalogConnector>();

function instantiate(spec: ConnectorSpec): CatalogConnector {
  const Bespoke = BESPOKE[spec.id];
  if (Bespoke) return new Bespoke();
  const Scaffold = SCAFFOLD_CLASSES[spec.id];
  if (Scaffold) return new Scaffold();
  if (spec.implementation === "scaffold") return new ScaffoldConnector(spec);
  return new DeclarativeConnector(spec);
}

function ensureRegistry(): Map<string, CatalogConnector> {
  if (connectors.size === 0) {
    assertSourcesValid();
    for (const spec of SOURCE_SPECS) {
      connectors.set(spec.id, instantiate(spec));
    }
    logger.debug("registro de conectores inicializado", {
      total: connectors.size,
      syncable: [...connectors.values()].filter((c) => c.canSync()).length,
    });
  }
  return connectors;
}

export function getConnector(id: string): CatalogConnector | null {
  return ensureRegistry().get(id) ?? null;
}

export function listConnectors(): CatalogConnector[] {
  return [...ensureRegistry().values()];
}

/** Metadatos de todas las fuentes (lo que consume el admin). */
export function listConnectorMetadata(): ConnectorMetadata[] {
  return listConnectors().map((c) => c.metadata);
}

/** ¿Puede esta fuente lanzar un sync ahora mismo? */
export function canSync(id: string): boolean {
  return getConnector(id)?.canSync() ?? false;
}

/** Ids que aceptan jobs de sync (implementación real + credenciales presentes). */
export function syncableConnectorIds(): string[] {
  return listConnectors()
    .filter((c) => c.canSync())
    .map((c) => c.id);
}

/** Resumen agregado del registro para el overview del admin. */
export function connectorRegistrySummary(): {
  total: number;
  byLifecycle: Record<string, number>;
  byAccess: Record<string, number>;
  byCompliance: Record<string, number>;
  byTier: Record<string, number>;
  syncable: number;
  verifiedWithFixtures: number;
} {
  const metas = listConnectorMetadata();
  const tally = (key: (m: ConnectorMetadata) => string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const m of metas) out[key(m)] = (out[key(m)] ?? 0) + 1;
    return out;
  };
  return {
    total: metas.length,
    byLifecycle: tally((m) => m.lifecycle),
    byAccess: tally((m) => m.access),
    byCompliance: tally((m) => m.compliance),
    byTier: tally((m) => m.tier),
    syncable: metas.filter((m) => m.canSync).length,
    verifiedWithFixtures: metas.filter((m) => m.verification === "fixtures").length,
  };
}

/** Solo para tests: fuerza la reconstrucción del registro. */
export function resetRegistryForTests(): void {
  connectors.clear();
}
