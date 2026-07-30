/**
 * Sonda de conectores: dice la VERDAD sobre cada fuente sin escribir nada.
 *
 *   npm run scraper:probe                 # todas las fuentes sincronizables
 *   npm run scraper:probe -- zara mango   # solo esas
 *   npm run scraper:probe -- --all        # incluye scaffolds (para ver el motivo)
 *   npm run scraper:probe -- --limit 3    # fichas por fuente (default 1)
 *   npm run scraper:probe -- --json       # salida JSON para el informe
 *
 * Para cada fuente ejecuta: robots.txt → descubrimiento → extracción de N
 * fichas, y reporta qué extractor resolvió cada campo, si hizo falta navegador
 * o IA, y cuánto costó. NO guarda productos: es diagnóstico puro, y es lo que
 * usamos para decidir el estado honesto de cada conector.
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

import { listConnectors, getConnector } from "../lib/catalogIngestion/connectors/registry";
import { closePlaywrightService } from "../lib/catalogIngestion/browser/playwrightService";

interface ProbeReport {
  id: string;
  label: string;
  lifecycle: string;
  implementation: string;
  canSync: boolean;
  robots: { ok: boolean; note: string; crawlDelaySeconds: number | null; httpStatus: number | null };
  discovery: { urls: number; strategies: string[]; sample: string[]; error: string | null };
  products: Array<{
    url: string;
    ok: boolean;
    title: string | null;
    price: number | null;
    currency: string | null;
    images: number;
    sizes: number;
    confidence: number;
    extractors: string[];
    primaryExtractor: string | null;
    aiUsed: boolean;
    browserUsed: boolean;
    aiCostUsd: number;
    missing: string[];
    warnings: string[];
    error: string | null;
    durationMs: number;
  }>;
  verdict: string;
}

const args = process.argv.slice(2);
const includeAll = args.includes("--all");
const asJson = args.includes("--json");
const limitIndex = args.indexOf("--limit");
const perSource = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 1 : 1;
const ids = args.filter((a) => !a.startsWith("--") && a !== String(perSource));

function log(...parts: unknown[]): void {
  if (!asJson) console.log(...parts);
}

async function probe(id: string): Promise<ProbeReport> {
  const connector = getConnector(id);
  if (!connector) throw new Error(`conector desconocido: ${id}`);
  const meta = connector.metadata;

  const report: ProbeReport = {
    id,
    label: meta.label,
    lifecycle: meta.lifecycle,
    implementation: meta.implementation,
    canSync: connector.canSync(),
    robots: { ok: false, note: "", crawlDelaySeconds: null, httpStatus: null },
    discovery: { urls: 0, strategies: [], sample: [], error: null },
    products: [],
    verdict: "",
  };

  const health = await connector.healthCheck();
  report.robots = {
    ok: health.status === "available",
    note: `${health.status}: ${health.note}`,
    crawlDelaySeconds: health.crawlDelaySeconds ?? null,
    httpStatus: health.httpStatus ?? null,
  };
  log(`  robots/health → ${report.robots.note}`);

  if (!report.robots.ok) {
    report.verdict =
      health.status === "disallowed"
        ? "blocked_by_robots"
        : health.status === "blocked"
          ? "blocked_or_challenged"
          : health.status === "not_checked"
            ? "pending"
            : "error";
    return report;
  }

  try {
    const discovered = await connector.discoverProductUrls({ limit: Math.max(perSource, 5) });
    report.discovery = {
      urls: discovered.urls.length,
      strategies: discovered.strategiesUsed,
      sample: discovered.urls.slice(0, 3),
      error: null,
    };
    log(
      `  descubrimiento → ${discovered.urls.length} URLs vía ${discovered.strategiesUsed.join(", ") || "ninguna estrategia efectiva"}`
    );
  } catch (err) {
    report.discovery.error = err instanceof Error ? err.message : String(err);
    log(`  descubrimiento → ERROR: ${report.discovery.error}`);
  }

  if (report.discovery.urls === 0) {
    report.verdict = report.discovery.error?.includes("robots")
      ? "blocked_by_robots"
      : "implemented_unverified";
    return report;
  }

  const urls = report.discovery.sample.slice(0, perSource);
  for (const url of urls) {
    const started = Date.now();
    try {
      const scraped = await connector.scrapeProduct({ url });
      const e = scraped.extraction;
      const missing = ["title", "price", "currency", "imageUrls"].filter((f) => {
        const v = (e as unknown as Record<string, unknown>)[f];
        return v == null || (Array.isArray(v) && v.length === 0);
      });
      report.products.push({
        url,
        ok: missing.length === 0,
        title: e.title,
        price: e.price,
        currency: e.currency,
        images: e.imageUrls.length,
        sizes: e.sizes.length,
        confidence: e.confidence,
        extractors: e.extractorsUsed,
        primaryExtractor: e.primaryExtractor,
        aiUsed: e.aiUsed,
        browserUsed: e.browserUsed,
        aiCostUsd: e.aiCostUsd,
        missing,
        warnings: e.warnings,
        error: null,
        durationMs: Date.now() - started,
      });
      log(
        `  ficha → ${missing.length === 0 ? "OK" : `INCOMPLETA (falta ${missing.join(", ")})`}` +
          ` · "${(e.title ?? "sin título").slice(0, 50)}" · ${e.price ?? "?"} ${e.currency ?? ""}` +
          ` · ${e.imageUrls.length} img · extractores: ${e.extractorsUsed.join(",")}` +
          `${e.aiUsed ? " · IA" : ""}${e.browserUsed ? " · navegador" : ""}`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.products.push({
        url,
        ok: false,
        title: null,
        price: null,
        currency: null,
        images: 0,
        sizes: 0,
        confidence: 0,
        extractors: [],
        primaryExtractor: null,
        aiUsed: false,
        browserUsed: false,
        aiCostUsd: 0,
        missing: ["title", "price", "currency", "imageUrls"],
        warnings: [],
        error: message,
        durationMs: Date.now() - started,
      });
      log(`  ficha → ERROR: ${message.slice(0, 160)}`);
    }
  }

  const good = report.products.filter((p) => p.ok);
  const challenged = report.products.some((p) => /challenge|captcha|verificación/i.test(p.error ?? ""));
  report.verdict = challenged
    ? "blocked_or_challenged"
    : good.length > 0
      ? "implemented_verified"
      : "implemented_unverified";
  return report;
}

async function main(): Promise<void> {
  const candidates = ids.length > 0
    ? ids
    : listConnectors()
        .filter((c) => includeAll || c.canSync())
        .map((c) => c.id);

  log(`Sondeando ${candidates.length} fuente(s), ${perSource} ficha(s) por fuente…\n`);

  const reports: ProbeReport[] = [];
  for (const id of candidates) {
    log(`▸ ${id}`);
    try {
      reports.push(await probe(id));
    } catch (err) {
      log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    log("");
  }

  await closePlaywrightService();

  if (asJson) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    const byVerdict = new Map<string, string[]>();
    for (const r of reports) {
      const list = byVerdict.get(r.verdict) ?? [];
      list.push(r.id);
      byVerdict.set(r.verdict, list);
    }
    console.log("═".repeat(72));
    console.log("RESUMEN HONESTO");
    console.log("═".repeat(72));
    for (const [verdict, list] of [...byVerdict.entries()].sort()) {
      console.log(`\n${verdict} (${list.length}):`);
      for (const id of list) {
        const r = reports.find((x) => x.id === id)!;
        const detail =
          r.products.length > 0
            ? `${r.products.filter((p) => p.ok).length}/${r.products.length} fichas completas` +
              (r.products.some((p) => p.aiUsed) ? ", con IA" : "") +
              (r.products.some((p) => p.browserUsed) ? ", con navegador" : "")
            : r.robots.note.slice(0, 70);
        console.log(`  · ${id.padEnd(18)} ${detail}`);
      }
    }
    const totalCost = reports
      .flatMap((r) => r.products)
      .reduce((sum, p) => sum + p.aiCostUsd, 0);
    console.log(`\nCoste estimado de IA en esta sonda: ${totalCost.toFixed(6)} USD`);
  }

  // El servicio de navegador y el pool de conexiones mantienen el proceso vivo.
  process.exit(0);

}

main().catch((err) => {
  console.error("\n\u2716 la sonda fall\u00f3:", err);
  process.exit(1);
});
