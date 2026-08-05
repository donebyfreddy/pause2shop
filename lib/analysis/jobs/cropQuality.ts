import type { BoundingBox, DetectedItem } from "@/lib/types";
import type { CropQualityBreakdown } from "./types";

/**
 * CALIDAD DE UN ENCUADRE. Decide qué recorte representa a un producto, y eso
 * decide la calidad de TODO lo que viene después: el matching se paga una vez
 * por producto único y se paga sobre este crop.
 *
 * Antes era `área × confianza × (0.7 + 0.3 × nitidez)`. Servía para ordenar,
 * pero mezclaba en un único número cosas que conviene poder auditar por
 * separado cuando un producto sale mal identificado.
 *
 * Sobre los pesos: son los de la especificación. Sobre las señales, hay que
 * ser honesto — dos de las siete son PROXIES, no medidas:
 *
 *   - `lowOcclusion` no mide oclusión real (haría falta segmentación). Mide si
 *     la caja toca el borde del frame, que es la causa más común de producto
 *     cortado en vídeo.
 *   - `frontalView` no estima pose. Compara la proporción de la caja con la
 *     típica de su categoría: una camiseta vista de frente es más ancha que la
 *     misma camiseta de perfil.
 *
 * Están documentadas como proxies para que nadie las lea como si el sistema
 * supiera de verdad si el producto está ocluido o de frente.
 */

const WEIGHTS = {
  sharpness: 0.2,
  resolution: 0.15,
  visibility: 0.2,
  lowOcclusion: 0.15,
  frontalView: 0.1,
  logoVisibility: 0.1,
  detectorConfidence: 0.1,
} as const;

/** Proporción ancho/alto típica vista de frente, por familia de producto. */
const EXPECTED_ASPECT: Record<string, number> = {
  upper: 0.95,
  lower: 0.55,
  full_body: 0.45,
  footwear: 1.3,
  bag: 1.0,
  headwear: 1.2,
  accessory: 1.0,
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Área relativa de la caja. Se satura a 0.35 del frame: a partir de ahí más
 * área no aporta detalle del producto, solo encuadre.
 */
function visibilityOf(box: BoundingBox | null): number {
  if (!box) return 0;
  const area = clamp01(box.width) * clamp01(box.height);
  return clamp01(area / 0.35);
}

/**
 * Resolución EFECTIVA del recorte en píxeles del frame original. Un producto
 * que ocupa el 4% de un frame de 1280px da un crop de ~256px: suficiente. El
 * mismo 4% en un frame de 320px da 64px, que no sirve para nada.
 */
function resolutionOf(
  box: BoundingBox | null,
  frameWidth: number,
  frameHeight: number
): number {
  if (!box) return 0;
  const px = Math.min(box.width * frameWidth, box.height * frameHeight);
  // 224px es la entrada de CLIP: por debajo se está reescalando hacia arriba.
  return clamp01(px / 224);
}

/**
 * PROXY de oclusión: penaliza que la caja toque el borde del frame. Un
 * producto cortado por el encuadre es el caso de "no se ve entero" que más
 * aparece en vídeo, y es el único detectable sin segmentar.
 */
function lowOcclusionOf(box: BoundingBox | null): number {
  if (!box) return 0;
  const margin = 0.005;
  const touching =
    (box.x <= margin ? 1 : 0) +
    (box.y <= margin ? 1 : 0) +
    (box.x + box.width >= 1 - margin ? 1 : 0) +
    (box.y + box.height >= 1 - margin ? 1 : 0);
  return clamp01(1 - touching * 0.3);
}

/** PROXY de frontalidad: cercanía de la proporción a la típica de su slot. */
function frontalViewOf(box: BoundingBox | null, slot: string | null): number {
  if (!box || box.height <= 0) return 0.5;
  const expected = slot ? EXPECTED_ASPECT[slot] : undefined;
  if (!expected) return 0.5;
  const aspect = box.width / box.height;
  const ratio = aspect > expected ? expected / aspect : aspect / expected;
  return clamp01(ratio);
}

export function cropQuality(args: {
  box: BoundingBox | null;
  item: DetectedItem;
  /** Nitidez medida sobre la región (0-1). */
  sharpness: number;
  /** Slot del producto (`upper`, `footwear`…) para el proxy de frontalidad. */
  slot: string | null;
  frameWidth?: number;
  frameHeight?: number;
}): { score: number; breakdown: CropQualityBreakdown } {
  const { box, item, sharpness, slot } = args;
  const frameWidth = args.frameWidth ?? 1280;
  const frameHeight = args.frameHeight ?? 720;

  const breakdown: CropQualityBreakdown = {
    sharpness: clamp01(sharpness),
    resolution: resolutionOf(box, frameWidth, frameHeight),
    visibility: visibilityOf(box),
    lowOcclusion: lowOcclusionOf(box),
    frontalView: frontalViewOf(box, slot),
    // Un logo visible hace el crop MÁS valioso para identificar el producto:
    // es la señal que convierte "una camiseta blanca" en "esta camiseta".
    logoVisibility: item.logo_visible || item.visible_brand ? 1 : 0.3,
    detectorConfidence: clamp01(item.confidence),
  };

  const score =
    breakdown.sharpness * WEIGHTS.sharpness +
    breakdown.resolution * WEIGHTS.resolution +
    breakdown.visibility * WEIGHTS.visibility +
    breakdown.lowOcclusion * WEIGHTS.lowOcclusion +
    breakdown.frontalView * WEIGHTS.frontalView +
    breakdown.logoVisibility * WEIGHTS.logoVisibility +
    breakdown.detectorConfidence * WEIGHTS.detectorConfidence;

  return { score: clamp01(score), breakdown };
}
