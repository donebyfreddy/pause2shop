import type { CheerioAPI } from "cheerio";
import { getScraperConfig } from "../config/scraper";
import { AiProductExtractor, aiOutcomeToLayer } from "../ai/extractor";
import {
  BrowserChallengeError,
  BrowserUnavailableError,
  type PlaywrightService,
} from "../browser/playwrightService";
import { RobotsDisallowedError } from "../connectors/base/httpClient";
import type { JobLogLevel, JobStage } from "../observability/jobLog";
import type { ConnectorSelectors } from "./dom";
import { extractWithHeuristics, extractWithSelectors } from "./dom";
import { extractJsonLd, extractMicrodata, extractOpenGraph, loadHtml } from "./structured";
import {
  mergeLayers,
  missingDesirables,
  missingEssentials,
  type ExtractionLayer,
  type ExtractionResult,
  type ExtractorKind,
} from "./types";

/**
 * Orquestador de la extracción de UNA ficha de producto.
 *
 * Aplica el orden de extracción de barato-y-fiable a caro-y-aproximado, y solo
 * escala al siguiente nivel si el anterior dejó huecos:
 *
 *   1. feed/API autorizado        (si el conector lo implementa)
 *   2. metadatos del sitemap      (lastmod, imágenes)
 *   3. JSON-LD schema.org/Product
 *   4. OpenGraph y microdata
 *   5. JSON embebido de la tienda (__NEXT_DATA__, viewPayload…)
 *   6. selectores CSS del conector
 *   7. heurísticas de DOM
 *   8. Playwright — se re-aplican 3-7 sobre el DOM renderizado
 *   9. OpenAI sobre HTML condensado — SOLO si sigue faltando algo
 *
 * Los pasos 8 y 9 son condicionales por diseño: renderizar cuesta ~2 s y una
 * llamada al modelo cuesta dinero. Una tienda con JSON-LD correcto no debe
 * pagar ninguno de los dos, y en la práctica la mayoría no los paga.
 */

/**
 * Evento de etapa. Reutiliza la lista canónica de `JobStage` para que el
 * pipeline, el descubrimiento y el bucle del job hablen todos el MISMO
 * vocabulario de etapas — el admin filtra por esa lista cerrada.
 */
export interface StageEvent {
  stage: JobStage;
  level: JobLogLevel;
  message: string;
  url?: string;
  durationMs?: number;
  retry?: number;
  metadata?: Record<string, unknown>;
}

export type StageReporter = (event: StageEvent) => void;

export interface FetchedHtml {
  html: string;
  httpStatus: number | null;
  finalUrl: string;
}

export interface ExtractionContext {
  /** Selectores CSS declarados por el conector. */
  selectors?: ConnectorSelectors;
  /** Descarga el HTML plano (normalmente `politeFetch`). */
  fetchHtml: (url: string) => Promise<FetchedHtml | null>;
  /** Feed/API autorizado del conector, si lo tiene. Es la vía preferente. */
  fetchFromFeed?: (url: string) => Promise<ExtractionLayer | null>;
  /** JSON embebido específico de la tienda. */
  extractEmbedded?: (html: string, $: CheerioAPI) => ExtractionLayer | null;
  /** Campos derivados de la URL (id, género, locale). */
  extractFromUrl?: (url: string) => ExtractionLayer | null;
  /** Metadatos que trajo el sitemap para esta URL. */
  sitemapLayer?: ExtractionLayer | null;
  /** Servicio de navegador. Si falta, el paso 8 se salta. */
  browser?: PlaywrightService | null;
  /** Extractor por IA. Si falta, el paso 9 se salta. */
  ai?: AiProductExtractor | null;
  /** Selector a esperar al renderizar (típicamente el precio). */
  waitForSelector?: string;
  /** Clave de aislamiento del contexto del navegador (id del job). */
  isolationKey?: string;
  /** Contexto neutro para la IA (categorías del conector, NO la marca). */
  aiHint?: string | null;
  /** ¿Está permitido renderizar en esta fuente? (política del conector). */
  allowBrowser?: boolean;
  /** ¿Está permitido usar IA en esta fuente? */
  allowAi?: boolean;
  report?: StageReporter;
}

