# Auditoría: Playwright en Vercel y estado real del scraper

Fecha: 2026-07-30 · App: `pause2shop` · Next.js 16.2.9 (Turbopack) · Node 24.x

---

## 1. El error de producción

```
Failed to load external module playwright-core-...
Cannot find module '/var/task/node_modules/playwright-core/browsers.json'
```

### Causa raíz (probada, no inferida)

`playwright-core` lee `browsers.json` **en tiempo de ejecución con un `require` de ruta calculada**:

```js
// node_modules/playwright-core/lib/coreBundle.js:33634
registry = new Registry(require(import_path20.default.join(packageRoot, "browsers.json")));
```

Dos hechos que se combinan mal:

1. **La ruta es dinámica.** `path.join(packageRoot, "browsers.json")` no es un especificador estático, así que el file tracing de Next (que analiza el grafo de imports estáticamente) no puede saber que ese fichero hace falta y no lo copia al artefacto de la función.
2. **El fichero no está en `exports`.** `require("playwright-core/browsers.json")` falla con `ERR_PACKAGE_PATH_NOT_EXPORTED`, comprobado en local. O sea: no es alcanzable como módulo, solo como **fichero en disco**. Por eso hay que incluirlo como fichero, no como dependencia.

Resultado: en local existe (`node_modules/playwright-core/browsers.json`, 1780 bytes) y funciona; en `/var/task` no existe y `chromium.launch()` explota al construir el registry.

### Por qué no lo arreglaba nada de lo que ya había

`next.config.ts` **no tenía `serverExternalPackages` ni `outputFileTracingIncludes`**. Su única opción era `turbopack.root`. Sin declarar nada, Next intenta empaquetar `playwright-core` como cualquier dependencia y pierde sus recursos no-JS.

### Segundo problema, independiente del primero

Aunque `browsers.json` llegue, **no hay navegador que lanzar**. `playwright-core` no trae binarios (eso es `playwright`, el paquete completo), y descargar Chromium en tiempo de ejecución dentro de una función es inviable. Antes del cambio, la única vía de producción era `SCRAPER_BROWSER_WS_ENDPOINT` (navegador remoto). Si no estaba configurada, el `catch` de `ensureBrowser()` devolvía un mensaje correcto pero el render nunca ocurría.

---

## 2. Inventario

### Dependencias relevantes

| Paquete | Antes | Ahora | Nota |
|---|---|---|---|
| `playwright-core` | `^1.62.0` | `1.62.0` (pin) | Espera Chromium **151.0.7922.34** (rev 1234) |
| `@sparticuz/chromium` | — | `149.0.0` (pin) | 67 MB en `node_modules`; Chromium ~149 |
| `next` | `16.2.9` | igual | `serverExternalPackages` y `outputFileTracingIncludes` son **top-level** en esta versión (verificado en `node_modules/next/dist/server/config-shared.d.ts`) |

**Compatibilidad y su límite honesto:** hay un desfase de ~2 versiones mayores de Chromium (151 esperado por Playwright vs 149 que empaqueta Sparticuz). Playwright conduce el navegador por CDP y ese protocolo es estable entre versiones cercanas, así que en la práctica funciona; no es una combinación que Playwright certifique. Sparticuz no publica todavía un build de Chromium 151. Si aparece un fallo de protocolo, las salidas son: (a) bajar `playwright-core` a la 1.5x que empareje con Chromium 149, o (b) usar `RemoteBrowserProvider`, que no tiene este problema.

### Imports de navegador

Todos los accesos a Playwright pasaban ya por un único módulo, y con **import dinámico** (correcto — no arrastra el paquete a ningún bundle de cliente):

- `lib/catalogIngestion/browser/playwrightService.ts` → `await import("playwright-core")`
- `lib/catalogIngestion/api/routes.ts` → `getPlaywrightService()`
- `scripts/scraperProbe.ts`, `scripts/scraperSmoke.ts` → solo `closePlaywrightService`

No hay ningún import de Playwright en componentes cliente. Verificado.

### Runtime de las rutas

**No hay uso erróneo de Edge Runtime.** Las 29 rutas bajo `app/api/catalog/**` declaran ya `runtime = "nodejs"`, y 27 de ellas `maxDuration = 300`. El cron `app/api/cron/catalog-jobs/route.ts` también. Las dos sin `maxDuration` (`feedback`, `items`) no lanzan navegador.

### Persistencia

`lib/catalogIngestion/catalog/store.ts` → `getStore()` elige backend según `isDatabaseConfigured()`:

- Con `DATABASE_URL` → `PostgresCatalogStore`.
- Sin ella → `FileCatalogStore`, **pero solo fuera de producción**: si `process.env.VERCEL` o `NODE_ENV=production`, lanza `catalog ingestion requires reachable Postgres in production`. Ese es exactamente el mensaje que aparecía en Vercel antes de subir `DATABASE_URL`, y era correcto: la app se negaba a fingir persistencia sobre un filesystem efímero.

No hay SQLite. No hay store en fichero en producción. Ya cumplía el requisito 13 de aceptación.

