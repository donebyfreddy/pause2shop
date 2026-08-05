import {
  categoryFamily,
  normalizeCategory,
  normalizeText,
} from "@/lib/catalogIngestion/normalization/normalize";
import type { DetectedItem } from "@/lib/types";
import { hammingDistance } from "./perceptualHash";
import type { TrackRecord } from "./types";

/**
 * IDENTIDAD GLOBAL DE PRODUCTO dentro de un vídeo.
 *
 * El problema que resuelve, tal cual se observó: un mismo objeto producía
 * cinco entidades distintas porque el modelo lo describía distinto en cada
 * frame —"camiseta blanca", "camiseta blanca de manga corta", "camiseta",
 * "camisa de manga corta", "camiseta/parte superior blanca"— y el criterio de
 * fusión era `categoría idéntica Y (firma perceptual cercana O nombre corto
 * igual)`. Dos fallos encadenados:
 *
 *  1. La categoría se comparaba por IGUALDAD DE TEXTO y era una puerta dura.
 *     El modelo devuelve indistintamente "ropa", "camisetas" o "prenda
 *     superior" para la misma prenda, así que la fusión se descartaba antes de
 *     mirar nada más.
 *  2. El respaldo era el nombre recortado a tres palabras. Con descripciones
 *     libres eso no coincide casi nunca, y cuando coincide lo hace por azar.
 *
 * Aquí la decisión es un SCORE con varias señales y tres umbrales, más una
 * única puerta dura que sí es defendible: dos prendas que ocupan sitios
 * distintos del cuerpo no pueden ser el mismo objeto por mucho que se parezcan.
 */

/* ------------------------------ puerta dura ------------------------------- */

/**
 * "Slot" que ocupa cada categoría canónica. Es la ÚNICA puerta dura del
 * sistema: una camiseta y un pantalón nunca son el mismo producto, aunque
 * compartan color, textura y persona, y ningún score debería poder fundirlos.
 *
 * Se define sobre la categoría canónica de `normalizeCategory`, no sobre el
 * texto crudo del modelo, precisamente para no repetir el fallo (1).
 */
const CATEGORY_SLOT: Record<string, string> = {
  "t-shirt": "upper", shirt: "upper", blouse: "upper", sweater: "upper",
  sweatshirt: "upper", cardigan: "upper", jacket: "upper", blazer: "upper",
  coat: "upper", top: "upper", bodysuit: "upper",
  trousers: "lower", jeans: "lower", skirt: "lower", shorts: "lower",
  dress: "full_body", jumpsuit: "full_body",
  shoes: "footwear", sneakers: "footwear", boots: "footwear",
  sandals: "footwear", heels: "footwear", socks: "footwear",
  bag: "bag", backpack: "bag", wallet: "bag",
  cap: "headwear", hat: "headwear",
  belt: "accessory", scarf: "accessory", sunglasses: "accessory",
  watch: "accessory", jewelry: "accessory",
};

/**
 * Categoría canónica de un track. Se mira el campo más ESPECÍFICO disponible,
 * en orden, porque `category` suele ser el más grueso ("ropa") y el nombre el
 * que lleva la información ("camiseta blanca de manga corta").
 */
/**
 * Categoría canónica RECONOCIDA, o null.
 *
 * `normalizeCategory` devuelve el texto normalizado cuando no reconoce nada,
 * así que aplicada a un nombre libre ("taza roja grande") devuelve el nombre
 * entero disfrazado de categoría. Aquí solo se acepta si pertenece de verdad a
 * la taxonomía — es decir, si tiene familia.
 */
function knownCanonical(value: string | null | undefined): string | null {
  const canonical = normalizeCategory(value);
  if (!canonical) return null;
  return categoryFamily(canonical) ? canonical : null;
}

export function canonicalCategoryOf(
  item: Pick<DetectedItem, "name" | "category" | "subcategory">
): string | null {
  return (
    knownCanonical(item.subcategory) ??
    knownCanonical(item.name) ??
    knownCanonical(item.category) ??
    // Nada reconocido: se usa el texto normalizado de `category` como
    // identificador opaco. Sirve para comparar dos tracks entre sí (que es
    // para lo que se usa aquí) aunque no signifique nada para el catálogo.
    normalizeCategory(item.category)
  );
}

