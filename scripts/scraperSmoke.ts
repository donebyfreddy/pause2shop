/**
 * Smoke test E2E del scraper contra tiendas REALES, de punta a punta:
 *
 *   npm run scraper:smoke -- ecoalf --limit 3
 *
 *   1. lanza un job de sync con límite bajo
 *   2. descubre URLs, extrae fichas y las GUARDA en el catálogo
 *   3. imprime los productos creados con su evidencia de extracción
 *   4. imprime los logs por etapas tal y como los ve el admin
 *   5. repite el sync y comprueba que NO duplica
 *
 * Es el guion de la demo y, a la vez, la verificación honesta: si una tienda
 * bloquea, lo dice y termina con el motivo, sin fingir éxito.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
loadEnv();

import { bootstrapIngestion } from "../lib/catalogIngestion/bootstrap";
import { getStore } from "../lib/catalogIngestion/catalog/store";
import { getQueue } from "../lib/catalogIngestion/jobs/queue";
import { getConnector } from "../lib/catalogIngestion/connectors/registry";
import { closePlaywrightService } from "../lib/catalogIngestion/browser/playwrightService";
import { flushJobLogs, queryJobLogs } from "../lib/catalogIngestion/observability/jobLog";
import { closePool } from "../lib/catalogIngestion/database/pool";
import { LEVEL_ORDER } from "../lib/catalogIngestion/observability/jobLog";

const args = process.argv.slice(2);
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 3 : 3;
const ids = args.filter((a) => !a.startsWith("--") && a !== String(limit));

if (ids.length === 0) {
  console.error("uso: npm run scraper:smoke -- <conector> [más conectores] [--limit N]");
  process.exit(1);
}

const STAGE_PAD = 12;

function fmt(n: number): string {
  return n.toLocaleString("es-ES");
}

async function runSync(source: string, pass: 1 | 2): Promise<string | null> {
  const store = await getStore();
  const queue = getQueue(store);
  const connector = getConnector(source);
  if (!connector) {
    console.log(`  ✖ conector desconocido: ${source}`);
    return null;
  }
  if (!connector.canSync()) {
    console.log(
      `  ✖ ${source} no puede sincronizar: ${connector.definition.notes || connector.definition.lifecycle}`
    );
    return null;
  }

  const job = await queue.enqueue({
    // El segundo pase es incremental a propósito: es como se comprueba que no
    // duplica y que solo refresca lo que ya existe.
    type: pass === 1 ? "sync_full" : "sync_incremental",
    source,
    mode: pass === 1 ? "full" : "incremental",
    limit,
  });
  console.log(`  job ${job.jobId} (${job.type}, límite ${limit}) …`);
  await queue.drain();
  await flushJobLogs();

  const finished = await store.getJob(job.jobId);
  if (!finished) {
    console.log("  ✖ el job desapareció del store");
    return null;
  }
  const p = finished.progress;
  console.log(
    `  estado: ${finished.status} · descubiertas ${fmt(p.discovered)} · extraídas ${fmt(p.fetched)}` +
      ` · nuevas ${fmt(p.new)} · actualizadas ${fmt(p.updated)} · duplicadas ${fmt(p.duplicates)}` +
      ` · ignoradas ${fmt(p.ignored)} · errores ${fmt(p.errors)}`
  );
  console.log(
    `  IA: ${p.withAi}/${p.fetched} fichas · navegador: ${p.withBrowser} · ` +
      `tokens ${fmt(p.aiTokens)} · coste estimado ${p.aiCostUsd.toFixed(6)} USD · ${finished.durationMs} ms`
  );
  if (finished.errors.length > 0) {
    console.log("  errores:");
    for (const e of finished.errors.slice(0, 4)) {
      console.log(`    · ${e.message.slice(0, 150)}`);
    }
  }
  return job.jobId;
}

async function showProducts(source: string): Promise<number> {
  const store = await getStore();
  const { items, total } = await store.listProducts({ source, limit: 10 });
  console.log(`\n  PRODUCTOS EN CATÁLOGO (${source}): ${fmt(total)}`);
  for (const p of items) {
    const price =
      p.price != null
        ? new Intl.NumberFormat("es-ES", { style: "currency", currency: p.currency || "EUR" }).format(p.price)
        : "sin precio";
    console.log(`   • ${p.title.slice(0, 62)}`);
    console.log(
      `     ${price} · ${p.brand ?? "sin marca"} · ${p.category ?? "sin categoría"}` +
        ` · ${p.images.length} img · ${p.sizes.length} tallas` +
        ` · ${p.imageEmbedding ? "embedding img" : "sin embedding img"}`
    );
    console.log(`     ${p.canonicalUrl}`);
    const meta = p.extraction;
    if (meta) {
      console.log(
        `     extractores: ${meta.extractorsUsed.join(", ")}` +
          ` · principal: ${meta.primaryExtractor}` +
          ` · confianza ${meta.confidence.toFixed(2)}` +
          `${meta.aiUsed ? ` · IA (${meta.aiModel}, ${meta.aiCostUsd.toFixed(6)} USD)` : " · SIN IA"}` +
          `${meta.browserUsed ? " · navegador" : ""}`
      );
      for (const ev of meta.evidence.filter((e) =>
        ["title", "price", "currency", "imageUrls", "color"].includes(e.field)
      )) {
        console.log(`       ${ev.field.padEnd(10)} ← ${ev.source.padEnd(11)} ${ev.snippet.slice(0, 70)}`);
      }
      if (meta.warnings.length > 0) {
        console.log(`       avisos: ${meta.warnings.slice(0, 2).join(" | ").slice(0, 140)}`);
      }
    }
  }
  return total;
}

async function showLogs(jobId: string): Promise<void> {
  const { entries, source } = await queryJobLogs({ jobId, limit: 400 });
  console.log(`\n  LOGS DEL JOB (${entries.length} eventos, origen: ${source})`);
  for (const e of [...entries].reverse()) {
    if (LEVEL_ORDER[e.level] < LEVEL_ORDER.info) continue;
    const time = new Date(e.createdAt).toLocaleTimeString("es-ES");
    const level = e.level.toUpperCase().padEnd(7);
    const stage = e.stage.toUpperCase().padEnd(STAGE_PAD);
    const duration = e.durationMs != null ? ` (${e.durationMs} ms)` : "";
    console.log(`   ${time} ${level} ${(e.connectorId ?? "-").padEnd(10)} ${stage} ${e.message}${duration}`);
  }
}

async function main(): Promise<void> {
  const report = await bootstrapIngestion();
  const store = await getStore();

  console.log("═".repeat(78));
  console.log("SMOKE TEST DEL SCRAPER");
  console.log("═".repeat(78));
  console.log(`backend de catálogo: ${store.backend}${store.backend === "file" ? "  ⚠ NO es persistencia de producción" : ""}`);
  console.log(`logs persistentes:   ${report.jobLogsPersistent ? "sí" : "NO (solo memoria)"}`);
  console.log(`caché de IA:         ${report.aiCachePersistent ? "persistente" : "solo memoria"}`);
  console.log(`extractor IA:        ${report.aiEnabled ? process.env.OPENAI_MODEL : `desactivado (${report.aiUnavailableReason})`}`);
  console.log(`navegador:           ${report.playwrightEnabled ? "habilitado" : "deshabilitado"}`);
  for (const w of report.warnings) console.log(`⚠ ${w}`);

  for (const source of ids) {
    console.log(`\n${"─".repeat(78)}\n▸ ${source}\n${"─".repeat(78)}`);

    console.log("\n PASE 1 — sync completo");
    const jobId = await runSync(source, 1);
    if (!jobId) continue;
    const totalAfterFirst = await showProducts(source);
    await showLogs(jobId);

    console.log("\n PASE 2 — sync incremental (comprobación de idempotencia)");
    const secondJobId = await runSync(source, 2);
    const totalAfterSecond = await store.countProducts(source);
    const duplicated = totalAfterSecond - totalAfterFirst;
    console.log(
      `\n  IDEMPOTENCIA: ${fmt(totalAfterFirst)} → ${fmt(totalAfterSecond)} productos ` +
        (duplicated === 0 ? "✓ sin duplicados" : `✖ se crearon ${duplicated} duplicados`)
    );
    if (secondJobId) await showLogs(secondJobId);

    const stats = await store.extractionStats(source);
    console.log(
      `\n  EXTRACCIÓN (${source}): ${stats.total} productos · sin IA ${stats.withoutAi} · con IA ${stats.withAi}` +
        ` · navegador ${stats.withBrowser} · confianza media ${stats.avgConfidence ?? "—"}` +
        ` · coste ${stats.aiCostUsd.toFixed(6)} USD`
    );
    console.log(`  por extractor principal: ${JSON.stringify(stats.byPrimaryExtractor)}`);
  }

  await flushJobLogs();
  await closePlaywrightService();
  await closePool().catch(() => undefined);
  console.log("\n✓ smoke test terminado");
  process.exit(0);
}

main().catch(async (err) => {
  console.error("\n✖ el smoke test falló:", err);
  await closePlaywrightService().catch(() => undefined);
  process.exit(1);
});
