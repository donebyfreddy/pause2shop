import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/seo";

/**
 * Web app manifest. Antes devolvía 404.
 *
 * Con esto, guardar la landing en la pantalla de inicio de un móvil —algo que
 * pasa en una demo comercial— da un icono y un nombre correctos en lugar de una
 * captura de la página y la URL.
 *
 * `display: "browser"` a propósito: esto es un producto web con navegación, no
 * una app instalable. Declarar `standalone` quitaría la barra de direcciones sin
 * que exista una experiencia diseñada para ello.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — Visual commerce para vídeo y VOD`,
    short_name: APP_NAME,
    description:
      "Detecta los productos visibles en cada escena, los cruza con el catálogo y devuelve coincidencias fiables por escena y timestamp.",
    start_url: "/",
    display: "browser",
    background_color: "#06060a",
    theme_color: "#06060a",
    icons: [
      {
        src: "/logo-mark.png",
        sizes: "243x255",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
