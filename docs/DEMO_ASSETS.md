# Assets de la demo del hero

Procedencia, licencia y estado de las imágenes de producto que usa la demo del
hero de la landing (`components/landing/demo/HeroProductDemo.tsx`).

Se regeneran con:

```bash
npm run demo:assets
```

Ese script descarga cada original de su URL documentada, valida MIME real,
tamaño y resolución, recorta el fondo cuando hace falta, escribe el WebP
optimizado en `public/demo/products/` y deja la procedencia y el `sha256` en
`public/demo/products/metadata.json`.

**La landing no usa ninguna URL remota en tiempo de ejecución.** Sirve los WebP
locales. La descarga es un paso de desarrollo.

---

## ⚠️ Antes de una presentación comercial

| Asset | Acción | Motivo |
|---|---|---|
| `coat.webp` | **Sustituir (obligatorio)** | El original es una miniatura de Google Images: el titular de los derechos es desconocido y no hay licencia que podamos invocar. |
| `bag.webp` | Nada | Unsplash License: uso comercial permitido, atribución no obligatoria. |
| `shoes.webp` | Nada | Igual. |

Ninguno de los tres tiene marca de agua visible, y los tres se sirven ya desde
nuestro propio dominio, así que **no hay hotlink ni dependencia de Google en
producción**. Lo único que queda pendiente es la licencia del abrigo.

### Por qué el abrigo sigue sin resolver

Con `UNSPLASH_ACCESS_KEY` en el entorno, el script puede buscar en Unsplash:

```bash
npm run demo:assets -- --unsplash coat "wool coat product white background"
```

Bolso y botas se resolvieron así. El abrigo no: Unsplash es un banco de
fotografía editorial, no de fichas de producto, y no hay ningún abrigo
fotografiado sobre fondo liso recortable. El mejor candidato (`ibTHy8t7JvM`, un
abrigo amarillo de lana) está sobre madera, y **la madera está más saturada que
la prenda** — medido: 0,577 frente a 0,456. La segmentación por color, que es lo
que hace `removeWhiteBackground`, recorta la prenda antes que el fondo. Haría
falta un modelo de segmentación (rembg / U²-Net) o un recorte a mano.

### Qué más se descartó y por qué

- **Pexels.** Legalmente equivalente a Unsplash, pero el acceso está bloqueado
  por Cloudflare (403) y su API también exige clave.
- **Openverse** (agregador de Creative Commons, API pública sin clave). Sí
  funciona y permite filtrar por uso comercial, pero lo que devuelve para
  "abrigo", "bolso" o "zapatos" son fotografías de aficionado con fondo real, no
  recortes de producto sobre fondo limpio. Compuestas en el bodegón quedarían
  peor que los assets actuales. Además buena parte son `BY-SA`, cuya cláusula
  vírica es incómoda en una landing.
- **El catálogo propio** (`fashion-product-images-small`, 1048 fichas ya
  importadas). Descartado por licencia: el dataset **no declara ninguna** y en
  `docs/FASHION_DATASET_IMPORT.md` está marcado como uso de demo e
  investigación, "no redistribuir". Una landing pública es redistribución.
- **Met Museum (CC0)** y **Wikimedia Commons**. Licencia impecable y revisada,
  pero para "abrigo" solo devuelven prendas históricas de museo y escudos de
  armas: nada que sirva como recorte de producto moderno.
- **Openverse con filtro `cc0,pdm`.** Sí devuelve abrigos modernos, pero al
  abrirlos son capturas de fichas de ecommerce resubidas a Flickr por usuarios
  que les han puesto la marca de dominio público por su cuenta. Esa marca es
  autodeclarada y en estos casos evidentemente falsa. Usarlas sería peor que el
  estado actual: parecerían licenciadas sin estarlo.

### Cómo sustituir un asset

**Vía rápida, sin tocar código.** Deja el fichero en `assets/demo/coat.png` (o
`.webp`/`.jpg`) y lanza `npm run demo:assets`. También vale una variable, que
además acepta URL:

```bash
DEMO_ASSET_COAT=/ruta/a/abrigo.png npm run demo:assets
DEMO_ASSET_COAT=https://images.unsplash.com/photo-xxxx npm run demo:assets
```

El origen efectivo queda anotado en `metadata.json`, así que la trazabilidad no
se pierde por usar el atajo.

**Vía completa**, si además quieres dejar documentada la URL de origen:

