import type { RankedCandidate } from "./types";
import { isNonCommercialDomain } from "./reverseImage/resultQuality";

/**
 * ETAPA 2 del ranking: verificación visual REAL crop ↔ imagen candidata.
 * Comparación multimodal (OpenAI) de las dos imágenes: patrón y su
 * distribución, silueta, cuello/mangas/botones, logo, texto, color y detalles.
 * Sin esto, un título parecido + tienda conocida podía presentarse como
 * "mismo producto" sin haber mirado las imágenes.
 *
 * Acotado: máximo VERIFY_TOP_N candidatos, solo con imagen disponible y de
 * fuente no descartable. Memoizado por (cropHash, imagen candidata).
 */

const VERIFY_TOP_N = Math.min(
  Number(process.env.VISUAL_VERIFICATION_TOP_N) || 3,
  5
);
const VERIFY_TIMEOUT_MS = Number(process.env.VISUAL_VERIFICATION_TIMEOUT_MS) || 12_000;
const VERIFIER_VERSION = process.env.VERIFIER_VERSION || "v1";

export type VisualVerification = {
  visualSimilarity: number;
  patternSimilarity: number;
  shapeSimilarity: number;
  logoTextSimilarity: number;
  colorSimilarity: number;
  contradictions: string[];
  evidence: string[];
};

const VERIFICATION_SCHEMA = {
  name: "visual_verification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      visualSimilarity: { type: "number", minimum: 0, maximum: 1 },
      patternSimilarity: { type: "number", minimum: 0, maximum: 1 },
      shapeSimilarity: { type: "number", minimum: 0, maximum: 1 },
      logoTextSimilarity: { type: "number", minimum: 0, maximum: 1 },
      colorSimilarity: { type: "number", minimum: 0, maximum: 1 },
      contradictions: { type: "array", items: { type: "string" }, maxItems: 4 },
      evidence: { type: "array", items: { type: "string" }, maxItems: 5 },
    },
    required: [
      "visualSimilarity", "patternSimilarity", "shapeSimilarity",
      "logoTextSimilarity", "colorSimilarity", "contradictions", "evidence",
    ],
  },
} as const;

const PROMPT = `Compara estas dos imágenes de producto. La primera es un recorte real de un vídeo; la segunda es la imagen de un candidato comercial.

Evalúa si son EL MISMO PRODUCTO (no solo la misma categoría): patrón y su distribución exacta, silueta/forma, cuello, mangas, botones/cierres, costuras, logo (forma y posición), texto visible, color y proporciones.

- visualSimilarity: 0-1 global (1 = mismo producto casi seguro).
- contradictions: diferencias que DESCARTAN identidad ("las flores son rojas, no blancas").
- evidence: coincidencias concretas observadas ("misma distribución del estampado floral").
No inventes detalles que no se vean. Responde SOLO el JSON del schema.`;

function clamp01(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function strArr(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max)
    : [];
}

// Memo por crop+imagen candidata (por instancia).
const memo = new Map<string, VisualVerification | null>();
const MEMO_MAX = 500;

function memoKey(cropHash: string, candidateImageUrl: string): string {
  let h = 5381;
  for (let i = 0; i < candidateImageUrl.length; i++) {
    h = ((h << 5) + h + candidateImageUrl.charCodeAt(i)) >>> 0;
  }
  return `${VERIFIER_VERSION}:${cropHash}:${h.toString(16)}`;
}

/** Compara el crop (data URL) con la imagen del candidato (URL pública). */
export async function verifyCandidateImage(
  cropDataUrl: string,
  cropHash: string,
  candidateImageUrl: string,
  ctx: { itemId?: string } = {}
): Promise<VisualVerification | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.ENABLE_VISUAL_VERIFICATION === "false") return null;
  const key = memoKey(cropHash, candidateImageUrl);
  if (memo.has(key)) return memo.get(key) ?? null;

  const model = process.env.VISION_MODEL || "gpt-5-mini";
  const t0 = Date.now();
  let verification: VisualVerification | null = null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        ...(model.startsWith("gpt-5")
          ? { max_completion_tokens: 500, reasoning_effort: "minimal" }
          : { max_tokens: 500, temperature: 0 }),
        response_format: { type: "json_schema", json_schema: VERIFICATION_SCHEMA },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: cropDataUrl, detail: "low" } },
              { type: "image_url", image_url: { url: candidateImageUrl, detail: "low" } },
            ],
          },
        ],
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        verification = {
          visualSimilarity: clamp01(parsed.visualSimilarity),
          patternSimilarity: clamp01(parsed.patternSimilarity),
          shapeSimilarity: clamp01(parsed.shapeSimilarity),
          logoTextSimilarity: clamp01(parsed.logoTextSimilarity),
          colorSimilarity: clamp01(parsed.colorSimilarity),
          contradictions: strArr(parsed.contradictions, 4),
          evidence: strArr(parsed.evidence, 5),
        };
      }
    } else {
      console.warn("[visual-verify] verification_failed", {
        status: res.status,
        itemId: ctx.itemId ?? null,
        durationMs: Date.now() - t0,
      });
    }
  } catch (err) {
    console.warn("[visual-verify] verification_failed", {
      error: err instanceof Error ? err.name : "unknown",
      itemId: ctx.itemId ?? null,
      durationMs: Date.now() - t0,
    });
  }
  if (memo.size >= MEMO_MAX) {
    const first = memo.keys().next().value;
    if (first) memo.delete(first);
  }
  memo.set(key, verification);
  if (verification) {
    console.info("[visual-verify] visual_verification_completed", {
      itemId: ctx.itemId ?? null,
      visualSimilarity: verification.visualSimilarity,
      contradictions: verification.contradictions.length,
      durationMs: Date.now() - t0,
    });
  }
  return verification;
}

/**
 * ¿Merece este candidato gastar una verificación? Necesita imagen; las
 * fuentes no comerciales (Pinterest/blogs) solo se verifican si son exactos
 * (sirven como evidencia de imagen aunque no sean ficha de producto).
 */
export function isVerifiable(c: RankedCandidate): boolean {
  if (!c.imageUrl) return false;
  if (isNonCommercialDomain(c.domain)) return c.exactImageMatch;
  return true;
}

/**
 * Verifica los TOP candidatos (≤5) que tengan imagen. Devuelve un mapa por
 * link del candidato. Los evidentes descartes (sin imagen) no gastan llamada.
 */
export async function verifyTopCandidates(
  cropDataUrl: string,
  cropHash: string,
  ranked: RankedCandidate[],
  ctx: { itemId?: string } = {}
): Promise<Map<string, VisualVerification | null>> {
  const targets = ranked.filter(isVerifiable).slice(0, VERIFY_TOP_N);
  const out = new Map<string, VisualVerification | null>();
  await Promise.all(
    targets.map(async (c) => {
      out.set(c.link, await verifyCandidateImage(cropDataUrl, cropHash, c.imageUrl!, ctx));
    })
  );
  return out;
}