### Registro de fuentes

**68 especificaciones, 68 ids únicos, 0 duplicados** (comprobado ejecutando el registro, no leyéndolo). También 0 labels duplicados. La lista del enunciado venía repetida, pero el registro del repo ya estaba correcto: **no había nada que deduplicar**.

Reparto por lifecycle declarado:

| lifecycle | nº |
|---|---|
| `implemented` | 3 |
| `ready_to_configure` | 47 |
| `partner_required` | 18 |

### Lo que ya estaba implementado (y por tanto no rehíce)

La auditoría encontró que buena parte de lo pedido existía y funcionaba:

| Pedido | Estado | Dónde |
|---|---|---|
| Cola persistente, job padre/hijo, checkpoint, reanudación, cancelación | **ya existía** | `lib/catalogIngestion/jobs/{queue,handlers}.ts`, jobs en Postgres vía `store.saveJob` |
| Lotes con corte por presupuesto y continuación | **ya existía** | `BaseConnector.ts:716-822` — corta al llegar a `batchSize` y deja el job reanudable |
| Reanudación en serverless por cron | **ya existía** | `app/api/cron/catalog-jobs/route.ts`, protegido con `CRON_SECRET` |
| Structured Outputs con JSON Schema strict | **ya existía** | `ai/extractor.ts:216` → `response_format: { type: "json_schema", json_schema: AI_JSON_SCHEMA }`, `schema.ts:128` → `strict: true` |
| Caché de IA por `source+url+domHash+schemaVersion+model` | **ya existía** | `ai/cache.ts:37` → `${domain}\|${url}\|${domHash}\|${SCHEMA_VERSION}\|${model}` |
| Condensado del DOM antes de enviar a IA | **ya existía** | `ai/condense.ts` |
| Coste/tokens de IA | **ya existía** | `ai/cost.ts`, tablas `catalog_ai_extractions` / `catalog_ai_usage` |
| robots.txt + crawl-delay + rate limit + concurrencia por dominio | **ya existía** | `connectors/base/httpClient.ts` (`ensureRobotsAllowed`, `acquireDomainSlot`) |
| Circuit breaker por dominio | **ya existía** | `playwrightService.ts` (`DomainCircuit`) y `BaseConnector` |
| Detección de challenge/CAPTCHA para RENDIRSE | **ya existía** | `playwrightService.ts:45-52`, `BrowserChallengeError` |
| Bloqueo de vídeo/fuentes/analytics, contexto por dominio, cierre en `finally` | **ya existía** | `playwrightService.ts` |
| Logs por etapas con SSE | **ya existía** | `observability/jobLog.ts`, `app/api/catalog/scraper/logs/stream/route.ts` |

Conclusión de la auditoría: **el scraper estaba bien construido; lo que estaba roto era el empaquetado para Vercel y la ausencia de un navegador utilizable en la función.** Ahí se concentró el trabajo.

---

## 3. Cambios aplicados

### `next.config.ts`

- `serverExternalPackages: ["playwright-core", "@sparticuz/chromium"]` — los deja fuera del bundle para que se resuelvan desde `node_modules` en runtime, que es la única forma de que sus recursos no-JS sobrevivan.
- `outputFileTracingIncludes` para las rutas que lanzan navegador, incluyendo explícitamente `browsers.json` (el fichero que el tracer no puede ver).

### `BrowserProvider`

Se extrajo la decisión de "de dónde sale el navegador" a `lib/catalogIngestion/browser/providers/`:

| Provider | Cuándo | Cómo |
|---|---|---|
| `LocalPlaywrightProvider` | dev en macOS/Linux | Chromium de `npx playwright install chromium`, o `PLAYWRIGHT_EXECUTABLE_PATH` |
| `VercelChromiumProvider` | producción serverless | `@sparticuz/chromium` (`executablePath()`, `args`, headless), con `CHROMIUM_PACK_URL` opcional |
| `RemoteBrowserProvider` | cualquier entorno | CDP contra navegador gestionado (`SCRAPER_REMOTE_BROWSER_URL`) |

Selección por `SCRAPER_BROWSER_PROVIDER` (`local\|vercel\|remote`); si no se define, se autodetecta (`process.env.VERCEL` → `vercel`).

`VercelChromiumProvider` **se niega a ejecutarse fuera de Linux x64**: el binario de Sparticuz es para Amazon Linux y en macOS falla con un error de formato ejecutable que no dice nada útil. Es mejor un mensaje explícito.

---

## 4. Límites de verificación (importante)

- **El provider de Vercel no se puede probar en local.** El binario de Sparticuz es Linux x64; esta máquina es macOS arm64. Su única prueba real es un deploy a Preview.
- El desfase Chromium 149/151 descrito arriba solo se manifiesta en ejecución real.
- Zara, Mango y H&M **bloquean por IP** desde infraestructura de datacenter (ya documentado en el repo). Que el navegador arranque en Vercel no implica que esas tres devuelvan producto desde una función: lo esperable es `blocked_or_challenged`, que es un resultado honesto y así se registra.
