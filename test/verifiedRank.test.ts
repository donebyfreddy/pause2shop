import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVerifiedMatch,
  componentScores,
  finalMatchConfidence,
  isShoppingSourced,
  verifiedMatchType,
} from "../lib/visualSearch/verifiedRank";
import { normalizeSection } from "../lib/visualSearch/reverseImage/providers";
import type { RankedCandidate } from "../lib/visualSearch/types";
import type { VisualVerification } from "../lib/visualSearch/visualVerification";
import type { DetectedItem } from "../lib/types";

const THRESHOLDS = { exact: 0.9, nearExact: 0.7, similar: 0.3 };

function candidate(partial: Partial<RankedCandidate>): RankedCandidate {
  return {
    source: "searchapi_google_lens",
    title: "Camisa hawaiana negra floral",
    link: "https://store.test/p/1",
    store: "Store",
    domain: "store.test",
    imageUrl: "https://img.test/p1.jpg",
    price: 49.9,
    currency: "EUR",
    brand: null,
    position: 1,
    exactImageMatch: false,
    queryUsed: null,
    score: 90,
    matchType: "similar",
    scoreBreakdown: { lens_top_position: 45, same_color: 15, trusted_store: 30 },
    ...partial,
  };
}

function verification(partial: Partial<VisualVerification>): VisualVerification {
  return {
    visualSimilarity: 0.9,
    patternSimilarity: 0.9,
    shapeSimilarity: 0.9,
    logoTextSimilarity: 0.5,
    colorSimilarity: 0.95,
    contradictions: [],
    evidence: ["misma distribución del estampado floral"],
    ...partial,
  };
}

const ITEM: DetectedItem = {
  name: "camisa hawaiana negra",
  category: "camisa",
  description: "",
  search_query_es: "",
  alternative_queries: [],
  verified_provider_queries: [],
  confidence: 0.95,
};

// --- requestMode + image objeto ---------------------------------------------------

test("normalizeSection conserva requestMode aunque la sección sea otra", () => {
  const out = normalizeSection(
    [{ title: "Producto", link: "https://x.test/p" }],
    "searchapi_google_lens",
    "visual_matches", // sección de la RESPUESTA
    "q enviada",
    "products" // modo de la PETICIÓN
  );
  assert.equal(out[0].requestMode, "products");
  assert.equal(out[0].responseSection, "visual_matches");
});

test("parseImageUrl: image como OBJETO {link} ya no se pierde", () => {
  const out = normalizeSection(
    [
      {
        title: "Con imagen objeto",
        link: "https://x.test/p",
        image: { link: "https://img.test/obj.jpg", width: 800, height: 600 },
      },
    ],
    "serpapi_google_lens",
    "visual_matches",
    null,
    "all"
  );
  assert.equal(out[0].imageUrl, "https://img.test/obj.jpg");
});

// --- ranking normalizado -----------------------------------------------------------

test("el merchant NO puede ganar a la similitud visual", () => {
  // Candidato A: tienda desconocida pero verificado visualmente idéntico.
  const a = candidate({
    link: "https://tienda-rara.test/p",
    domain: "tienda-rara.test",
    scoreBreakdown: { lens_top_position: 45, same_color: 15, unknown_store: -20 },
  });
  // Candidato B: Amazon, pero la verificación dice que NO es el mismo producto.
  const b = candidate({
    link: "https://amazon.es/dp/X",
    domain: "amazon.es",
    scoreBreakdown: { lens_high_position: 25, trusted_store: 30 },
  });
  const confA = finalMatchConfidence(a, verification({ visualSimilarity: 0.95 }));
  const confB = finalMatchConfidence(
    b,
    verification({ visualSimilarity: 0.2, contradictions: ["el estampado es distinto"] })
  );
  assert.ok(confA > confB, "la verificación visual debe dominar sobre el merchant");
});

