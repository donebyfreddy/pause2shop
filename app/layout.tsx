import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { loadMessages, resolveRequestLocale } from "@/i18n/request";
import { isRtl } from "@/i18n/locales";
import { APP_NAME, SITE_URL } from "@/lib/seo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Metadatos raíz.
 *
 * La auditoría encontró que ninguna ruta tenía `canonical`, `og:*` ni
 * `twitter:*`: un enlace compartido por correo o Slack se previsualizaba sin
 * título propio, sin descripción y sin imagen. Todo lo común se define aquí y
 * cada página solo aporta su título, su descripción y su canónica.
 *
 * `metadataBase` es lo que permite que las rutas relativas (la imagen de
 * Open Graph, los iconos) se resuelvan a URLs absolutas: sin ella, Next avisa en
 * build y las previsualizaciones no cargan la imagen.
 *
 * El copy ya no dice "en tiempo real" ni "búsqueda visual inversa" como núcleo:
 * el flujo real es VOD contra catálogo propio.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${APP_NAME} — Convierte cada escena en una oportunidad de compra`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Pause2Shop detecta los productos visibles en cada escena de tu contenido, los cruza con tu catálogo y devuelve coincidencias fiables por escena y timestamp.",
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    locale: "es_ES",
  },
  twitter: {
    card: "summary_large_image",
  },
  // Se indexa solo lo público; `/admin` y `/api` se desindexan además en su
  // propio nivel, porque un `Disallow` en robots.txt es una petición, no una
  // garantía.
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#06060a",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveRequestLocale();
  const messages = await loadMessages(locale);

  return (
    <html
      lang={locale}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      // `globals.css` fija `scroll-behavior: smooth` para la navegación por
      // anclas de la landing. Desde Next 16 el router ya NO neutraliza ese
      // ajuste durante una navegación salvo que se declare este atributo: sin
      // él, ir de `/` a `/studio` haría un scroll suave hasta arriba en lugar de
      // aterrizar directamente. Con él, las anclas siguen siendo suaves y los
      // cambios de ruta instantáneos.
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Sin JavaScript no hay `IntersectionObserver`, y los envoltorios de
            aparición se quedarían con el `opacity: 0` que la librería de
            movimiento serializa en el HTML de servidor: la landing se vería
            prácticamente vacía. Esto los devuelve a su estado final.
            El equivalente para impresión está en `globals.css`. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
      </head>
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        {/* LocaleProvider envuelve todo: conmutar idioma solo cambia su
            estado interno, nunca desmonta lo que hay debajo (vídeo en curso,
            formularios, resultados, scroll). */}
        <LocaleProvider initialLocale={locale} initialMessages={messages}>
          {/* Un único ToastProvider para las tres superficies: landing, estudio y admin. */}
          <ToastProvider>{children}</ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
