import type { MetadataRoute } from "next";
import { PRIVATE_PREFIXES, absoluteUrl } from "@/lib/seo";

/**
 * `robots.txt`. Antes devolvía 404.
 *
 * Se prohíbe explícitamente todo lo interno: el panel de operaciones, la API y
 * la ruta de diagnóstico. Las tres son alcanzables por URL y no tienen ningún
 * motivo para aparecer en un buscador — `/admin` además expone control real
 * sobre la ingesta.
 *
 * Esto NO es la protección: eso lo hace `proxy.ts` con autenticación, y los
 * metadatos `noindex` de cada ruta interna. Un `Disallow` solo lo respeta quien
 * quiere respetarlo.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: PRIVATE_PREFIXES.map((prefix) => `${prefix}/`),
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
