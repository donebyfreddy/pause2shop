import { getScraperConfig } from "../config/scraper";
import { logger } from "../observability/logger";
import { recordProviderUsage } from "../observability/metrics";
import { condenseHtml, type CondensedHtml } from "./condense";
import { estimateCostUsd, isModelPriced } from "./cost";
import {
  aiCacheKey,
  MemoryAiCache,
  type AiCacheEntry,
  type AiExtractionCache,
} from "./cache";
import { AI_JSON_SCHEMA, AiExtractionSchema, SCHEMA_VERSION, type AiExtraction } from "./schema";
import type { ExtractionLayer } from "../extraction/types";

/**
 * `AiProductExtractor` — OpenAI como extractor de campos de ÚLTIMO RECURSO.
 *
 * Reglas del diseño, todas deliberadas:
 *
 *  - Solo se invoca cuando las capas estructuradas y de DOM no han resuelto los
 *    campos esenciales. Nunca es la vía por defecto.
 *  - Nunca se envía la página completa: va HTML condensado y acotado.
 *  - La salida se valida con Zod además del `json_schema` strict de la API.
 *  - Se cachea por dominio+URL+hash del DOM+versión de schema+modelo.
 *  - Se registran tokens, duración, modelo y coste estimado de cada llamada.
 *  - La clave de API se lee SOLO en servidor; este módulo no es importable por
 *    el cliente (no lleva "use client" y solo se usa desde jobs/rutas API).
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `Eres un extractor de datos de fichas de producto de moda. Recibes HTML YA RECORTADO de una única página y devuelves JSON con los campos del esquema.

REGLAS ABSOLUTAS:
1. NO INVENTES. Si un campo no está respaldado por texto presente en el HTML, devuelve null (o lista vacía).
2. Cada campo que rellenes debe llevar una entrada en "evidence" con el recorte LITERAL del HTML que lo respalda.
3. NO deduzcas la marca por el dominio ni por la URL. La marca solo se rellena si aparece como texto o atributo en la página.
4. NO calcules, redondees ni conviertas precios. Copia el importe tal cual aparece y mantén la MONEDA ORIGINAL de la página.
5. "price" es el precio VIGENTE (el que pagaría el cliente hoy). "originalPrice" es el precio tachado/anterior, y solo si aparece explícitamente y es mayor que el vigente. Si solo hay un precio, originalPrice es null.
6. Distingue ficha de listado: si la página muestra MUCHOS productos distintos con precios distintos, productType="listing", y no rellenes precio ni título de producto. Si es una única ficha, productType="product".
7. "sizes" son tallas del producto (S, M, 38, 42…), no cantidades ni medidas de la tabla de equivalencias.
8. Una talla NO es un producto distinto: las tallas van en "sizes" y, si hay datos por combinación, en "variants".
9. "imageUrls" solo URLs de imagen del producto presentes en el HTML, en el orden en que aparecen. No inventes rutas ni completes dominios que no estén.
10. "confidence" es tu confianza global 0-1. Si el HTML está truncado o es ambiguo, bájala y explica el motivo en "warnings".
11. Responde SOLO con el JSON del esquema.`;

export interface AiExtractInput {
  url: string;
  html: string;
  /** Dominio y contexto que se le dan al modelo (sin sugerirle la marca). */
  domain: string;
  /** Qué campos faltan: enfoca al modelo y se registra en el log. */
  missingFields: string[];
  /** Categoría/segmento declarados por el conector, como contexto neutro. */
  hint?: string | null;
}

export interface AiExtractOutcome {
  extraction: AiExtraction;
  /** Modelo realmente usado. */
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
  cached: boolean;
  /** Cuando falla: motivo legible. `extraction` va vacía. */
  error: string | null;
  /** Tamaño del HTML antes y después de condensar (para el log de ahorro). */
  condensed: { chars: number; originalChars: number; truncated: boolean };
}

function emptyExtraction(url: string): AiExtraction {
  return AiExtractionSchema.parse({ canonicalUrl: url });
}