export function slotOf(canonical: string | null): string | null {
  if (!canonical) return null;
  return CATEGORY_SLOT[canonical] ?? null;
}

/** Slot de un item detectado, directamente. Lo usa `cropQuality`. */
export function slotForItem(
  item: Pick<DetectedItem, "name" | "category" | "subcategory">
): string | null {
  return slotOf(canonicalCategoryOf(item));
}

/**
 * ¿Pueden dos tracks ser el mismo objeto? Solo se responde que NO cuando hay
 * certeza: dos slots conocidos y distintos. Si alguno es desconocido se deja
 * decidir al score — negarse por desconocimiento volvería a partir productos.
 */
export function slotsCompatible(a: string | null, b: string | null): boolean {
  const sa = slotOf(a);
  const sb = slotOf(b);
  if (!sa || !sb) return true;
  return sa === sb;
}

/**
 * Segunda puerta dura: dos tracks que COINCIDEN EN EL TIEMPO y están asociados
 * a personas distintas no pueden ser la misma prenda.
 *
 * La coincidencia temporal es lo que le da valor al índice de persona. Dentro
 * de un mismo instante, la persona 0 y la persona 1 son con certeza dos
 * humanos distintos, y una prenda no la llevan dos personas a la vez. Entre
 * instantes distintos el índice no significa nada (se reasigna por frame), y
 * por eso el veto exige solapamiento.
 */
export function personConflict(a: TrackRecord, b: TrackRecord): boolean {
  const pa = a.representativeItem.person_index;
  const pb = b.representativeItem.person_index;
  if (pa == null || pb == null || pa === pb) return false;
  const overlap =
    Math.min(a.lastSeenSeconds, b.lastSeenSeconds) -
    Math.max(a.firstSeenSeconds, b.firstSeenSeconds);
  return overlap >= 0;
}

/* ------------------------------ componentes ------------------------------- */

/** Coseno acotado a [0,1]. Vectores de distinta dimensión ⇒ no comparables. */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return null;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return Math.min(1, Math.max(0, (cos + 1) / 2));
}

/**
 * Parecido visual. Preferencia absoluta por el EMBEDDING: el hash perceptual
 * de un recorte reescalado es un descriptor pobre —cambia con el encuadre y la
 * iluminación— y usarlo como señal principal es lo que obligaba a poner el
 * umbral de Hamming tan laxo (12 de 64 bits) que llegaba a fundir productos
 * distintos.
 *
 * Sin embedding se cae al hash. El valor NO se recorta aquí —un hash idéntico
 * es evidencia fuerte de que es el mismo objeto en el mismo encuadre—, pero se
 * marca `fromEmbedding: false` y el score final se limita para que la evidencia
 * de hash pueda FUNDIR y nunca declararse identidad fuerte.
 */
export function visualSimilarity(
  a: TrackRecord,
  b: TrackRecord
): { value: number; fromEmbedding: boolean } | null {
  const ea = a.bestCrop.embedding;
  const eb = b.bestCrop.embedding;
  if (ea?.length && eb?.length) {
    const cos = cosineSimilarity(ea, eb);
    if (cos !== null) return { value: cos, fromEmbedding: true };
  }
  const ha = a.bestCrop.signatureHash;
  const hb = b.bestCrop.signatureHash;
  if (!ha || !hb) return null;
  const distance = hammingDistance(ha, hb);
  return { value: Math.max(0, 1 - distance / 32), fromEmbedding: false };
}

/** Igualdad laxa de un atributo: null en cualquiera de los dos ⇒ sin señal. */
function attributeAgreement(a?: string | null, b?: string | null): number | null {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return null;
  if (na === nb) return 1;
  // Coincidencia parcial: "azul marino" vs "azul". Basta que uno contenga al
  // otro para considerarlo compatible pero no idéntico.
  if (na.includes(nb) || nb.includes(na)) return 0.7;
  return 0;
}

/**
 * Color, patrón y estilo. Solo promedia los atributos PRESENTES en ambos: un
 * producto sin patrón declarado no debe penalizar como si difiriera. Sin
 * ningún atributo comparable devuelve null (sin señal), no 0.5.
 */
