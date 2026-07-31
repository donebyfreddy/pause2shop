/**
 * Origen canónico del sitio y utilidades de metadatos.
 *
 * La auditoría encontró que NINGUNA ruta tenía `canonical`, `og:*` ni
 * `twitter:*`, y que `/robots.txt`, `/sitemap.xml` y el manifest devolvían 404.
 * Para un producto que se presenta enviando un enlace por correo o por Slack,
 * eso significa que la previsualización sale sin título, sin descripción y sin
 * imagen. Todo eso se resuelve a partir de este módulo.
 *
 * Precedencia del origen:
 *
 *  1. `NEXT_PUBLIC_SITE_URL` — lo que se debe fijar en un despliegue con dominio
 *     propio. Es la única que produce URLs canónicas estables.
 *  2. `VERCEL_PROJECT_PRODUCTION_URL` — el dominio de producción del proyecto en
 *     Vercel. Sirve para que los despliegues de producción tengan canónicas
 *     correctas sin configurar nada.
 *  3. `VERCEL_URL` — la URL efímera del deployment. Solo para previews: no debe
 *     acabar en una canónica de producción, pero en un preview es mejor que
 *     `localhost`.
 *  4. `http://localhost:3000` — desarrollo.
 *
 * Nota sobre el paso 3: en preview la canónica apunta al propio preview, que es
 * lo correcto — un preview no debe reclamar ser la producción.
 */

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;

  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;

  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();

/** Une el origen con una ruta, sin barras duplicadas. */
export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Rutas públicas indexables. Es la fuente única del sitemap y de lo que el
 * `robots.txt` permite: si se añade una ruta pública, se añade aquí y las dos
 * cosas quedan coherentes.
 *
 * `/admin` y `/api` NO están, y además se desindexan explícitamente en sus
 * propios metadatos: un `Disallow` es una petición, no una garantía.
 */
export const PUBLIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/studio", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/catalog", priority: 0.7, changeFrequency: "weekly" as const },
  { path: "/demo", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/arquitectura", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/legal/privacidad", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/legal/terminos", priority: 0.3, changeFrequency: "yearly" as const },
] as const;

/** Prefijos que nunca deben indexarse. */
export const PRIVATE_PREFIXES = ["/admin", "/api", "/demo-check"] as const;
