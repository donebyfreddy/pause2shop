# Evidencia visual del rediseño de la landing

Capturas de referencia del antes y el después. El diagnóstico y las mediciones
están en [`../LANDING_AUDIT.md`](../LANDING_AUDIT.md).

Método: Playwright con Chromium, español como idioma de partida. Las de `before/`
se tomaron contra `next dev`; las de `after/`, contra un build de producción
(`next build && next start`). Las de página completa se recorren con scroll antes
de capturar — sin eso, las secciones que aparecen al hacer scroll saldrían en
negro y la captura mentiría sobre el estado de la página.

## `before/` — estado auditado

| Fichero | Qué muestra |
| --- | --- |
| `home__1440x900__fold.png` | Primera pantalla: el mockup empieza a 620 px y se corta a un tercio. Badge "en tiempo real". `Admin` en la cabecera. Tres CTAs de peso parecido. |
| `home__390x844__fold.png` | Móvil: la hamburguesa queda cortada por el borde derecho (los 16 px de desbordamiento). |
| `home__768x1024__fold.png` | Tablet. |
| `home__1440x900__full.png` | Página completa, 6.211 px. Se ven los tramos en negro de las secciones que dependen de `whileInView`. |

## `after/` — tras el rediseño

| Fichero | Qué muestra |
| --- | --- |
| `home__1440x900__fold.png` | Primera pantalla: panel de la demo completo dentro del viewport, con detección → tarjeta de catálogo → precio → estado editorial. |
| `home__1920x1080__fold.png` | Escritorio grande. |
| `home__768x1024__fold.png` | Tablet: frame completo en el fold, resultados debajo. |
| `home__390x844__fold.png` | Móvil: cabecera limpia, sin desbordamiento, CTA primario y frame con detecciones en el fold. |
| `home__1440x900__full.png` | Página completa con todas las secciones renderizadas. |
| `home__1440x900__ar.png` | Árabe con `dir="rtl"`: layout espejado completo y precio formateado según el locale. |