export function attributeSimilarity(
  a: DetectedItem,
  b: DetectedItem
): number | null {
  const signals = [
    attributeAgreement(a.color, b.color),
    attributeAgreement(a.pattern, b.pattern),
    attributeAgreement(a.style, b.style),
  ].filter((v): v is number => v !== null);
  if (!signals.length) return null;
  return signals.reduce((sum, v) => sum + v, 0) / signals.length;
}

/** 1 misma categoría canónica · 0.6 misma familia · 0 distintas. */
export function categorySimilarity(
  a: string | null,
  b: string | null
): number | null {
  if (!a || !b) return null;
  if (a === b) return 1;
  const fa = categoryFamily(a);
  const fb = categoryFamily(b);
  if (fa && fa === fb) return 0.6;
  return 0;
}

/**
 * ¿Van sobre la misma persona?
 *
 * Señal DÉBIL a propósito (peso 0.08). `person_index` se asigna por frame: la
 * persona 0 del segundo 3 no tiene por qué ser la misma que la persona 0 del
 * segundo 20. Tratarlo como identidad estable partiría la misma prenda cada
 * vez que cambia el orden de las personas en el encuadre — justo el tipo de
 * fragmentación que este módulo existe para evitar.
 *
 * La excepción con valor probatorio está en `personConflict`.
 */
export function personSimilarity(
  a: DetectedItem,
  b: DetectedItem
): number | null {
  const pa = a.person_index;
  const pb = b.person_index;
  if (pa == null || pb == null) return null;
  return pa === pb ? 1 : 0;
}

/**
 * Continuidad temporal. Dos apariciones solapadas o consecutivas refuerzan la
 * identidad; separadas por medio vídeo, la debilitan sin llegar a negarla —un
 * personaje puede reaparecer al final con la misma ropa, que es precisamente
 * el caso que el ReID global debe resolver. Por eso pesa solo 0.05.
 */
export function temporalContinuity(
  a: TrackRecord,
  b: TrackRecord,
  videoDurationSeconds: number
): number {
  const overlap =
    Math.min(a.lastSeenSeconds, b.lastSeenSeconds) -
    Math.max(a.firstSeenSeconds, b.firstSeenSeconds);
  if (overlap >= 0) return 1;
  const gap = -overlap;
  const span = Math.max(videoDurationSeconds, 1);
  return Math.max(0, 1 - gap / span);
}

/** Marca/logo visible. Dos marcas distintas y verificadas son señal negativa. */
export function logoSimilarity(a: DetectedItem, b: DetectedItem): number | null {
  const brand = attributeAgreement(a.visible_brand, b.visible_brand);
  if (brand !== null) return brand;
  const description = attributeAgreement(a.logo_description, b.logo_description);
  if (description !== null) return description;
  // Uno con logo y otro sin él es señal NEGATIVA: si fueran el mismo producto,
  // el logo estaría en ambos encuadres (salvo oclusión, de ahí que no sea 0).
  if (a.logo_visible !== b.logo_visible) return 0.3;
  // Ninguno tiene logo: no hay información, no una coincidencia.
  return null;
}

/* --------------------------------- score ---------------------------------- */

export type IdentityWeights = {
  visual: number;
  attributes: number;
  category: number;
  person: number;
  temporal: number;
  logo: number;
};

/** Pesos de la especificación. Suman 1. */
export const DEFAULT_IDENTITY_WEIGHTS: IdentityWeights = {
  visual: 0.5,
  attributes: 0.2,
  category: 0.1,
  person: 0.08,
  temporal: 0.05,
  logo: 0.07,
};

export type IdentityBreakdown = {
  score: number;
  /** Cada componente, o null si esa señal no existía para este par. */
  visual: number | null;
  attributes: number | null;
  category: number | null;
  person: number | null;
  temporal: number | null;
  logo: number | null;
  /** El parecido visual salió de un embedding y no del hash perceptual. */
  visualFromEmbedding: boolean;
  /** Slot incompatible: el score es informativo, la fusión está prohibida. */
  blockedBySlot: boolean;
  /** Personas distintas coincidiendo en el tiempo: fusión prohibida. */
  blockedByPerson: boolean;
};