/**
 * Cuántos campos deseables ausentes justifican pagar una llamada a la IA. Con
 * los esenciales completos y solo uno o dos deseables sueltos (p. ej. material)
 * no merece la pena: el producto ya es utilizable.
 */
const AI_DESIRABLE_THRESHOLD = 3;

/** Aplica los extractores de documento (pasos 3-7) sobre un HTML. */
function documentLayers(
  html: string,
  url: string,
  ctx: ExtractionContext,
  viaBrowser: boolean
): { layers: ExtractionLayer[]; $: CheerioAPI } {
  const layers: ExtractionLayer[] = [];
  // cheerio se carga UNA vez por HTML y se comparte: parsear cuatro veces el
  // mismo documento era el coste dominante del pipeline.
  const $ = loadHtml(html);

  const push = (layer: ExtractionLayer | null): void => {
    if (!layer) return;
    if (viaBrowser) {
      // Trazabilidad: el mismo extractor, pero sobre el DOM renderizado.
      layer.snippets = Object.fromEntries(
        Object.entries(layer.snippets ?? {}).map(([k, v]) => [k, `[render] ${v}`])
      );
    }
    layers.push(layer);
  };

  push(extractJsonLd($));
  push(extractOpenGraph($));
  push(extractMicrodata($));
  push(ctx.extractEmbedded?.(html, $) ?? null);
  push(extractWithSelectors($, ctx.selectors));
  // Las heurísticas MUTAN el documento (eliminan nav/footer para no leer
  // precios de recomendados), así que van al final y sobre una carga aparte.
  push(extractWithHeuristics(loadHtml(html)));

  return { layers, $ };
}

/** ¿Merece la pena escalar (a navegador o a IA) con lo que tenemos? */
function needsEscalation(layers: ExtractionLayer[], url: string): {
  essentials: string[];
  desirables: string[];
  should: boolean;
} {
  const merged = mergeLayers(url, layers);
  const essentials = missingEssentials(merged);
  const desirables = missingDesirables(merged);
  return {
    essentials,
    desirables,
    should: essentials.length > 0 || desirables.length >= AI_DESIRABLE_THRESHOLD,
  };
}

/** Estado que acumula el pipeline mientras recorre las capas. */
interface PipelineState {
  layers: ExtractionLayer[];
  warnings: string[];
  browserUsed: boolean;
  aiUsed: boolean;
  aiCostUsd: number;
  promptTokens: number;
  completionTokens: number;
  /** Mejor HTML disponible: el renderizado si lo hay, si no el plano. */
  bestHtml: string | null;
}

