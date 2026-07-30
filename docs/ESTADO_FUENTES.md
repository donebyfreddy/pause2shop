# Estado real de las 68 fuentes

**Medido el 2026-07-30** con `npm run scraper:probe -- --all`, desde el entorno de
desarrollo del proyecto y **sin navegador ni IA** (`SCRAPER_PLAYWRIGHT_ENABLED=false`,
`SCRAPER_AI_ENABLED=false`), para medir qué se consigue con la vía más barata.

Nada de este documento está declarado a mano: cada fila viene de una petición real.

```bash
npm run scraper:probe -- --all --json > estado.json   # reproducirlo
npm run scraper:infer -- --json                       # qué publica cada sitemap
```

> ⚠️ **El resultado depende de tu red.** Las cadenas grandes bloquean rangos de IP
> de datacenter. Lo que aquí sale como `blocked_or_challenged` puede funcionar
> desde otra salida a internet, y al revés. Vuelve a medirlo en tu entorno.

## Resumen medido

| Estado | Fuentes | Qué significa |
| --- | --- | --- |
| ✅ `implemented_verified` | **11** | Extrajeron una ficha real completa: título, precio, moneda e imagen |
| 🤝 `pending` (requieren acuerdo) | **18** | API de partner o afiliación. `canSpecSync()` = false: no se les puede lanzar sync |
| ⛔ `blocked_or_challenged` | **21** | 403 al pedir la portada. No se intenta eludir |
| 🔍 `implemented_unverified` | **11** | Responden 200, pero el descubrimiento no resolvió fichas |
| 🚫 `blocked_by_robots` | **1** | Su robots.txt prohíbe las rutas de catálogo |
| ⚠️ `error` | **6** | Timeout o 404 en la portada declarada |

Las 11 verificadas **no necesitaron IA ni navegador**: todas publican datos
estructurados. Es el resultado que buscaba el diseño por capas — la IA es el
último recurso, y en la práctica casi nunca se llega a ella.

---

## ✅ Extraen productos reales (11)

| Fuente | Muestra obtenida | Precio | Img | Extractores |
| --- | --- | --- | --- | --- |
| `ecoalf` | BLACK BRONSON STAINLESS STEEL BOTTLE | 19,25 € | 1 | `jsonld` |
| `parfois` | Pendientes abanico con conchas | 3,99 € | 12 | `jsonld` |
| `camper` | Nautico | 199 € | 6 | `jsonld` |
| `ba-and-sh` | CYRON CARDIGAN | 155 € | 12 | `jsonld` |
| `gant` | Chaqueta Sailor — NAVY | 250 € | 1 | `jsonld` |
| `sandro` | Coletero estampado paisley | 25 € | 1 | `jsonld` |
| `maje` | Calcetines con volantes de encaje | 29 € | 1 | `jsonld` |
| `na-kd` | Braguita de bikini con tira atada | 2,59 € | 1 | `jsonld` |
| `river-island` | Black high waisted leggings | 12 GBP | 1 | `jsonld` |
| `adolfo-dominguez` | Technical bermuda shorts | 69 € | 1 | `jsonld` + `opengraph` |
| `desigual` | (vestido estampado) | 89,95 € | 1 | **`microdata` + `opengraph`** |

`desigual` es el caso que justifica el pipeline: **no publica JSON-LD**. Se
resolvió con microdata + OpenGraph + heurísticas de DOM, sin tocar la IA.

### E2E completo, con persistencia en Postgres real

`ecoalf` y `parfois` se han llevado hasta el final: sync desde la API del admin,
productos guardados, logs por etapas y segundo pase sin duplicados.

```
POST /api/catalog/jobs/sync {"source":"parfois","limit":3}
  → status completed · descubiertas 3 · extraídas 3 · nuevas 3 · errores 0
  → IA en 0/3 fichas · coste estimado 0,000000 USD · 10,8 s
  → segundo pase incremental: 3 → 3 productos, 0 duplicados
```

## 🤝 Requieren acuerdo (18)

Marketplaces y lujo que solo dan acceso por API de partner o red de afiliación.
Existen como scaffold con el motivo escrito, y `canSpecSync()` devuelve **false**:
no hay forma de lanzarles un sync por error.

`el-corte-ingles` · `asos` · `zalando` · `about-you` · `boohoo` ·
`prettylittlething` · `next` · `jd-sports` · `foot-locker` · `farfetch` ·
`ssense` · `net-a-porter` · `mr-porter` · `mytheresa` · `luisaviaroma` ·
`revolve` · `end-clothing` · `yoox`

**Camino:** alta en la red (Awin, Rakuten, TradeDoubler, CJ, Impact) o programa de
partners. Con las credenciales en el entorno, se implementa `fetchFromFeed()` y la
fuente pasa a extraer por feed — la vía 1 del pipeline, sin scraping.

## ⛔ Bloquean el acceso automatizado (21)

403 antes de poder leer nada. **Incluye Zara y Mango**, dos de los tres que el
encargo pedía verificar.

`zara` · `mango` · `massimo-dutti` · `pull-and-bear` · `bershka` ·
`stradivarius` · `oysho` · `lefties` · `zara-home` · `cos` · `arket` ·
`weekday` · `monki` · `lacoste` · `guess` · `superdry` · `levis` · `adidas` ·
`new-balance` · `hugo-boss` · `decathlon`

