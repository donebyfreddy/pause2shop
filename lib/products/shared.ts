/**
 * Utilidades compartidas por los proveedores de productos (mock y OpenAI):
 * imágenes placeholder offline y construcción de URLs de búsqueda por retailer
 * (con soporte opcional de tag de afiliado de Amazon).
 */

export function colorToHex(color?: string | null): string {
  const map: Record<string, string> = {
    negro: "#27272a", blanco: "#a1a1aa", gris: "#52525b", azul: "#3b82f6",
    rojo: "#ef4444", verde: "#22c55e", amarillo: "#eab308", rosa: "#ec4899",
    morado: "#8b5cf6", marron: "#92400e", beige: "#d6d3d1", naranja: "#f97316",
    denim: "#1e3a8a", crema: "#e7e5e4", plateado: "#9ca3af", dorado: "#ca8a04",
  };
  const key = (color ?? "").toLowerCase();
  for (const [name, hex] of Object.entries(map)) if (key.includes(name)) return hex;
  return "#6366f1";
}

/** Imagen placeholder offline (SVG data URL) — sin dependencias de red. */
export function placeholderImage(title: string, color?: string | null): string {
  const c = colorToHex(color);
  const initials = title
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#18181b"/>
</linearGradient></defs>
<rect width="400" height="400" fill="url(#g)"/>
<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="120" fill="rgba(255,255,255,0.85)">${initials}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** URL de búsqueda en Amazon España, con tag de afiliado si está configurado. */
export function amazonSearchUrl(query: string): string {
  const base = `https://www.amazon.es/s?k=${encodeURIComponent(query)}`;
  const tag = process.env.AMAZON_AFFILIATE_TAG;
  return tag ? `${base}&tag=${encodeURIComponent(tag)}` : base;
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const RETAILERS: Record<string, { label: string; build: (q: string) => string }> = {
  amazon: { label: "Amazon", build: amazonSearchUrl },
  zalando: { label: "Zalando", build: (q) => `https://www.zalando.es/catalogo/?q=${encodeURIComponent(q)}` },
  asos: { label: "ASOS", build: (q) => `https://www.asos.com/es/search/?q=${encodeURIComponent(q)}` },
  "el corte ingles": { label: "El Corte Inglés", build: (q) => `https://www.elcorteingles.es/search/?s=${encodeURIComponent(q)}` },
  mediamarkt: { label: "MediaMarkt", build: (q) => `https://www.mediamarkt.es/es/search.html?query=${encodeURIComponent(q)}` },
  pccomponentes: { label: "PcComponentes", build: (q) => `https://www.pccomponentes.com/buscar/?query=${encodeURIComponent(q)}` },
  ikea: { label: "IKEA", build: (q) => `https://www.ikea.com/es/es/search/?q=${encodeURIComponent(q)}` },
  "leroy merlin": { label: "Leroy Merlin", build: (q) => `https://www.leroymerlin.es/search?q=${encodeURIComponent(q)}` },
  sephora: { label: "Sephora", build: (q) => `https://www.sephora.es/buscar?q=${encodeURIComponent(q)}` },
  decathlon: { label: "Decathlon", build: (q) => `https://www.decathlon.es/search?Ntt=${encodeURIComponent(q)}` },
  nike: { label: "Nike", build: (q) => `https://www.nike.com/es/w?q=${encodeURIComponent(q)}` },
  zara: { label: "Zara", build: (q) => `https://www.zara.com/es/es/search?searchTerm=${encodeURIComponent(q)}` },
};

/**
 * Devuelve { provider, url } para un retailer dado (o Amazon por defecto).
 * Nunca inventamos URLs de producto concretas: enlazamos a la página de
 * búsqueda real del retailer, que siempre resuelve.
 */
export function retailerSearchUrl(
  retailer: string | null | undefined,
  query: string
): { provider: string; url: string } {
  const key = norm(retailer ?? "");
  const r = RETAILERS[key];
  if (r) return { provider: r.label, url: r.build(query) };
  return { provider: "Amazon", url: amazonSearchUrl(query) };
}
