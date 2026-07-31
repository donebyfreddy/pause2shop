# Auditoría de la landing pública — estado previo al rediseño

Fecha: 2026-07-31
Alcance auditado: repositorio local (`npm run dev`, :4400) y despliegue en producción
(`https://pause2shop.vercel.app/`).
Método: recorrido con Playwright (Chromium) de `/`, `/studio`, `/catalog`, `/demo` y
`/admin` en 1440×900, 1920×1080, 768×1024 y 390×844, con captura above-the-fold y de
página completa, más volcado de headings, enlaces, landmarks, metadatos, overflow
horizontal y errores de consola.

Artefactos: `docs/audit/before/` (capturas) y el volcado estructurado que las acompaña.

---

## 1. Resumen ejecutivo

La base visual es buena y el sistema de diseño (tokens en `app/globals.css`) es sólido y
coherente entre las tres superficies. El problema no es estético: es de **posicionamiento,
jerarquía y honestidad**. La página se lee como un panel técnico premium que documenta un
pipeline, no como un producto que resuelve un problema de negocio.

Cinco problemas bloquean una presentación enterprise:

1. El hero **promete "en tiempo real"**, que no es el flujo real (VOD / análisis al pausar).
2. La **demo no entra en el primer viewport**: se corta a un tercio.
3. El mensaje principal es **vocabulario de ingeniería** (rVFC, hash perceptual, CLIP, NMS).
4. Se **exponen limitaciones internas** como argumento de venta ("hasta 2 minutos",
   "proveedor hash determinista para demo").
5. **`Admin` es un enlace de primer nivel** en la cabecera pública, y el CTA final lleva al
   `Panel de operaciones`.

A esto se suman defectos concretos y medibles: 16 px de desbordamiento horizontal en móvil
en todas las rutas, ausencia total de metadatos sociales, `robots.txt` / `sitemap.xml` /
manifest inexistentes, y contenido esencial que solo existe si se dispara una animación.

---

## 2. Hallazgos medidos

### 2.1 Desbordamiento horizontal en móvil (390 px) — todas las rutas

| Ruta | Desbordamiento |
| --- | --- |
| `/` | 16 px |
| `/studio` | 16 px |
| `/catalog` | 16 px |
| `/demo` | 16 px |
| `/admin` | 18 px |

Origen en las cuatro primeras: el grupo de acciones de la cabecera
(`components/shell/SiteHeader.tsx`) — selector de idioma + CTA `Prueba ahora` + botón de
menú no caben en 390 px, y el botón de menú queda parcialmente fuera de pantalla. Se ve en
la captura `home__390x844__fold.png`: la hamburguesa está cortada por el borde derecho.
El caso de `/admin` es independiente (tabla del panel) y queda fuera del alcance de este
rediseño, pero se documenta.

**Severidad: alta.** Es el primer contacto en el dispositivo más probable para un enlace
compartido, y hace que la página se pueda arrastrar lateralmente.

### 2.2 Metadatos y superficies de indexación: ausentes

| Recurso | Estado |
| --- | --- |
| `/robots.txt` | 404 |
| `/sitemap.xml` | 404 |
| `/manifest.webmanifest` | 404 |
| `/opengraph-image` | 404 |
| `<link rel="canonical">` | ausente en las 5 rutas |
| `og:*` | 0 etiquetas en las 5 rutas |
| `twitter:*` | 0 etiquetas en las 5 rutas |

Consecuencia práctica: **cualquier enlace compartido en Slack, WhatsApp, LinkedIn o correo
se previsualiza sin imagen, sin título propio y sin descripción.** Para un producto que se
va a enviar por enlace a un cliente enterprise, esto es un fallo de primer orden.

Además `/admin` es indexable: no hay `robots` meta ni `X-Robots-Tag`, y el `proxy.ts` solo
protege con Basic si `ADMIN_PASSWORD` está definida (en local no lo está, y responde 200).

### 2.3 Jerarquía de encabezados

- `/demo` tiene **dos `<h1>`** ("Demo de vídeo completo" y "Sube un vídeo (máx. 120s)").
- `/demo` **no tiene título propio**: hereda el `title` por defecto del layout, así que la
  pestaña dice "Pause2Shop — Pausa el vídeo, encuentra el producto" igual que la home.