export class AiProductExtractor {
  private readonly cache: AiExtractionCache;
  /** Deduplica llamadas concurrentes a la misma clave dentro del proceso. */
  private inFlight = new Map<string, Promise<AiExtractOutcome>>();

  constructor(
    cache?: AiExtractionCache,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.cache = cache ?? new MemoryAiCache();
  }

  /** ¿Está la IA disponible ahora mismo? */
  isEnabled(): boolean {
    return getScraperConfig().aiEnabled;
  }

  /**
   * Extrae campos con IA. Nunca lanza: un fallo devuelve `error` y una
   * extracción vacía, para que el pipeline siga con lo que ya tenía.
   */
  async extract(input: AiExtractInput): Promise<AiExtractOutcome> {
    const config = getScraperConfig();
    const started = Date.now();
    const condensed = condenseHtml(input.html, config.aiMaxHtmlChars);

    const base = {
      model: config.aiModel,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      cached: false,
      condensed: {
        chars: condensed.html.length,
        originalChars: condensed.originalChars,
        truncated: condensed.truncated,
      },
    };

    if (!config.aiEnabled) {
      return {
        ...base,
        extraction: emptyExtraction(input.url),
        durationMs: Date.now() - started,
        error: "IA desactivada (SCRAPER_AI_ENABLED=false o falta OPENAI_API_KEY)",
      };
    }

    const key = aiCacheKey({ url: input.url, domHash: condensed.hash, model: config.aiModel });

    const hit = await this.cache.get(key).catch(() => null);
    if (hit) {
      logger.debug("ai_extract: acierto de caché", {
        url: input.url,
        model: hit.model,
        schemaVersion: hit.schemaVersion,
      });
      return {
        ...base,
        extraction: hit.extraction,
        model: hit.model,
        promptTokens: hit.promptTokens,
        completionTokens: hit.completionTokens,
        // Una extracción cacheada no cuesta: el coste ya se contabilizó cuando
        // se pagó. Sumarlo otra vez inflaría el coste del job.
        costUsd: 0,
        cached: true,
        durationMs: Date.now() - started,
        error: null,
      };
    }

    // Una misma URL puede llegar por dos rutas del mismo job: no la pagamos dos
    // veces por una carrera.
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = this.callModel(input, condensed, key, started, base).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async callModel(
    input: AiExtractInput,
    condensed: CondensedHtml,
    key: string,
    started: number,
    base: Omit<AiExtractOutcome, "extraction" | "durationMs" | "error">
  ): Promise<AiExtractOutcome> {
    const config = getScraperConfig();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        ...base,
        extraction: emptyExtraction(input.url),
        durationMs: Date.now() - started,
        error: "falta OPENAI_API_KEY",
      };
    }

    const userPrompt = [
      `URL: ${input.url}`,
      `Dominio: ${input.domain}`,
      input.hint ? `Contexto declarado por el conector (NO es evidencia de marca): ${input.hint}` : null,
      input.missingFields.length > 0
        ? `Campos que no se han podido extraer con datos estructurados y que interesan especialmente: ${input.missingFields.join(", ")}`
        : null,
      condensed.truncated ? "AVISO: el HTML llega truncado; si falta contexto, bájale la confianza." : null,
      "",
      "HTML condensado:",
      condensed.html,
    ]
      .filter(Boolean)
      .join("\n");

