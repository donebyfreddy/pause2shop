# DEMO-RUNBOOK — Pause2Shop (miércoles)

Guion operativo para la demo en vivo. Complementa a `docs/DEMO-AUDIT.md`.

---

## 0. Acciones humanas PENDIENTES (hacer HOY, no el miércoles)

| Acción | Dónde | Por qué |
|---|---|---|
| **Crear clave de SerpAPI (gratis, 250/mes)** | serpapi.com → `SERPAPI_API_KEY` | La clave actual es inválida. Es el fallback de Google Lens y cubre la demo entera sin pagar. |
| **Crear clave de SearchAPI (gratis, 100 requests)** | searchapi.io → `SEARCHAPI_API_KEY` | Proveedor principal de Google Lens (soporta search_type + query guiada). |
| **Poner la clave SECRETA de Supabase** | Supabase → Settings → API keys → `sb_secret_…` → `SUPABASE_SERVICE_ROLE_KEY` | La actual es `sb_publishable_…` (cliente): Storage rechaza la subida de crops y sin crop público no hay Lens. |
| **Crear bucket público `shoppable-media`** | Supabase → Storage | No existe ningún bucket; los crops no tienen dónde publicarse. |
| **Arreglar `DATABASE_URL`** | Supabase → Settings → Database → Connection string (pooler, puerto 6543, `postgresql://…`) | El valor actual es la URL REST (`https://…supabase.co`), que `pg` no puede usar. Sin esto la demo funciona igualmente en memoria. |
| **(Opcional) Verificar la cuenta DataForSEO** | app.dataforseo.com | Hasta verificarla, TODA la API devuelve 40104. Solo enriquece precios; la demo funciona sin ella. |

Detalle y justificación de costes: `docs/DEMO-API-COST-DECISION.md`. **Pago: no necesario.**

Tras cada cambio de `.env`: reiniciar `npm run dev` y volver a pasar `/demo-check`.

## 1. Preparación 30 minutos antes

1. Cargar el portátil y desactivar actualizaciones/notificaciones (modo No molestar).
2. `cd pause2shop && npm run build && npm run start` (producción local, más estable que dev) — o `npm run dev` si se prefiere.
3. Activar modo presentación: `NEXT_PUBLIC_PRESENTATION_MODE=true` en `.env.local` **antes** del build.
4. Abrir `http://localhost:3000/demo-check` → pulsar **“Ejecutar comprobación completa”**.
   - Todo OK/Warning esperado → seguir.
   - Cualquier Error inesperado → aplicar el plan B correspondiente (sección 5).
5. Si hay DB: `npm run db:migrate` (idempotente).
6. **Precalentar la cache** con el material exacto de la demo (imagen + vídeo + escenas clave): analizar cada uno una vez. La cache por hash (7 días) hará que en vivo los mismos frames respondan al instante y sin coste.
7. Dejar abiertas 3 pestañas: la app, `/demo-check`, `/catalog`.
8. Cerrar toda pestaña/ventana personal (se va a compartir pantalla/pestaña).

## 2. Material recomendado

- **Imagen**: foto clara de producto con marca/texto legible (p. ej. una zapatilla con logo visible, buena luz, fondo simple). Tener 2–3 candidatas probadas de antemano.
- **Vídeo MP4**: 1–3 min, estilo haul/lookbook/unboxing con cortes de escena claros y productos en primer plano. Guardarlo en el escritorio como `demo.mp4`. **Probado de antemano.**
- **YouTube**: el mismo tipo de contenido; URL corta guardada en notas. Idealmente un vídeo ya usado al precalentar.

## 3. Orden exacto de la demo

**Acto 1 — Imagen (2-3 min).** "Analizar imagen" → arrastrar (o Ctrl+V) la foto → preview inmediata → analizar. Enseñar: bounding boxes sobre la imagen, recorte por producto en cada card, atributos (color/material/patrón), texto OCR y logo, **marca solo con evidencia** (tooltip ✓), confianza, y el bloque "Producto exacto / Casi exacto / Similar" con tienda y precio si los proveedores están activos. Cerrar con "guardado en catálogo" → abrir `/catalog`.

