import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const appName = process.env.NEXT_PUBLIC_APP_NAME || "Pause2Shop";

export const metadata: Metadata = {
  title: {
    default: `${appName} — Pausa el vídeo, encuentra el producto`,
    template: `%s · ${appName}`,
  },
  description:
    "Detecta productos en vídeo e imagen con IA y encuéntralos al instante: coincidencia contra catálogo propio y búsqueda visual inversa con procedencia verificable.",
  applicationName: appName,
};

export const viewport: Viewport = {
  themeColor: "#06060a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        {/* Un único ToastProvider para las tres superficies: landing, estudio y admin. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
