/**
 * Datos de la demo del hero: escena editorial con producto real.
 *
 * Sustituye a las formas genéricas de `demoScene.ts` en el hero (esa sigue
 * alimentando la demo interactiva de más abajo, que es SVG y cuenta otra
 * historia). Aquí hay tres recortes fotográficos —abrigo, bolso y zapatos—
 * compuestos como un bodegón de ecommerce.
 *
 * Tres decisiones que gobiernan el resto del archivo:
 *
 *  1. **Una sola fuente para la posición y para la caja de detección.** La caja
 *     NO se escribe a mano: se deriva de dónde se coloca el recorte y de su
 *     relación de aspecto real (`deriveBox`). Escribirlas por separado es la
 *     forma segura de que se desalineen en cuanto alguien mueva un producto un
 *     2%, y el desajuste solo se ve en algunos anchos de pantalla.
 *  2. **Todo relativo.** Coordenadas en % de la escena, nunca píxeles: el
 *     mockup cambia de tamaño en cada breakpoint y las cajas tienen que ir
 *     pegadas al producto en todos.
 *  3. **Nada que no se pueda sostener.** Sin marcas, sin URL de compra y sin
 *     precio en lo que no supera el umbral. Son fichas de catálogo DEMO y la UI
 *     lo dice; por eso el CTA es "ver coincidencia" y no "comprar".
 */

/** Caja en proporción de la escena (0-1 sobre cada eje). */
export type RelativeBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HeroDemoAccent = "violet" | "cyan" | "green";

/** Estado editorial. Mismo vocabulario que el resto de la landing. */
export type HeroDemoStatus = "published" | "withheld";

export type HeroDemoProductId = "coat" | "bag" | "shoes";

export interface HeroDemoMatch {
  /** Sufijo de clave i18n bajo `landing.heroDemo.products`. */
  productId: HeroDemoProductId;
  /** Clave i18n bajo `landing.demo.categories`. */
  category: "clothing" | "bags_accessories" | "footwear";
  /** Score de COINCIDENCIA 0-1 (≠ confianza de detección). */
  score: number;
  /** Euros. `null` = no se publica precio de algo que no supera el umbral. */
  priceEur: number | null;
  status: HeroDemoStatus;
}

export interface HeroDemoDetection {
  id: HeroDemoProductId;
  /** Confianza de DETECCIÓN 0-1. */
  confidence: number;
  accent: HeroDemoAccent;
  bbox: RelativeBoundingBox;
}

export interface HeroDemoProduct {
  id: HeroDemoProductId;
  /** WebP local en `public/`. Nunca una URL remota: ver docs/DEMO_ASSETS.md. */
  src: string;
  /** Tamaño intrínseco del WebP — obligatorio para que no haya CLS. */
  intrinsic: { width: number; height: number };
  /** Esquina superior izquierda y ANCHO del recorte, en % de la escena. */
  placement: { x: number; width: number; y: number };
  accent: HeroDemoAccent;
  confidence: number;
  /** Profundidad de la sombra proyectada, 0-1. */
  shadow: number;
  /**
   * Intensidad del foco de luz que va DETRÁS del recorte, 0-1.
   *
   * Se ajusta por pieza y no es una constante: el abrigo es negro sobre fondo
   * casi negro y necesita mucho halo para tener silueta, mientras que al bolso
   * —rosa claro— el mismo halo lo lava y le quita el color.
   */
  halo: number;
}

/**
 * Relación de aspecto del lienzo de la escena. Es una constante y no un valor
 * medido en runtime a propósito: si el alto de la caja dependiera del tamaño
 * real del contenedor habría que recalcular en cada `resize`, y durante el
 * primer frame las cajas saldrían descolocadas.
 */
export const SCENE_ASPECT = 16 / 9;

/**
 * Alto de la caja a partir del ancho, para que encuadre EXACTAMENTE el recorte.
 *
 * Los porcentajes de X y de Y no miden lo mismo (uno sobre el ancho de la
 * escena, otro sobre el alto), así que un recorte cuadrado no ocupa el mismo
 * porcentaje en ambos ejes. Sin esta conversión, la caja de un producto
 * apaisado sobra por arriba y por abajo, y la de uno vertical lo recorta.
 */
function heightForWidth(
  widthPct: number,
  intrinsic: { width: number; height: number }
): number {
  const productAspect = intrinsic.width / intrinsic.height;
  return (widthPct * SCENE_ASPECT) / productAspect;
}

/** Caja de detección de un producto: exactamente el hueco que ocupa. */
export function deriveBox(product: HeroDemoProduct): RelativeBoundingBox {
  return {
    x: product.placement.x,
    y: product.placement.y,
    width: product.placement.width,
    height: heightForWidth(product.placement.width, product.intrinsic),
  };
}

/**
 * Los tres recortes de la escena.
 *
 * Los tamaños intrínsecos son los que produce `npm run demo:assets`; si se
 * sustituye un asset hay que actualizarlos aquí (y el script los imprime).
 * Están declarados y no leídos del fichero porque `next/image` los necesita en
 * el primer render del servidor para reservar el hueco y evitar salto de
 * maquetación.
 */