- La home encadena `H2 → H3 × 5 → H2 → H3 × 5 …`: correcto en estructura, pero el patrón
  revela el problema de composición (ver 2.5).

### 2.4 Contenido esencial detrás de una animación

`components/ui/Reveal.tsx` arranca con `initial={{ opacity: 0 }}` y solo llega a `opacity: 1`
vía `whileInView`. Dos consecuencias:

- En la captura de página completa a 1440 px, **las secciones "Cómo funciona", "Casos de
  uso" y "Capacidades" salen prácticamente vacías** (ver `home__1440x900__full.png`): son
  ~3.500 px de negro con una sola tarjeta visible. Si el `IntersectionObserver` no dispara
  —captura, impresión, herramienta de lectura, JS parcialmente fallido—, el contenido
  simplemente no existe.
- `useReducedMotion` solo neutraliza el desplazamiento (`y`), **no la opacidad**. Un usuario
  con movimiento reducido sigue dependiendo del observer para ver el texto.

**Severidad: alta.** Contradice directamente la regla de no esconder contenido esencial
detrás de una animación.

### 2.5 Composición repetitiva y ritmo vertical excesivo

La home mide **6.211 px a 1440×900** (7 viewports) y **8.784 px a 390×844** (10.4
viewports). El recorrido es, casi sin variación:

```
fondo oscuro → eyebrow en versalitas → H2 → rejilla de tarjetas con icono → repetir
```

Cuatro secciones consecutivas comparten esa misma forma (Cómo funciona con 5 nodos, Casos
de uso con 1+4 tarjetas, Capacidades con 6 tarjetas, CTA). No hay ni un diagrama, ni una
comparación, ni una sección a pantalla completa, ni un panel interactivo. El resultado es
que la página se percibe como un catálogo de features y no como una demostración.

El timeline de "Cómo funciona" además introduce **cinco** ideas principales, con el paso 3
("Tracking y deduplicación") siendo puramente interno.

### 2.6 Errores de consola

`/admin` emite `IntlError: ENVIRONMENT_FALLBACK` de forma repetida: falta el `timeZone`
global en la configuración de `next-intl`, lo que además puede provocar desajustes de
markup entre servidor y cliente al formatear fechas. Fuera del alcance del rediseño de la
landing, pero es un fallo real y trivial de arreglar.

---

## 3. Posicionamiento y copy

### 3.1 Afirmaciones no respaldadas

| Texto actual | Problema |
| --- | --- |
| Badge: "Detección visual de producto en vídeo, **en tiempo real**" | El flujo real es VOD / análisis al pausar, con procesamiento previo. "Tiempo real" implica directo. |
| "…y **búsqueda visual inversa**" en el hero | Vende la búsqueda externa como núcleo, cuando el flujo recomendado es catálogo-primero. |
| `landing.heroVisual.liveBadge` = "en directo" | Mismo problema, dentro del propio mockup. |
| "Todo lo que ya funciona, con enlace directo para comprobarlo" | Tono defensivo; se lee como "no te fíes, compruébalo". |

### 3.2 Lenguaje técnico como mensaje principal

En la primera pantalla y media aparecen, sin capa de traducción a negocio: `rVFC`,
`scene diff`, `hash perceptual`, `bounding boxes`, `relationship`, `trackIds`, `NMS`,
`pgvector`, `CLIP`, `matchStage`. Nada de esto debe desaparecer —es lo que da confianza
técnica— pero no puede ser lo primero que lee una dirección de negocio.

### 3.3 Limitaciones internas expuestas como argumento

- `landing.useCases.primary.point1` = "**Vídeos de hasta 2 minutos por job** (configurable)"
  → es un límite de desarrollo presentado como característica.
- `landing.capabilities.features.embeddings.body` = "CLIP local o **proveedor hash
  determinista para demo**" → admite en la landing comercial que el motor de embeddings
  puede ser un placeholder.
- `landing.capabilities.features.embeddings.badge` = "CLIP opcional".
- Cuatro de los seis bloques de "Capacidades" enlazan a `/admin/*`, es decir, la prueba de
  producto que se ofrece al visitante es el panel de operaciones interno.

### 3.4 Navegación pública contaminada por lo interno

