import { isDatabaseConfigured } from "./database/pool";
import { logger } from "./observability/logger";
import { setJobLogSink, hasJobLogSink } from "./observability/jobLog";
import { installSharedAiCache } from "./connectors/base/BaseConnector";
import { LayeredAiCache, MemoryAiCache } from "./ai/cache";
import { aiUnavailableReason, getScraperConfig } from "./config/scraper";

/**
 * Arranque del subsistema de ingesta.
 *
 * Conecta las piezas que dependen de la base de datos (sink de logs, caché de
 * IA persistente) SOLO cuando hay una base de datos real. Sin ella el scraper
 * sigue funcionando completo, pero se dice en voz alta: los logs viven en
 * memoria y la caché de IA no sobrevive al reinicio.
 *
 * Es idempotente: se invoca desde cada ruta que arranca trabajo, y las llamadas
 * posteriores no hacen nada.
 */

let bootstrapped = false;
let report: BootstrapReport | null = null;

export interface BootstrapReport {
  /** ¿Los logs de job se persisten, o solo viven en memoria? */
  jobLogsPersistent: boolean;
  /** ¿La caché de IA sobrevive al reinicio? */
  aiCachePersistent: boolean;
  aiEnabled: boolean;
  aiUnavailableReason: string | null;
  playwrightEnabled: boolean;
  /** Avisos honestos que el admin muestra tal cual. */
  warnings: string[];
}

export async function bootstrapIngestion(): Promise<BootstrapReport> {
  if (bootstrapped && report) return report;

  const warnings: string[] = [];
  const config = getScraperConfig();
  let jobLogsPersistent = false;
  let aiCachePersistent = false;

  if (isDatabaseConfigured()) {
    try {
      const { PostgresJobLogSink } = await import("./observability/postgresJobLogSink");
      const sink = new PostgresJobLogSink();
      // Una escritura vacía no toca la base de datos, así que probamos con una
      // consulta mínima: mejor descubrir aquí que la tabla no existe.
      await sink.query({ limit: 1 });
      setJobLogSink(sink);
      jobLogsPersistent = true;
    } catch (err) {
      warnings.push(
        `los logs de ingesta NO se están persistiendo (${
          err instanceof Error ? err.message : String(err)
        }); ¿falta ejecutar \`npm run db:migrate\`?`
      );
    }

    try {
      const { PostgresAiCache } = await import("./ai/postgresCache");
      const persistent = new PostgresAiCache();
      await persistent.stats();
      installSharedAiCache(new LayeredAiCache(persistent));
      aiCachePersistent = true;
    } catch (err) {
      installSharedAiCache(new MemoryAiCache());
      warnings.push(
        `la caché de extracciones por IA es solo en memoria (${
          err instanceof Error ? err.message : String(err)
        }): se volverá a pagar por las mismas fichas tras un reinicio`
      );
    }
  } else {
    warnings.push(
      "sin DATABASE_URL válida (postgres://): los logs de ingesta viven en memoria y " +
        "la caché de IA no sobrevive al reinicio. El catálogo usa el store de fichero, " +
        "que NO es persistencia de producción."
    );
  }

  // Precalentado del modelo de embeddings, SIN esperarlo.
  //
  // Medido: la primera búsqueda tras arrancar tardaba 6,8 s y las siguientes
  // 0,5 s — la diferencia es cargar CLIP (ONNX, ~90 MB) dentro de la petición
  // del usuario. Arrancar la carga aquí traslada ese coste al arranque del
  // proceso, donde no hay nadie mirando una tarjeta girar.
  //
  // Deliberadamente NO se hace `await`: bloquear el bootstrap retrasaría todo
  // lo demás, y si el modelo no está disponible el provider ya degrada a hash
  // por su cuenta. Un fallo aquí no puede impedir el arranque.
  void import("./embeddings/index")
    .then(({ getEmbeddingProvider }) => getEmbeddingProvider())
    .then((provider) => {
      logger.info("embeddings: modelo precalentado", {
        dimension: provider.dimension(),
      });
    })
    .catch((err) => {
      logger.warn("embeddings: fallo al precalentar (se cargará bajo demanda)", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

  const aiReason = aiUnavailableReason();
  if (aiReason) warnings.push(`extractor por IA no disponible: ${aiReason}`);
  if (!config.playwrightEnabled) {
    warnings.push("renderizado con navegador desactivado (SCRAPER_PLAYWRIGHT_ENABLED=false)");
  }

  report = {
    jobLogsPersistent,
    aiCachePersistent,
    aiEnabled: config.aiEnabled,
    aiUnavailableReason: aiReason,
    playwrightEnabled: config.playwrightEnabled,
    warnings,
  };
  bootstrapped = true;

  logger.info("ingesta inicializada", {
    jobLogsPersistent,
    aiCachePersistent,
    aiEnabled: config.aiEnabled,
    playwrightEnabled: config.playwrightEnabled,
    warnings: warnings.length,
  });
  return report;
}

/** Último informe de arranque, sin forzar la inicialización. */
export function bootstrapReport(): BootstrapReport | null {
  return report;
}

/** Solo para tests. */
export function resetBootstrapForTests(): void {
  bootstrapped = false;
  report = null;
  if (hasJobLogSink()) setJobLogSink(null);
  installSharedAiCache(new MemoryAiCache());
}