/**
 * Techo del score cuando la evidencia visual es solo un hash perceptual.
 *
 * Un hash idéntico puede significar "el mismo objeto" o "dos objetos con la
 * misma silueta y luminancia en la misma posición del encuadre". Basta para
 * fundir (queda por encima de `identityThreshold`), pero no para afirmar
 * identidad fuerte, que es lo que habilita fusionar sin dejar rastro.
 */
const HASH_ONLY_SCORE_CAP = 0.89;

export function identityScore(
  a: TrackRecord,
  b: TrackRecord,
  opts: {
    videoDurationSeconds: number;
    weights?: IdentityWeights;
  }
): IdentityBreakdown {
  const w = opts.weights ?? DEFAULT_IDENTITY_WEIGHTS;
  const ca = canonicalCategoryOf(a.representativeItem);
  const cb = canonicalCategoryOf(b.representativeItem);
  const visual = visualSimilarity(a, b);

  const parts = {
    visual: visual?.value ?? null,
    attributes: attributeSimilarity(a.representativeItem, b.representativeItem),
    category: categorySimilarity(ca, cb),
    person: personSimilarity(a.representativeItem, b.representativeItem),
    temporal: temporalContinuity(a, b, opts.videoDurationSeconds),
    logo: logoSimilarity(a.representativeItem, b.representativeItem),
  };

  /*
   * Media ponderada SOLO sobre las señales que existen, con los pesos
   * renormalizados.
   *
   * La alternativa —dar 0.5 a lo desconocido— parece inocua y no lo es: en un
   * vídeo sin personas detectadas ni logos, dos señales de las seis votaban
   * permanentemente "medio parecido" y arrastraban el score de CUALQUIER par
   * hacia el centro. Con los pesos de la especificación eso son 15 puntos
   * porcentuales que un producto real tenía que recuperar con las otras
   * señales para llegar al umbral. El resultado es no fundir nunca — que es
   * exactamente el síntoma que se estaba corrigiendo.
   */
  const weighted: Array<[number, number]> = [
    [parts.visual, w.visual],
    [parts.attributes, w.attributes],
    [parts.category, w.category],
    [parts.person, w.person],
    [parts.temporal, w.temporal],
    [parts.logo, w.logo],
  ].filter((pair): pair is [number, number] => pair[0] !== null);

  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  const raw =
    totalWeight > 0
      ? weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) /
        totalWeight
      : 0;

  const fromEmbedding = visual?.fromEmbedding ?? false;
  const score = fromEmbedding ? raw : Math.min(raw, HASH_ONLY_SCORE_CAP);

  return {
    ...parts,
    score,
    visualFromEmbedding: fromEmbedding,
    blockedBySlot: !slotsCompatible(ca, cb),
    blockedByPerson: personConflict(a, b),
  };
}

/* ------------------------------- etiquetado -------------------------------- */


/**
 * Nombre canónico entre todas las variantes observadas.
 *
 * Criterio: la etiqueta más frecuente y, a igualdad, la más informativa (más
 * larga). Con las cinco variantes del caso real gana "camiseta blanca de manga
 * corta" — que es también la que mejor describe la prenda.
 *
 * Se descartan las etiquetas con barra ("camiseta/parte superior blanca"): son
 * el modelo dudando entre dos nombres, no un nombre.
 */
export function canonicalLabel(labels: string[]): string {
  const usable = labels.filter((l) => l.trim().length > 0);
  if (!usable.length) return "";
  const clean = usable.filter((l) => !l.includes("/"));
  const pool = clean.length ? clean : usable;

  const counts = new Map<string, { label: string; n: number }>();
  for (const label of pool) {
    const key = normalizeText(label);
    const prev = counts.get(key);
    if (prev) {
      prev.n++;
      if (label.length > prev.label.length) prev.label = label;
    } else {
      counts.set(key, { label, n: 1 });
    }
  }
  return [...counts.values()].sort(
    (x, y) => y.n - x.n || y.label.length - x.label.length
  )[0].label;
}
