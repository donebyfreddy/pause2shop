import path from "node:path";
import type { NextConfig } from "next";

/**
 * Configuración de la app Next.
 *
 * `turbopack.root` es OBLIGATORIO aquí: el repo tiene package-lock.json en la
 * raíz (orquestación del monorepo) y otro en esta app. Con dos lockfiles,
 * Turbopack infiere la raíz del repo como workspace root, y al hacerlo resuelve
 * mal `@swc/helpers` y el manifest de React Server Components: la landing
 * devuelve 500 en dev. Fijando la raíz, la resolución vuelve a ser la de esta app.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