test("exact EXIGE verificación visual fuerte + ficha comercial", () => {
  // Caso exacto realista: imagen idéntica + marca/texto/atributos coinciden.
  const c = candidate({
    exactImageMatch: true,
    scoreBreakdown: {
      exact_image_match: 100,
      trusted_store: 30,
      same_brand: 50,
      visible_text_match: 40,
      same_color: 15,
      same_category: 10,
    },
  });
  // Con verificación fuerte y confianza alta → exact.
  const strongConf = finalMatchConfidence(c, verification({ visualSimilarity: 0.95 }));
  assert.equal(
    verifiedMatchType(strongConf, verification({ visualSimilarity: 0.95 }), c, THRESHOLDS),
    "exact"
  );
  // SIN verificación → como máximo near_exact aunque sea exact_image.
  const noVerifyConf = finalMatchConfidence(c, null);
  const t = verifiedMatchType(Math.max(noVerifyConf, 0.92), null, c, THRESHOLDS);
  assert.notEqual(t, "exact");
});

test("exact_image_source en Pinterest no es exact_product_match", () => {
  const pin = candidate({
    link: "https://www.pinterest.com/pin/1",
    domain: "pinterest.com",
    price: null,
    store: null,
    exactImageMatch: true,
    scoreBreakdown: { exact_image_match: 100 },
  });
  const conf = finalMatchConfidence(pin, verification({ visualSimilarity: 0.95 }));
  // Similitud perfecta pero SIN ficha comercial → nunca "exact".
  assert.notEqual(verifiedMatchType(Math.max(conf, 0.92), verification({}), pin, THRESHOLDS), "exact");
});

test("un candidato de shopping textual nunca pasa de similar", () => {
  const shop = candidate({
    source: "dataforseo_google_shopping",
    queryUsed: "camisa negra",
    scoreBreakdown: { same_color: 15, same_category: 10, trusted_store: 30, has_price: 8 },
  });
  assert.equal(isShoppingSourced(shop), true);
  const conf = finalMatchConfidence(shop, verification({ visualSimilarity: 0.9 }));
  assert.equal(verifiedMatchType(Math.max(conf, 0.95), verification({}), shop, THRESHOLDS), "similar");
});

test("las contradicciones observadas hunden la confianza", () => {
  const c = candidate({});
  const clean = finalMatchConfidence(c, verification({}));
  const contradicted = finalMatchConfidence(
    c,
    verification({ visualSimilarity: 0.9, contradictions: ["manga larga, no corta", "flores rojas"] })
  );
  assert.ok(contradicted < clean);
  assert.ok(contradicted <= 0.5);
});

test("buildVerifiedMatch reordena por confianza verificada y adjunta evidencia visual", () => {
  const weakFirst = candidate({
    link: "https://a.test/p",
    score: 120, // gana en la etapa 1…
    scoreBreakdown: { lens_top_position: 45, trusted_store: 30, same_color: 15 },
  });
  const verifiedSecond = candidate({
    link: "https://b.test/p",
    score: 80,
    scoreBreakdown: { lens_high_position: 25, same_color: 15 },
  });
  const verifications = new Map<string, VisualVerification | null>([
    ["https://a.test/p", verification({ visualSimilarity: 0.15, contradictions: ["otro estampado"] })],
    ["https://b.test/p", verification({ visualSimilarity: 0.95 })],
  ]);
  const match = buildVerifiedMatch(ITEM, [weakFirst, verifiedSecond], verifications);
  assert.ok(match);
  // …pero la verificación reordena: gana el visualmente idéntico.
  assert.equal(match.ranked_candidates[0].link, "https://b.test/p");
  assert.ok(match.evidence.some((e) => e.includes("estampado floral")));
  assert.ok(match.match_confidence > 0.5);
});

test("componentScores degrada la señal Lens de resultados llegados por texto", () => {
  const textual = candidate({ queryUsed: "camisa", scoreBreakdown: { lens_top_position: 45 } });
  const visual = candidate({ queryUsed: null, scoreBreakdown: { lens_top_position: 45 } });
  assert.ok(
    componentScores(textual).lensProviderScore < componentScores(visual).lensProviderScore
  );
});