    let lastError = "";
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = 800 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoff + Math.random() * backoff * 0.5));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.navigationTimeoutMs);
      try {
        const res = await this.fetchImpl(OPENAI_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: config.aiModel,
            temperature: 0,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_schema", json_schema: AI_JSON_SCHEMA },
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          lastError = `OpenAI HTTP ${res.status}: ${body.slice(0, 300)}`;
          recordProviderUsage("openai_extract", false);
          // 4xx que no sea 429 no mejora reintentando.
          if (res.status !== 429 && res.status < 500) break;
          continue;
        }

        const payload = (await res.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
          lastError = "OpenAI devolvió una respuesta sin contenido";
          continue;
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(content);
        } catch {
          lastError = "la respuesta del modelo no es JSON válido";
          continue;
        }

        const validated = AiExtractionSchema.safeParse(parsedJson);
        if (!validated.success) {
          lastError = `la respuesta no cumple el esquema: ${validated.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`;
          continue;
        }

        const extraction = validated.data;
        if (!extraction.canonicalUrl) extraction.canonicalUrl = input.url;

        const promptTokens = payload.usage?.prompt_tokens ?? 0;
        const completionTokens = payload.usage?.completion_tokens ?? 0;
        const costUsd = estimateCostUsd(config.aiModel, promptTokens, completionTokens);
        const durationMs = Date.now() - started;

        if (!isModelPriced(config.aiModel)) {
          extraction.warnings.push(
            `coste no estimado: ${config.aiModel} no está en la tabla de tarifas (usa OPENAI_PRICE_*_PER_MTOK)`
          );
        }

        const entry: AiCacheEntry = {
          extraction,
          model: config.aiModel,
          schemaVersion: SCHEMA_VERSION,
          promptTokens,
          completionTokens,
          costUsd,
          createdAt: new Date().toISOString(),
        };
        await this.cache
          .set(key, entry, { url: input.url, domHash: condensed.hash })
          .catch(() => undefined);

        recordProviderUsage("openai_extract", true);
        logger.debug("ai_extract: extracción completada", {
          url: input.url,
          model: config.aiModel,
          promptTokens,
          completionTokens,
          costUsd,
          durationMs,
          confidence: extraction.confidence,
        });

        return {
          ...base,
          extraction,
          model: config.aiModel,
          promptTokens,
          completionTokens,
          costUsd,
          durationMs,
          error: null,
        };
      } catch (err) {
        lastError =
          err instanceof Error && err.name === "AbortError"
            ? `la llamada a OpenAI superó ${config.navigationTimeoutMs} ms`
            : err instanceof Error
              ? err.message
              : String(err);
      } finally {
        clearTimeout(timer);
      }
    }

    recordProviderUsage("openai_extract", false);
    return {
      ...base,
      extraction: emptyExtraction(input.url),
      durationMs: Date.now() - started,
      error: lastError || "la extracción con IA falló sin mensaje",
    };
  }
}

/**
 * Convierte la salida de la IA en una capa del pipeline. La evidencia que
 * declara el modelo se conserva tal cual: es lo que permite auditar después
 * por qué un campo tiene el valor que tiene.
 */
export function aiOutcomeToLayer(outcome: AiExtractOutcome): ExtractionLayer {
  const e = outcome.extraction;
  const snippets: Record<string, string> = {};
  for (const ev of e.evidence) {
    snippets[ev.field] = `IA: ${ev.snippet}`;
  }
  return {
    kind: "ai",
    // Un listado no aporta campos de producto: si el modelo dice que la página
    // es un listado, no dejamos que su título/precio entren en el producto.
    fields:
      e.productType === "listing"
        ? { productType: "listing" }
        : {
            productType: e.productType,
            sourceProductId: e.sourceProductId,
            brand: e.brand,
            title: e.title,
            model: e.model,
            description: e.description,
            category: e.category,
            subcategory: e.subcategory,
            gender: e.gender,
            color: e.color,
            secondaryColors: e.secondaryColors,
            material: e.material,
            pattern: e.pattern,
            price: e.price,
            originalPrice: e.originalPrice,
            currency: e.currency,
            availability: e.availability,
            sku: e.sku,
            gtin: e.gtin,
            sizes: e.sizes,
            variants: e.variants,
            imageUrls: e.imageUrls,
          },
    snippets,
    // La confianza declarada por el modelo modula la de la capa: un modelo que
    // avisa de que duda no debe pisar a una heurística razonable.
    confidence: Math.min(0.9, Math.max(0.2, e.confidence)),
    warnings: [
      ...e.warnings,
      ...(outcome.error ? [`IA: ${outcome.error}`] : []),
      ...(outcome.condensed.truncated ? ["IA: el HTML se truncó antes de enviarlo"] : []),
    ],
  };
}
