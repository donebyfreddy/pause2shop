import type { Metadata } from "next";

/**
 * El admin comparte el layout raíz (fuentes, tokens, ToastProvider) y añade su
 * propio chrome en cada página vía `AdminShell`. No hay un segundo
 * ToastProvider ni un segundo juego de estilos: es el mismo producto.
 */
export const metadata: Metadata = {
  title: { default: "Operaciones", template: "%s · Operaciones · Pause2Shop" },
  description:
    "Panel de operaciones del catálogo: conectores, jobs de ingesta, explorador de productos, monitorización y ajustes.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
