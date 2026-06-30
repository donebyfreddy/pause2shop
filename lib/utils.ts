import type { StyleVibe } from "./types";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Generate a non-cryptographic id without relying on Math.random determinism concerns. */
export function makeId(prefix = "id"): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function encodeQuery(q: string): string {
  return encodeURIComponent(q.trim());
}

const KNOWN_STYLES: StyleVibe[] = [
  "streetwear",
  "luxury",
  "minimal",
  "sport",
  "tech",
  "gamer",
  "outdoor",
  "formal",
  "casual",
  "home decor",
];

/** Map a free-text vibe string to one of our known style buckets. */
export function normalizeStyle(input?: string | null): StyleVibe | null {
  if (!input) return null;
  const s = input.toLowerCase();

  const map: Array<[StyleVibe, string[]]> = [
    ["streetwear", ["street", "urban", "hype", "skate"]],
    ["luxury", ["luxury", "lujo", "premium", "elegant", "elegante", "high-end"]],
    ["minimal", ["minimal", "minimalista", "clean", "scandi", "nordic"]],
    ["sport", ["sport", "deport", "fitness", "gym", "running", "athletic"]],
    ["tech", ["tech", "tecnolog", "gadget", "setup", "desk"]],
    ["gamer", ["gamer", "gaming", "rgb", "esport"]],
    ["outdoor", ["outdoor", "aventura", "hiking", "trekking", "camping", "monta"]],
    ["formal", ["formal", "business", "office", "traje", "elegant office"]],
    ["home decor", ["home", "decor", "decora", "interior", "hogar", "furniture", "mueble"]],
    ["casual", ["casual", "everyday", "relaxed", "diario"]],
  ];

  for (const [style, keywords] of map) {
    if (keywords.some((k) => s.includes(k))) return style;
  }
  return KNOWN_STYLES.includes(s as StyleVibe) ? (s as StyleVibe) : null;
}

/**
 * Category ranking weights per style vibe. Higher = surfaced first.
 * Keys are matched as case-insensitive substrings against item.category.
 */
const STYLE_CATEGORY_WEIGHTS: Record<StyleVibe, Array<[string, number]>> = {
  streetwear: [
    ["ropa", 5],
    ["calzado", 5],
    ["zapat", 5],
    ["accesorio", 4],
    ["gorra", 4],
    ["bolso", 3],
    ["mochila", 3],
  ],
  sport: [
    ["deport", 5],
    ["calzado", 5],
    ["zapat", 5],
    ["ropa", 4],
    ["mochila", 4],
    ["accesorio", 3],
  ],
  outdoor: [
    ["outdoor", 5],
    ["mochila", 5],
    ["calzado", 4],
    ["ropa", 4],
    ["accesorio", 3],
  ],
  tech: [
    ["electr", 5],
    ["gadget", 5],
    ["portátil", 4],
    ["portatil", 4],
    ["escritorio", 4],
    ["accesorio", 2],
  ],
  gamer: [
    ["gaming", 5],
    ["electr", 5],
    ["gadget", 4],
    ["escritorio", 4],
  ],
  "home decor": [
    ["mueble", 5],
    ["decora", 5],
    ["hogar", 4],
    ["lámpara", 4],
    ["lampara", 4],
  ],
  luxury: [
    ["reloj", 5],
    ["accesorio", 4],
    ["bolso", 4],
    ["ropa", 3],
    ["gafas", 3],
  ],
  formal: [
    ["ropa", 5],
    ["calzado", 4],
    ["reloj", 4],
    ["accesorio", 3],
  ],
  minimal: [
    ["decora", 4],
    ["mueble", 4],
    ["ropa", 3],
    ["accesorio", 3],
  ],
  casual: [
    ["ropa", 4],
    ["calzado", 3],
    ["accesorio", 3],
  ],
};

export function styleCategoryBoost(style: StyleVibe | null, category: string): number {
  if (!style) return 0;
  const weights = STYLE_CATEGORY_WEIGHTS[style];
  if (!weights) return 0;
  const c = category.toLowerCase();
  let boost = 0;
  for (const [needle, w] of weights) {
    if (c.includes(needle)) boost = Math.max(boost, w);
  }
  return boost;
}

export function prettyStyleLabel(style: StyleVibe | null): string {
  if (!style) return "estilo general";
  const labels: Record<StyleVibe, string> = {
    streetwear: "Streetwear",
    luxury: "Luxury",
    minimal: "Minimalista",
    sport: "Deportivo",
    tech: "Tech",
    gamer: "Gamer",
    outdoor: "Outdoor",
    formal: "Formal",
    casual: "Casual",
    "home decor": "Decoración / Hogar",
  };
  return labels[style];
}