- Cabecera: `Estudio · Catálogo · Demo vídeo · [ES] · **Admin** · Prueba ahora`.
- Menú móvil: incluye `Admin` explícitamente.
- CTA final: el botón secundario es **`Panel de operaciones`** → `/admin`.
- Footer: una columna entera titulada "Operaciones" con `Panel de administración`,
  `Conectores`, `Jobs de ingesta`, `Monitorización`.

El visitante recibe cuatro invitaciones distintas a entrar en la administración del
sistema y ninguna a entender el valor del producto.

### 3.5 Titulares que argumentan en contra

- "Pensado para catálogos de vídeo, **no para una foto suelta**" — define el producto por
  lo que no es y suena a respuesta a una objeción que el visitante no ha planteado.

---

## 4. Estructura ausente

Comparado con lo que una presentación enterprise necesita, faltan por completo:

- **Sección de integración**: cómo encaja Pause2Shop en una cadena de VOD existente sin
  sustituir el reproductor. Hoy no hay ni una palabra sobre API, latencia de consulta o
  separación entre procesamiento y publicación.
- **Sección de confianza / umbral**: qué pasa cuando el sistema no está seguro. Es la
  primera pregunta de cualquier responsable editorial y no tiene respuesta en la página.
- **Sección de seguridad**: roles, secretos, auditoría, retención, kill switch.
- **Demo interactiva**: la única demo es un mockup animado no interactivo. No se puede
  pulsar un producto ni un hotspot.
- **Franja de prueba/confianza** tras el hero con capacidades verificables.
- **Footer completo**: no hay Privacidad, Términos, Contacto, Documentación ni selector de
  idioma en el pie.

---

## 5. Lo que funciona y hay que conservar

Para que el rediseño no destruya valor existente:

- **Sistema de tokens** (`app/globals.css`): superficies, líneas, tinta en cuatro niveles,
  marca violeta + acento cian, utilidades `panel` / `grid-backdrop` / `mask-fade` /
  `text-gradient`. Es coherente y suficientemente rico. Se refina, no se reemplaza.
- **`prefers-reduced-motion` global** ya implementado en CSS.
- **Foco visible consistente** (`:focus-visible` con outline de marca).
- **i18n real y bien resuelto**: 11 locales, cambio sin recarga que no desmonta el árbol
  (`LocaleProvider`), persistencia en cookie, detección por `Accept-Language`, soporte RTL
  para árabe. Es una base mejor que la de la mayoría de landings.
- **Honestidad estructural en los datos**: `app/page.tsx` lee cifras del servicio real de
  catálogo y muestra `—` si está caído, en lugar de inventar números. Ese principio se
  mantiene.
- **Carga diferida del estudio** (`StudioSection` con `IntersectionObserver` + `dynamic`):
  el planteamiento es correcto.
- **Puerta de acceso al admin** (`proxy.ts`): Basic auth real sobre `/admin` y
  `/api/catalog/*`, con kill switch por `CATALOG_ADMIN_ENABLED`.

---

## 6. Prioridades para el rediseño

| # | Acción | Motivo |
| --- | --- | --- |
| P0 | Reescribir hero: valor de negocio, sin "tiempo real", demo dentro del primer viewport | Es el 90% de la primera impresión |
| P0 | Sacar `Admin` de cabecera, CTA final y footer público | Un visitante no debe ver la administración |
| P0 | Arreglar los 16 px de desbordamiento en móvil | Defecto visible y medible |
| P0 | Quitar "hasta 2 minutos" y "proveedor hash determinista" del copy público | Debilitan la propuesta sin necesidad |
| P1 | Añadir secciones de integración, confianza/umbral y seguridad | Son las preguntas reales del comprador |
| P1 | Demo interactiva con sincronía hotspot ↔ tarjeta | Convierte la afirmación en demostración |
| P1 | Bajar "Cómo funciona" de 5 a 4 pasos y mover la jerga a chips secundarios | Legibilidad para negocio |
| P1 | Metadatos completos: OG, Twitter, canonical, robots, sitemap, manifest | Sin esto el enlace no se puede compartir |
| P1 | Que el contenido esencial no dependa de una animación | Accesibilidad y robustez |
| P2 | Variar la composición: diagrama, sticky, comparación, métricas | Romper la repetición de tarjetas |
| P2 | Footer profesional con legal, contacto y selector de idioma | Credibilidad |
| P2 | Reducir el alto total de la home | 6.211 px es demasiado para el contenido que hay |