export const HERO_DEMO_PRODUCTS: readonly HeroDemoProduct[] = [
  {
    id: "coat",
    src: "/demo/products/coat.webp",
    intrinsic: { width: 768, height: 900 },
    placement: { x: 9, y: 15, width: 27 },
    accent: "violet",
    confidence: 0.94,
    shadow: 0.55,
    halo: 0.34,
  },
  {
    id: "bag",
    src: "/demo/products/bag.webp",
    intrinsic: { width: 900, height: 886 },
    placement: { x: 43, y: 20, width: 21 },
    accent: "cyan",
    confidence: 0.91,
    shadow: 0.5,
    halo: 0.12,
  },
  {
    id: "shoes",
    src: "/demo/products/shoes.webp",
    intrinsic: { width: 900, height: 829 },
    placement: { x: 66, y: 50, width: 24 },
    accent: "green",
    confidence: 0.87,
    shadow: 0.45,
    halo: 0.14,
  },
] as const;

/** Detecciones derivadas de la colocación: imposible que se desalineen. */
export const HERO_DEMO_DETECTIONS: readonly HeroDemoDetection[] =
  HERO_DEMO_PRODUCTS.map((product) => ({
    id: product.id,
    confidence: product.confidence,
    accent: product.accent,
    bbox: deriveBox(product),
  }));

/**
 * Coincidencias del catálogo.
 *
 * Los zapatos se quedan por debajo del umbral A PROPÓSITO: el mensaje de la
 * landing no es "lo encuentra todo", es "publica solo lo que puede sostener".
 * Una demo en la que los tres salen publicados vende justo lo contrario.
 */
export const HERO_DEMO_MATCHES: readonly HeroDemoMatch[] = [
  {
    productId: "coat",
    category: "clothing",
    score: 0.94,
    priceEur: 129,
    status: "published",
  },
  {
    productId: "bag",
    category: "bags_accessories",
    score: 0.91,
    priceEur: 89,
    status: "published",
  },
  {
    productId: "shoes",
    category: "footwear",
    score: 0.69,
    priceEur: null,
    status: "withheld",
  },
] as const;

/** Umbral de publicación, en %. Coincide con el que se cuenta en el hero. */
export const HERO_DEMO_THRESHOLD = 75;

export function heroProductById(id: HeroDemoProductId): HeroDemoProduct {
  const found = HERO_DEMO_PRODUCTS.find((p) => p.id === id);
  if (!found) throw new Error(`producto de demo desconocido: ${id}`);
  return found;
}

export function heroMatchById(id: HeroDemoProductId): HeroDemoMatch {
  const found = HERO_DEMO_MATCHES.find((m) => m.productId === id);
  if (!found) throw new Error(`coincidencia de demo desconocida: ${id}`);
  return found;
}

/**
 * Clases de color por acento.
 *
 * Centralizado porque Tailwind necesita las clases COMPLETAS en el código para
 * incluirlas en el CSS: construirlas por interpolación (`border-${accent}`)
 * compila pero llega al navegador sin estilo.
 */
export const ACCENT_CLASSES: Record<
  HeroDemoAccent,
  { border: string; text: string; bg: string; ring: string; dot: string; glow: string }
> = {
  violet: {
    border: "border-brand-bright",
    text: "text-brand-bright",
    bg: "bg-brand-bright",
    ring: "ring-brand-bright/40",
    dot: "bg-brand-bright",
    glow: "shadow-[0_0_20px_rgba(139,127,255,0.45)]",
  },
  cyan: {
    border: "border-accent",
    text: "text-accent",
    bg: "bg-accent",
    ring: "ring-accent/40",
    dot: "bg-accent",
    glow: "shadow-[0_0_20px_rgba(34,211,238,0.45)]",
  },
  green: {
    border: "border-success",
    text: "text-success",
    bg: "bg-success",
    ring: "ring-success/40",
    dot: "bg-success",
    glow: "shadow-[0_0_20px_rgba(52,211,153,0.45)]",
  },
};

/* ------------------------------ secuencia ------------------------------ */

/**
 * Guion de la animación automática.
 *
 * Cada producto ocupa dos pasos —detectar y luego resolver contra el
 * catálogo— porque son las dos mitades del argumento y encadenarlas en uno
 * solo hace que el panel parezca adivinar. El paso final deja la escena entera
 * antes de volver a empezar.
 */
export type HeroDemoPhase = "detect" | "match";

export interface HeroDemoStep {
  productId: HeroDemoProductId | null;
  phase: HeroDemoPhase | null;
}

export const HERO_DEMO_STEPS: readonly HeroDemoStep[] = [
  { productId: "coat", phase: "detect" },
  { productId: "coat", phase: "match" },
  { productId: "bag", phase: "detect" },
  { productId: "bag", phase: "match" },
  { productId: "shoes", phase: "detect" },
  { productId: "shoes", phase: "match" },
  { productId: null, phase: null },
] as const;

/** Duración de cada paso. 7 pasos × 1,4 s ≈ 9,8 s de ciclo. */
export const HERO_DEMO_STEP_MS = 1400;
