# Fixtures de conectores

## Qué es cada cosa, sin ambigüedad

### `images/`

Imágenes **reales** descargadas de las tiendas, reducidas. Se usan para probar
el procesado de imagen, los hashes perceptuales y la deduplicación visual.

### `html/`

HTML **sintético, escrito a mano**. No es una captura de la tienda.

Esto importa y se dice claramente: desde el entorno de desarrollo de este
proyecto, Zara, Mango y H&M devuelven `403 Access Denied` a nivel de red — no
por nuestro User-Agent, sino por IP (un Chromium con UA por defecto recibe el
mismo 403). No se ha intentado eludirlo, así que **no ha sido posible capturar
su HTML real**.

Lo que estos fixtures sí prueban es el **contrato de extracción** de cada
conector: que sabemos leer

- `window.zara.viewPayload` (Zara),
- `__NEXT_DATA__` → `props.pageProps.productDetail` (Mango),
- `productArticleDetails` (H&M),

y que los precios en céntimos, las tallas por color y el precio rebajado se
interpretan como corresponde. Cada fixture reproduce la **forma** documentada de
esa estructura, con datos inventados.

Lo que **no** prueban: que la tienda siga publicando esa forma hoy. Por eso
ninguna de estas tres fuentes se marca como verificada en vivo, y el admin las
muestra como `blocked_or_challenged`.

## Cómo capturar fixtures reales cuando la tienda sea accesible

```bash
npm run scraper:probe -- <conector>          # confirma que responde
npm run scraper:capture -- <conector> --limit 2
```

`scraper:capture` guarda el HTML en `html/<conector>/<id>.html` quitando
cookies, tokens y cabeceras personales. Con un fixture real en su sitio, el test
del conector pasa a demostrar extracción sobre HTML de la tienda y la fuente
puede subir a `verification: "fixtures"`.