1. Edita la entrada correspondiente en `ASSETS`
   (`scripts/prepareDemoAssets.ts`): `sourceUrl`, `sourceName`, `license` y, si
   el original viene con fondo opaco, `removeBackground: true`.
2. `npm run demo:assets`. El script imprime el tamaño final.
3. Copia ese tamaño a `intrinsic` en `lib/landing/heroDemo.ts`. Es obligatorio:
   `next/image` lo necesita para reservar el hueco y no provocar salto de
   maquetación, y de él se deriva el alto de la caja de detección.
4. Si el producto cambia de forma, ajusta `placement` en el mismo archivo. La
   caja de detección se recalcula sola — no hay coordenadas duplicadas.
5. Revisa que el texto siga describiendo lo que se ve
   (`landing.heroDemo.products.*` en `messages/*.json`, once locales).

---

## Inventario

### `public/demo/products/coat.webp`

| | |
|---|---|
| Origen | `https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT8vRLD5OpIP2dxUeXP55KdeNaeC5gTQG4FAnNRE6WhQw&s=10` |
| Publicado por | Miniatura de Google Images — **titular original desconocido** |
| Licencia | **Sin verificar. No apto para uso comercial.** |
| Original | JPEG 413×484, fondo blanco opaco |
| Procesado | Fondo recortado por difusión desde bordes · luminosidad ×1,45 |
| Resultado | WebP 768×900, ~32 KB |

Dos avisos sobre este archivo:

- El original es de **baja resolución** (413×484) y se reescala, así que no
  aguanta un examen de cerca.
- Es una **chaqueta técnica corta con capucha**, no el "abrigo largo de lana"
  del guion original. El texto de la demo se ajustó a lo que la imagen enseña de
  verdad ("Abrigo técnico con capucha") en vez de describir una prenda que no
  aparece.

El realce de luminosidad no es cosmética: la prenda es negra y sobre el fondo
casi negro del hero llegaba sin costuras ni cremallera, como una silueta plana.

### `public/demo/products/bag.webp`

| | |
|---|---|
| Origen | `https://images.unsplash.com/photo-1691480150204-66dd1eb77391` (`IFlg3kFbR0E`) |
| Publicado por | Unsplash · personalgraphic.com |
| Licencia | **Unsplash License** — uso comercial permitido, atribución no obligatoria |
| Original | JPEG 1600×1600, fondo blanco opaco |
| Procesado | Fondo recortado por difusión desde bordes, tolerancia 38 |
| Resultado | WebP 900×869, ~125 KB |

Bolso estructurado de piel marrón, en tres cuartos. El fondo es blanco de
estudio pero no uniforme (tiene la sombra del bolso), de ahí el modo `white`:
difunde desde los cuatro bordes en vez de tratar cada píxel claro por separado,
así que los reflejos claros de la piel no se agujerean.

### `public/demo/products/shoes.webp`

| | |
|---|---|
| Origen | `https://images.unsplash.com/photo-1550998358-08b4f83dc345` (`4lf8mVuZESQ`) |
| Publicado por | Unsplash · LoboStudio Hamburg |
| Licencia | **Unsplash License** — uso comercial permitido, atribución no obligatoria |
| Original | JPEG 1600×1600 |
| Procesado | Fondo recortado por difusión desde bordes, tolerancia 48 |
| Resultado | WebP 900×868, ~162 KB |

Botas de piel con cordones, desgastadas. Tolerancia 48 y no 34: la sombra bajo
la suela es un degradado y con poca tolerancia la difusión se paraba a mitad,
dejando un halo claro alrededor del recorte sobre el fondo oscuro del hero. Al
propagar solo desde el borde, subirla no puede comerse el interior de la bota.

El texto de la demo dice «Botas de piel», no «zapatos»: describe lo que se ve.

---

## Qué NO afirma la demo

Decisiones deliberadas, para que nadie las "arregle" luego por error:

- **Sin marcas.** Poner un nombre de tienda en una tarjeta de demo insinúa un
  acuerdo comercial que no existe. La procedencia se expresa como el tipo de
  fuente ("catálogo propio").
- **Sin compra.** No hay ficha ni URL de producto detrás, así que el CTA dice
  "Ver coincidencia" y no "Comprar". Hay un test que lo comprueba
  (`e2e/hero-demo.spec.ts`).
- **Marcadas como demo.** Cada tarjeta lleva la etiqueta "Producto demo".
- **Precios de ejemplo.** 129,00 € y 89,00 € son ilustrativos. La tercera
  coincidencia no lleva precio a propósito: no supera el umbral y publicar el
  precio de algo retenido sería contradecirse.