/** Paso 1: feed/API autorizado del conector. */
async function stepFeed(
  url: string,
  ctx: ExtractionContext,
  state: PipelineState,
  report: StageReporter
): Promise<void> {
  if (!ctx.fetchFromFeed) return;
  const t0 = Date.now();
  try {
    const feedLayer = await ctx.fetchFromFeed(url);
    if (!feedLayer) return;
    state.layers.push(feedLayer);
    report({
      stage: "navigate",
      level: "success",
      message: "datos obtenidos del feed autorizado (sin scraping)",
      url,
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    state.warnings.push(`feed no disponible: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Pasos 3-8: descarga del HTML plano y extractores de documento. */
async function stepPlainHtml(
  url: string,
  ctx: ExtractionContext,
  state: PipelineState,
  report: StageReporter
): Promise<void> {
  const t0 = Date.now();
  let fetched: FetchedHtml | null = null;
  try {
    fetched = await ctx.fetchHtml(url);
  } catch (err) {
    // Un robots disallow NO es un fallo del pipeline: es respeto, y sube.
    if (err instanceof RobotsDisallowedError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    state.warnings.push(`descarga HTML fallida: ${message}`);
    report({
      stage: "navigate",
      level: "warn",
      message: `descarga HTML fallida: ${message}`,
      url,
      durationMs: Date.now() - t0,
    });
    return;
  }
  if (!fetched?.html) return;

  state.bestHtml = fetched.html;
  report({
    stage: "navigate",
    level: "info",
    message: `HTML descargado (${Math.round(fetched.html.length / 1024)} KB, HTTP ${fetched.httpStatus ?? "?"})`,
    url,
    durationMs: Date.now() - t0,
    metadata: { redirected: fetched.finalUrl !== url ? fetched.finalUrl : undefined },
  });

  const t1 = Date.now();
  const { layers: docLayers } = documentLayers(fetched.html, url, ctx, false);
  state.layers.push(...docLayers);
  const kinds = docLayers.map((l) => l.kind);
  const gotJsonLd = kinds.includes("jsonld");
  report({
    stage: gotJsonLd ? "parse_jsonld" : "parse_dom",
    level: gotJsonLd ? "success" : "info",
    message: gotJsonLd
      ? "JSON-LD Product extraído sin IA"
      : `sin JSON-LD; extractores aplicados: ${kinds.join(", ") || "ninguno"}`,
    url,
    durationMs: Date.now() - t1,
    metadata: { extractors: kinds },
  });
}

/** Paso 9: renderizado con navegador y re-aplicación de los extractores. */
async function stepBrowser(
  url: string,
  ctx: ExtractionContext,
  state: PipelineState,
  report: StageReporter,
  missing: string[]
): Promise<void> {
  const browser = ctx.browser;
  if (!browser) return;
  const t0 = Date.now();
  try {
    const rendered = await browser.render(url, {
      isolationKey: ctx.isolationKey,
      waitForSelector: ctx.waitForSelector ?? ctx.selectors?.price,
      settleMs: 400,
    });
    state.browserUsed = true;
    state.bestHtml = rendered.html;
    report({
      stage: "navigate",
      level: "info",
      message:
        `renderizado con navegador (${Math.round(rendered.html.length / 1024)} KB` +
        `, intento ${rendered.attempts}${rendered.redirected ? ", redirigido" : ""})`,
      url,
      durationMs: rendered.durationMs,
      metadata: {
        finalUrl: rendered.redirected ? rendered.finalUrl : undefined,
        httpStatus: rendered.httpStatus,
        reason: `faltaban ${missing.join(", ")}`,
      },
    });

    const { layers: renderedLayers } = documentLayers(rendered.html, url, ctx, true);
    state.layers.push(...renderedLayers);
    report({
      stage: "parse_dom",
      level: "info",
      message: `extractores sobre DOM renderizado: ${renderedLayers.map((l) => l.kind).join(", ") || "ninguno"}`,
      url,
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    // Un muro anti-bot NO se reintenta: se propaga para que el job pare y la
    // fuente quede marcada como bloqueada. Es la verdad, no un fallo a ocultar.
    if (err instanceof BrowserChallengeError) {
      report({ stage: "navigate", level: "error", message: err.message, url, durationMs: Date.now() - t0 });
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    state.warnings.push(`render no disponible: ${message}`);
    report({
      stage: "navigate",
      level: err instanceof BrowserUnavailableError ? "warn" : "error",
      message: `render no disponible: ${message}`,
      url,
      durationMs: Date.now() - t0,
    });
  }
}

/** Paso 10: OpenAI sobre HTML condensado. Solo se llega aquí con huecos. */
async function stepAi(
  url: string,
  ctx: ExtractionContext,
  state: PipelineState,
  report: StageReporter,
  missing: string[]
): Promise<void> {
  const ai = ctx.ai;
  if (!ai || !state.bestHtml) return;

  report({
    stage: "ai_extract",
    level: "warn",
    message: `faltan ${missing.join(", ")}: activando extractor con IA`,
    url,
    metadata: { missing },
  });

  const outcome = await ai.extract({
    url,
    html: state.bestHtml,
    domain: safeHost(url),
    missingFields: missing,
    hint: ctx.aiHint ?? null,
  });

  if (outcome.error) {
    state.warnings.push(`IA: ${outcome.error}`);
    report({
      stage: "ai_extract",
      level: "error",
      message: `extracción con IA fallida: ${outcome.error}`,
      url,
      durationMs: outcome.durationMs,
    });
    return;
  }

  const layer = aiOutcomeToLayer(outcome);
  state.layers.push(layer);
  state.aiUsed = true;
  state.aiCostUsd += outcome.costUsd;
  state.promptTokens += outcome.promptTokens;
  state.completionTokens += outcome.completionTokens;

  const resolved = Object.entries(layer.fields).filter(
    ([, v]) => v != null && (!Array.isArray(v) || v.length > 0)
  ).length;
  report({
    stage: "ai_extract",
    level: "success",
    message:
      `IA: ${resolved} campos · confianza ${outcome.extraction.confidence.toFixed(2)}` +
      (outcome.cached ? " · caché" : ` · ${outcome.promptTokens + outcome.completionTokens} tokens`),
    url,
    durationMs: outcome.durationMs,
    metadata: {
      model: outcome.model,
      cached: outcome.cached,
      costUsd: outcome.costUsd,
      promptTokens: outcome.promptTokens,
      completionTokens: outcome.completionTokens,
      condensedChars: outcome.condensed.chars,
      originalChars: outcome.condensed.originalChars,
    },
  });
}

/**
 * Extrae UNA ficha aplicando las capas en orden y escalando solo si quedan
 * huecos. El cuerpo es el guion del pipeline; cada paso vive en su función.
 */
export async function extractProduct(
  url: string,
  ctx: ExtractionContext
): Promise<ExtractionResult> {
  const started = Date.now();
  const report = ctx.report ?? (() => undefined);
  const state: PipelineState = {
    layers: [],
    warnings: [],
    browserUsed: false,
    aiUsed: false,
    aiCostUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    bestHtml: null,
  };

  // 1. Feed autorizado — la vía preferente cuando la marca la publica.
  await stepFeed(url, ctx, state, report);

  // 2. Metadatos que ya trajo el sitemap.
  if (ctx.sitemapLayer) state.layers.push(ctx.sitemapLayer);

  // 3-8. HTML plano: solo si el feed no resolvió lo esencial.
  if (missingEssentials(mergeLayers(url, state.layers)).length > 0) {
    await stepPlainHtml(url, ctx, state, report);
  }

  // Campos derivados de la URL (id, género, locale).
  const urlLayer = ctx.extractFromUrl?.(url);
  if (urlLayer) state.layers.push(urlLayer);

  // 9. Navegador, si sigue faltando algo y la fuente lo permite.
  let escalation = needsEscalation(state.layers, url);
  if (
    escalation.should &&
    ctx.allowBrowser !== false &&
    getScraperConfig().playwrightEnabled
  ) {
    await stepBrowser(url, ctx, state, report, [
      ...escalation.essentials,
      ...escalation.desirables,
    ]);
  }

  // 10. IA, como último recurso.
  escalation = needsEscalation(state.layers, url);
  if (escalation.should && ctx.allowAi !== false) {
    const missing = [...escalation.essentials, ...escalation.desirables];
    if (ctx.ai) {
      await stepAi(url, ctx, state, report, missing);
    } else {
      state.warnings.push(
        `campos sin resolver (${missing.join(", ")}) y la IA no está disponible`
      );
    }
  }

  const merged = mergeLayers(url, state.layers);
  merged.warnings = [...new Set([...merged.warnings, ...state.warnings])];

  const contributing = new Set<ExtractorKind>(merged.evidence.map((e) => e.source));
  if (state.browserUsed) contributing.add("playwright");

  return {
    ...merged,
    extractorsUsed: [...contributing],
    primaryExtractor: merged.evidence.find((e) => e.field === "title")?.source ?? null,
    aiUsed: state.aiUsed,
    browserUsed: state.browserUsed,
    aiCostUsd: Math.round(state.aiCostUsd * 1_000_000) / 1_000_000,
    aiTokens: state.aiUsed
      ? { prompt: state.promptTokens, completion: state.completionTokens }
      : null,
    durationMs: Date.now() - started,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
