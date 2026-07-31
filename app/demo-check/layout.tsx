import type { Metadata } from "next";

/**
 * `/demo-check` es la pantalla de diagnóstico previa a una demo: comprueba
 * credenciales, base de datos y proveedores. No es producto y no debe aparecer
 * en un buscador — un resultado titulado "comprobación de entorno" con estados
 * de servicios internos no ayuda a nadie y da información de más.
 *
 * El `Disallow` de `robots.txt` cubre la petición; este `noindex` lo cubre en el
 * propio documento, que es lo que de verdad respetan los buscadores.
 */
export const metadata: Metadata = {
  title: "Comprobación de entorno",
  robots: { index: false, follow: false },
};

export default function DemoCheckLayout({ children }: { children: React.ReactNode }) {
  return children;
}
