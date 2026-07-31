import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, absoluteUrl } from "@/lib/seo";

/**
 * `sitemap.xml`. Antes devolvía 404.
 *
 * Se genera desde `PUBLIC_ROUTES` (`lib/seo.ts`), que es también lo que usa el
 * `robots.txt`: así no puede pasar que una ruta esté en el sitemap y prohibida a
 * la vez, o que se añada una página pública y nadie se acuerde de listarla.
 *
 * `lastModified` es la hora de generación: no hay CMS ni fecha de publicación
 * por página de la que tirar, y poner una fecha fija sería peor información que
 * ninguna.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