Y `hm`, `uniqlo`, `tommy-hilfiger`, `calvin-klein` aparecen como `error` por
timeout, que en la práctica es el mismo muro.

### Lo que se comprobó, y por qué no se fue más lejos

| Intento | Resultado |
| --- | --- |
| HTTP plano con nuestro User-Agent declarado | `403 Access Denied` |
| Playwright (Chromium real, mismo User-Agent) | **el mismo 403** |
| Chromium con su User-Agent por defecto | **el mismo 403** — y `example.com` responde 200 en la misma sesión |

El bloqueo es **de red/IP**, no por declararnos bot. Ir más allá exigiría falsear
identidad, rotar IPs o resolver challenges: explícitamente fuera de alcance. El
admin lo muestra como `blocked_or_challenged` con el HTTP observado.

### Qué sí existe para Zara, Mango y H&M

Tests del **contrato de extracción** en `test/catalogIngestion/connectors.test.ts`,
que verifican que se sabe leer:

- `window.zara.viewPayload` — incluidos sus precios en céntimos, las tallas por
  color y el precio tachado;
- el `__NEXT_DATA__` de Mango — distinguiendo precio rebajado de tachado;
- el `productArticleDetails` de H&M — combinado con su JSON-LD sin contradicirse.

Corren contra fixtures **sintéticos** que reproducen la forma documentada. Están
marcados como tal: `verification: "contract"`, no `"fixtures"`, y
`test/catalogIngestion/fixtures/README.md` lo explica sin ambigüedad. Un test
contra HTML capturado de la tienda demuestra otra cosa, y no se presenta como si
fuera lo mismo.

## 🔍 Accesibles, descubrimiento sin resolver (11)

Responden 200 y robots.txt lo permite, pero el descubrimiento por sitemap no dio
fichas utilizables.

| Fuente | Lo observado |
| --- | --- |
| `springfield`, `cortefiel`, `pedro-del-hierro`, `women-secret` | Plataforma Demandware: el sitemap de productos existe, pero sus URLs no encajan con ningún patrón inferible sin muestrear más |
| `tous` | 210 sitemaps, todos de landings y *shop the look* |
| `bimba-y-lola`, `reiss`, `c-and-a`, `puma` | Sitemaps accesibles sin URLs de ficha |
| `nike` | **Descubre y extrae** título y precio; en esta pasada faltó la moneda. Con `SCRAPER_AI_ENABLED=true` la completa |
| `diesel` | Extrajo una tarjeta regalo sin precio. Correcto: no es un producto |

**Camino:** declarar `category_crawl` con sus URLs de categoría reales. El motor
ya recorre listados con paginación — es configuración, no código.

## 🚫 Bloqueado por robots.txt (1)

`other-stories`. Su robots.txt prohíbe las rutas de catálogo y se respeta. No hay
camino técnico: solo la vía de partner.

## ⚠️ Error en la portada declarada (6)

| Fuente | Error | Estado |
| --- | --- | --- |
| `hm`, `uniqlo`, `tommy-hilfiger`, `calvin-klein` | Timeout | En la práctica, el mismo bloqueo de red |
| `scalpers` | 404 en `/es/` | **Corregido**: la portada real es la raíz |
| `snipes` | 404 en `/es/` → la raíz devuelve 403 | Bloqueada, no mal configurada |

---

## Los patrones de URL estaban adivinados

Un hallazgo que merece constar: los `productUrlPattern` del registro estaban
escritos a mano y **muchos acertaban cero**. Por eso el registro decía 68 fuentes
y casi ninguna extraía nada.

`npm run scraper:infer` los deriva de los sitemaps reales de cada tienda. Aciertos
sobre la muestra, antes → después:

| Fuente | Antes | Después |
| --- | --- | --- |
| `desigual` | 0 | 3534 / 4000 |
| `ba-and-sh` | 0 | 3882 / 4000 |
| `other-stories` | 0 | 2347 / 2575 |
| `adolfo-dominguez` | 0 | 2433 / 4000 |
| `scalpers` | 0 | 2344 / 4000 |
| `sandro` | 0 | 1794 / 3063 |
| `gant` | 0 | 1372 / 1713 |
| `nike` | 0 | 1020 / 4000 |
| `puma` | 0 | 800 / 1583 |
| `arket` | 0 | 587 / 681 |
| `weekday` | 0 | 421 / 494 |
| `maje` | 0 | 406 / 995 |
| `cos` | 0 | 81 / 87 |
| `camper` | 2492 | 3654 / 4000 |

**Rechazada a propósito:** la propuesta para `c-and-a` (`[A-Za-z_-]*`) acepta
cualquier slug, incluidas categorías y landings. Un patrón que acierta mucho
porque acepta todo es peor que no tener patrón.

## Cómo mejorar estos números

1. **Red no bloqueada** — desbloquea de golpe 21 fuentes, incluidas las de más
   volumen. Es la palanca con más efecto y la única que no requiere código.
2. **`category_crawl` en las 11 accesibles** — configuración pura.
3. **Altas de afiliación** para las 18 que requieren acuerdo.
4. **`SCRAPER_AI_ENABLED=true`** en la sonda — rescata fichas como la de Nike a
   la que solo le faltaba un campo. Cuesta del orden de 0,0004 USD por ficha.