**Acto 2 — Vídeo subido (3-4 min).** "Analizar vídeo" (solo aparece Subir vídeo) → arrastrar `demo.mp4` → "Vídeo preparado". **Pulsar play y nada más**: el análisis arranca solo. Enseñar: detección multiproducto por zonas (ropa + silla + monitores + taza…), boxes sobre el vídeo, crops en las cards con "Buscando coincidencias…" que se resuelven a producto exacto/casi exacto/similar según llega el matching, frames saltados cuando la escena no cambia (control de coste), «×N visto» en repetidos, pausa → análisis inmediato, "Historial del vídeo" acumulando. El botón "⏹ Detener análisis" existe si hace falta parar.

> Nota: la detección es en STREAMING — el primer objeto aparece en ~5-10 s y el resto gotea cada 2-3 s mientras el modelo genera (la escena completa tarda ~15-35 s según complejidad). El vídeo nunca se congela y los resultados anteriores permanecen. Si se quiere aún menos latencia el día D: `OPENAI_SERVICE_TIER=priority` en `.env` (≈2× coste de tokens de visión, sigue siendo céntimos).

**Acto 3 — YouTube (2-3 min).** "Pegar link" → URL → se carga el reproductor → explicar el permiso ("el navegador protege el contenido del iframe; compartimos esta pestaña una sola vez") → Activar captura → seleccionar **Esta pestaña** → auto-captura. Reproducir y pausar en una escena con producto.

**Cierre (1 min).** `/catalog` con todo lo detectado + panel técnico plegable con consumo por proveedor.

## 4. Qué explicar / qué NO tocar

**Explicar:** detección con evidencia (no inventamos marcas), diferencia exacto/casi exacto/similar, control de coste (frames deduplicados, cache, límites), y que si la DB o un proveedor caen la demo sigue (resiliencia real, no mock).

**NO tocar:** el intervalo de captura (dejar 3s), el `.env` durante la demo, la pestaña compartida (no minimizarla: algunas máquinas dejan de pintar frames), el botón "Analizar frame actual" repetidamente (rate limit 20/min).

## 5. Planes de contingencia

**Plan A — Todo en vivo.** Requiere: OpenAI OK + (SearchAPI o DataForSEO verificado). Es el guion de la sección 3.

**Plan B — Vídeo subido con cache precalentada.** Si YouTube/Wi-Fi/proveedores fallan en vivo: usar `demo.mp4` ya precalentado. Los frames idénticos golpean la cache por hash → resultados reales instantáneos obtenidos previamente. Es legítimo y se puede decir: "este vídeo lo hemos preprocesado para la demo; el pipeline es idéntico en vivo".

**Plan C — Resultados preprocesados reales.** Si OpenAI cae (raro): la app sin `OPENAI_API_KEY` entra en modo mock **etiquetado como demo**; NO presentarlo como detección real. Alternativa mejor: capturas/grabación de una sesión real hecha el día antes (grabar un screencast de respaldo el martes).

| Fallo | Síntoma | Acción |
|---|---|---|
| YouTube no captura | Frame negro / permiso denegado | Cambiar a Plan B (MP4). Mencionar que es una limitación del navegador, no del producto. |
| DB caída | Aviso "guardado en esta sesión" | Seguir sin más: el análisis no se bloquea (fallback automático a memoria + reintento cada 30s). No abrir el tema salvo pregunta. |
| SearchAPI/DataForSEO caídos | Cards sin bloque "Producto exacto" | Los items conservan atributos + "Buscar manualmente en…". Decir: "el matching contra tiendas usa proveedores externos; hoy os enseño el fallback". |
| OpenAI lento | Spinner >10s | Esperar (timeout a 45s corta solo). No re-pulsar analizar. |
| Todo mal | — | Screencast de respaldo del martes. |

## 6. Volver a un estado limpio

- Reiniciar el servidor (`Ctrl+C` → `npm run start`): borra catálogo en memoria y contadores de coste.
- En el navegador: recargar con la consola cerrada; "Cambiar vídeo/URL" resetea la sesión de análisis.
- La cache visual en DB no molesta (solo acelera); para purgarla: `delete from visual_search_cache;`.

## 7. Checklist final (T-5 minutos)

- [ ] `/demo-check` en verde/ámbar conocido
- [ ] Modo presentación activo (sin panel debug visible)
- [ ] `demo.mp4` en el escritorio y probado hoy
- [ ] Imagen candidata probada hoy
- [ ] URL de YouTube en el portapapeles/notas
- [ ] Pestañas: app + catálogo abiertas
- [ ] No molestar activado, brillo al máximo
- [ ] Screencast de respaldo accesible
