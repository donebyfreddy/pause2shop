# Auditoría — Análisis continuo PERSON-CENTRIC

Fecha: 2026-07-10 (ronda 6). Complementa `CONTINUOUS-PRODUCT-ANALYSIS-AUDIT.md`
y `PRODUCT-MATCHING-PIPELINE-AUDIT.md`.

## 1. ¿De verdad "solo analiza una vez"? — Diagnóstico honesto

Revisado el loop completo (`useVideoFrameLoop` → `useVideoCaptureEngine` →
`useFrameAnalysis` → `persist`), la detección continua **ya se re-disparaba**:
el propio screenshot del usuario muestra el historial con frames analizados en
0:00, 0:39, 0:47 y 1:07 y el contador "Frame 1141 · 30 fps". Lo que producía
la SENSACIÓN de análisis único era la combinación de:

1. **Deduplicación fuerte**: `sessionItems` acumula por fingerprint; en un
   vídeo con la misma persona en escena, los frames nuevos apenas añaden
   productos → el panel parece congelado.
2. **Prioridades planas**: palmeras/barandilla/carretera puntuaban como la
   camisa (la relevancia venía solo de `purchase_relevance` del modelo), así
   que los "nuevos" objetos eran fondo irrelevante.
3. **Panel de costes en memoria**: se resetea con cada reinicio del dev
   server ("1 llamada" con 5 frames en el historial = contador reiniciado).
4. **Sin manejo de seek**: al avanzar el vídeo no se forzaba análisis — la
   nueva posición esperaba al scheduler y el diff podía saltársela.

Riesgos reales detectados y corregidos aunque no fueran la causa visible:

- El re-registro del callback rVFC **no estaba en `finally`** — una excepción
  en el cuerpo del tick habría matado el bucle silenciosamente. Corregido con
  el patrón obligatorio try/finally (`hooks/useVideoFrameLoop.ts`).
- `onSeeked` no existía. Ahora: seek → `resetDiff()` + `captureNow()` —
  análisis INMEDIATO de la nueva posición, conservando el catálogo acumulado.
- Pausa ya analizaba el frame actual (`onPause → captureNow`); reanudar
  continúa el loop (rVFC se re-arma solo).

## 2. Modo PERSON-CENTRIC (P0 implementado)

- **Prompt** (`lib/vision.ts`): barrido obligatorio A (todo lo que la persona
  lleva/sostiene por zonas: prendas, calzado, reloj, pulseras, joyería, gafas,
  sombrero, bolso, cinturón, objetos en manos) → B (lo que utiliza: móvil,
  portátil, monitores, taza…) → C (fondo solo si es comprable y distintivo).
  Lista explícita de NO priorizar: puertas, paredes, carretera, barandillas,
  palmeras, mar, arquitectura. Cada producto devuelve `relationship`
  (worn|held|used|near_person|background), `person_index` y
  `person_association_score`. Boxes ceñidas: prendas sin cara/cuerpo entero,
  reloj = solo muñeca, objeto sostenido = el objeto, no el brazo. Nunca se
  devuelve ni identifica a la persona.
- **Parsing** (`coerceItem`): valida el enum de relationship, person_index
  entero o null, score 0-1; valores inventados se descartan sin romper.
- **Scoring** (`normalizeAnalysis`):
  `score = asociaciónPersona*0.45 + relevancia*0.25 + visibilidad*0.20 +
  distintividad*0.10 + penalizaciónFondo(-0.30)`.
  `personAssociationScore`: worn 1.0 · held 0.95 · used 0.8 · near_person
  0.55 · background 0.15 (heurística de wearables para datos antiguos).
- **Prioridad y matching** (`lib/priority.ts`): worn/held/used = high SIEMPRE
  (mandan sobre la heurística de categorías); background/low **no consumen
  reverse image search automática** (`AUTO_MATCH_BACKGROUND_PRODUCTS=false`).
- **UI** (`ProductResultsPanel`): bloques "Lo que lleva", "Lo que sostiene o
  utiliza", "Cerca de la persona" y "Otros objetos de la escena" (plegado,
  prioridad baja). Indicador: "● Analizando productos en tiempo real ·
  Frame N · X personas · Y productos seguidos · Z únicos".
- **Primera pasada más ligera**: el prompt ya NO pide marca/modelo exhaustivo
  del frame completo — marca/modelo/OCR fino siguen siendo trabajo de la 2ª
  pasada sobre el crop (`cropEnrichment`) y del reverse image search.

## 3. Resultado esperado en el frame de referencia

1. Camisa negra estampado blanco floral (worn) — prioridad 1, matching auto.
2. Reloj/pulsera metálica dorada (worn) — prioridad alta, matching auto.
3. Mando/objeto en la mano (held) — prioridad alta, se evalúa crop.
4. Palmeras, barandilla, carretera, mar → "Otros objetos de la escena"
   (plegado), sin gasto de API.

Cubierto por `test/personCentric.test.ts` como fixture de regresión.

## 4. P1 / P2

**P1**: PersonTrack real (tracking de personas con zonas corporales y
asociación reloj↔muñeca / objeto↔mano por geometría), métricas separadas
renderedFrames vs fullDetectionRuns persistidas en el panel de costes,
Web Worker para el diff, `analysisRunId` explícito por vídeo.
**P2**: pose estimation, segmentación de prendas, embeddings visuales.
