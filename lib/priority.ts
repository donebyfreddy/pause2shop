import type { DetectedItem, ProductRelationship } from "./types";

/**
 * Prioridad de PRESENTACIÓN comercial de un objeto detectado (pura).
 * No elimina objetos: decide qué se enseña primero, qué caja se pinta por
 * defecto y qué merece búsqueda inversa automática (una barandilla genérica
 * no gasta SearchAPI salvo acción manual).
 */

export type PresentationPriority = "high" | "medium" | "low";

const HIGH = [
  "ropa", "camisa", "camiseta", "sudadera", "chaqueta", "pantal", "vestido",
  "shirt", "hoodie", "jacket", "dress", "t-shirt",
  "reloj", "watch", "joyer", "jewel", "pulsera", "collar", "anillo",
  "gafas", "glasses", "sunglasses", "bolso", "bag", "mochila", "backpack",
  "zapat", "calzado", "sneaker", "shoe", "bota",
  "movil", "móvil", "phone", "portatil", "portátil", "laptop", "monitor",
  "camara", "cámara", "camera", "auricular", "headphone", "tablet", "consola",
  "coche", "car", "moto", "vehic",
];

const LOW = [
  "planta", "plant", "vegetacion", "vegetación", "arbol", "árbol", "flor",
  "barandilla", "railing", "valla", "pared", "wall", "techo", "suelo",
  "ventana", "window", "puerta", "door", "columna", "estructura", "edificio",
  "cesped", "césped", "arbusto", "cielo", "montaña",
];

/** Puntuación de asociación con la persona por tipo de relación. */
export const RELATIONSHIP_SCORES: Record<ProductRelationship, number> = {
  worn: 1.0,
  held: 0.95,
  used: 0.8,
  near_person: 0.55,
  background: 0.15,
};

type PriorityInput = Pick<
  DetectedItem,
  | "category"
  | "subcategory"
  | "name"
  | "purchase_relevance"
  | "relationship"
  | "person_association_score"
>;

/**
 * Asociación con la persona 0-1: score explícito del modelo, relación
 * declarada, o heurística por categoría (compatibilidad con datos antiguos).
 */
export function personAssociationScore(item: PriorityInput): number {
  if (typeof item.person_association_score === "number") {
    return Math.min(1, Math.max(0, item.person_association_score));
  }
  if (item.relationship) return RELATIONSHIP_SCORES[item.relationship];
  // Sin relación (datos antiguos): wearables típicos ≈ worn, resto neutro.
  const hay = normalize(item);
  const WEARABLE = [
    "camis", "shirt", "sudadera", "hoodie", "chaqueta", "jacket", "pantal",
    "vestido", "reloj", "watch", "pulsera", "joyer", "gafas", "glasses",
    "zapat", "sneaker", "bolso", "bag", "mochila", "gorra", "sombrero", "cinturon",
  ];
  if (WEARABLE.some((k) => hay.includes(k))) return 0.9;
  return 0.5;
}

function normalize(item: PriorityInput): string {
  return `${item.category ?? ""} ${item.subcategory ?? ""} ${item.name ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function presentationPriority(item: PriorityInput): PresentationPriority {
  // PERSON-CENTRIC: lo que la persona lleva/sostiene/usa manda sobre la
  // heurística de categorías — una camisa worn nunca es "low".
  if (item.relationship === "worn" || item.relationship === "held") return "high";
  if (item.relationship === "used") return "high";
  const hay = normalize(item);
  if (item.relationship === "background" || LOW.some((k) => hay.includes(k))) {
    // Relevancia de compra explícita alta puede rescatar un "low" (p.ej. una
    // planta decorativa con maceta de diseño que el modelo marca comprable).
    return (item.purchase_relevance ?? 0) >= 0.75 ? "medium" : "low";
  }
  if (HIGH.some((k) => hay.includes(k))) return "high";
  return "medium";
}

const AUTO_MATCH_BACKGROUND =
  process.env.NEXT_PUBLIC_AUTO_MATCH_BACKGROUND_PRODUCTS === "true";

/**
 * ¿Merece búsqueda inversa automática? worn/held/used siempre; el fondo
 * (background/low) nunca automáticamente (salvo env explícito) — una
 * barandilla o una palmera no gastan créditos de reverse image search.
 */
export function deservesAutoSearch(item: PriorityInput): boolean {
  if (
    item.relationship === "worn" ||
    item.relationship === "held" ||
    item.relationship === "used"
  ) {
    return true;
  }
  if (item.relationship === "background" && !AUTO_MATCH_BACKGROUND) return false;
  return presentationPriority(item) !== "low";
}

const PRIORITY_ORDER: Record<PresentationPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Comparador para ordenar por prioridad comercial (estable dentro del mismo nivel). */
export function byPresentationPriority(a: PriorityInput, b: PriorityInput): number {
  return PRIORITY_ORDER[presentationPriority(a)] - PRIORITY_ORDER[presentationPriority(b)];
}
