/**
 * Datos de la escena de demostración de la landing.
 *
 * Fuente única para el mockup del hero (`HeroProductDemo`) y para la demo
 * interactiva (`InteractiveFrameDemo`): las dos superficies cuentan la misma
 * historia con los mismos números, así que no pueden contradecirse.
 *
 * Tres decisiones deliberadas:
 *
 *  1. **Sin red y sin API.** El hero no puede depender de que el servicio de
 *     catálogo esté levantado para renderizar. Todo son datos locales.
 *  2. **Sin marcas reales.** Las tarjetas de coincidencia no llevan nombre de
 *     tienda: poner "Zara" o "Mango" en una tarjeta de demo insinúa un acuerdo
 *     comercial que no existe. La procedencia se expresa como el TIPO de fuente
 *     ("catálogo propio"), que es la afirmación verdadera.
 *  3. **Los tres estados del umbral están representados.** Cada escena tiene al
 *     menos una coincidencia publicada y una que no supera el criterio, porque
 *     "ante la duda no se publica" es parte del producto, no una nota al pie.
 *
 * Las categorías usadas son las reales del sistema (`lib/analysis/categories.ts`).
 */

/** Estado editorial de una coincidencia. Coincide con el discurso del umbral. */
export type MatchStatus = "published" | "review" | "withheld";

/**
 * Los tipos de clave son uniones de literales, no `string`, y eso es
 * deliberado.
 *
 * `global.d.ts` declara `Messages: typeof es`, así que `next-intl` comprueba en
 * tiempo de compilación que toda clave que se le pasa a `t()` existe. Los
 * componentes construyen las claves a partir de estos datos
 * (`t(\`objects.${object.key}\`)`); si `key` fuera `string`, el tipo resultante
 * sería `objects.${string}` —imposible de verificar— y TypeScript lo rechaza.
 *
 * Con uniones cerradas, el tipo resultante es la lista exacta de claves
 * posibles y el compilador las valida una por una. Consecuencia práctica: si
 * alguien añade un objeto a una escena y se olvida de su texto en
 * `messages/*.json`, no se descubre en producción con un `objects.xxx` en
 * pantalla — falla el typecheck.
 */
export type DemoItemKey =
  | "coat"
  | "bag"
  | "boot"
  | "armchair"
  | "lamp"
  | "cushion"
  | "watch"
  | "sneaker"
  | "headphones";

export type DemoSceneKey = "street" | "living" | "studio";

/** Categorías reales del sistema (`lib/analysis/categories.ts`). */
export type DemoCategory =
  | "clothing"
  | "footwear"
  | "watches_jewelry"
  | "bags_accessories"
  | "electronics"
  | "vehicles"
  | "furniture_home"
  | "decoration";

export type DemoRelationship = "worn" | "held" | "background";

export interface DemoMatch {
  id: string;
  /** Sufijo de clave i18n bajo `landing.demo.matches`. */
  key: DemoItemKey;
  category: DemoCategory;
  /**
   * Precio en euros como NÚMERO, no como cadena ya formateada.
   *
   * Antes era `"129,00 €"` literal, y eso hacía que la demo mostrase formato
   * español en las once localizaciones: un visitante en inglés veía la coma
   * como separador decimal. El formateo lo hace ahora `useFormatter` con el
   * locale activo (formato `eurPrice` en `i18n/formats.ts`).
   *
   * `null` = sin precio publicado, que es lo correcto para una coincidencia que
   * no supera el umbral.
   */
  priceEur: number | null;
  /** 0–1. Se muestra como porcentaje entero. */
  score: number;
  status: MatchStatus;
}

export interface DemoObject {
  id: string;
  /** Sufijo de clave i18n bajo `landing.demo.objects`. */
  key: DemoItemKey;
  /** Caja en porcentaje del frame: origen arriba-izquierda. */
  box: { x: number; y: number; w: number; h: number };
  confidence: number;
  /** Relación con la persona en escena — dirige la prioridad de búsqueda. */
  relationship: DemoRelationship;
  /** `DemoMatch.id` que resuelve este objeto. */
  matchId: string;
}

export interface DemoScene {
  id: string;
  /** Sufijo de clave i18n bajo `landing.demo.scenes`. */
  key: DemoSceneKey;
  /** Timestamp editorial de la escena dentro del vídeo. */
  timecode: string;
  /** Paleta de la ilustración del frame (no hay fotos: es SVG generado). */
  palette: { from: string; via: string; to: string };
  objects: readonly DemoObject[];
  matches: readonly DemoMatch[];
}

export const DEMO_SCENES: readonly DemoScene[] = [
  {
    id: "street",
    key: "street",
    timecode: "00:42",
    palette: { from: "#232544", via: "#12131f", to: "#08080e" },
    objects: [
      {
        id: "street-coat",
        key: "coat",
        box: { x: 30, y: 20, w: 30, h: 40 },
        confidence: 0.94,
        relationship: "worn",
        matchId: "street-coat",
      },
      {
        id: "street-bag",
        key: "bag",
        box: { x: 57, y: 46, w: 19, h: 20 },
        confidence: 0.89,
        relationship: "held",
        matchId: "street-bag",
      },
      {
        id: "street-boot",
        key: "boot",
        box: { x: 33, y: 72, w: 21, h: 16 },
        confidence: 0.76,
        relationship: "worn",
        matchId: "street-boot",
      },
    ],
    matches: [
      {
        id: "street-coat",
        key: "coat",
        category: "clothing",
        priceEur: 129,
        score: 0.93,
        status: "published",
      },
      {
        id: "street-bag",
        key: "bag",
        category: "bags_accessories",
        priceEur: 89.95,
        score: 0.86,
        status: "published",
      },
      {
        id: "street-boot",
        key: "boot",
        category: "footwear",
        priceEur: null,
        score: 0.61,
        status: "review",
      },
    ],
  },
  {
    id: "living",
    key: "living",
    timecode: "01:18",
    palette: { from: "#2a2038", via: "#161221", to: "#09070d" },
    objects: [
      {
        id: "living-armchair",
        key: "armchair",
        box: { x: 22, y: 40, w: 34, h: 38 },
        confidence: 0.91,
        relationship: "background",
        matchId: "living-armchair",
      },
      {
        id: "living-lamp",
        key: "lamp",
        box: { x: 66, y: 18, w: 17, h: 34 },
        confidence: 0.87,
        relationship: "background",
        matchId: "living-lamp",
      },
      {
        id: "living-cushion",
        key: "cushion",
        box: { x: 28, y: 45, w: 15, h: 14 },
        confidence: 0.68,
        relationship: "background",
        matchId: "living-cushion",
      },
    ],
    matches: [
      {
        id: "living-armchair",
        key: "armchair",
        category: "furniture_home",
        priceEur: 540,
        score: 0.9,
        status: "published",
      },
      {
        id: "living-lamp",
        key: "lamp",
        category: "decoration",
        priceEur: 119,
        score: 0.84,
        status: "published",
      },
      {
        id: "living-cushion",
        key: "cushion",
        category: "decoration",
        priceEur: null,
        score: 0.42,
        status: "withheld",
      },
    ],
  },
  {
    id: "studio",
    key: "studio",
    timecode: "02:05",
    palette: { from: "#1b2c3f", via: "#101a26", to: "#07090d" },
    objects: [
      {
        id: "studio-watch",
        key: "watch",
        box: { x: 46, y: 33, w: 15, h: 14 },
        confidence: 0.92,
        relationship: "worn",
        matchId: "studio-watch",
      },
      {
        id: "studio-sneaker",
        key: "sneaker",
        box: { x: 30, y: 68, w: 24, h: 17 },
        confidence: 0.88,
        relationship: "worn",
        matchId: "studio-sneaker",
      },
      {
        id: "studio-headphones",
        key: "headphones",
        box: { x: 58, y: 16, w: 20, h: 18 },
        confidence: 0.71,
        relationship: "worn",
        matchId: "studio-headphones",
      },
    ],
    matches: [
      {
        id: "studio-watch",
        key: "watch",
        category: "watches_jewelry",
        priceEur: 249,
        score: 0.91,
        status: "published",
      },
      {
        id: "studio-sneaker",
        key: "sneaker",
        category: "footwear",
        priceEur: 94.9,
        score: 0.88,
        status: "published",
      },
      {
        id: "studio-headphones",
        key: "headphones",
        category: "electronics",
        priceEur: null,
        score: 0.58,
        status: "review",
      },
    ],
  },
] as const;

/** Duración de cada escena en la secuencia automática del hero, en ms. */
export const SCENE_DURATION_MS = 5200;

export function sceneById(id: string): DemoScene | undefined {
  return DEMO_SCENES.find((s) => s.id === id);
}

export function matchFor(scene: DemoScene, objectId: string): DemoMatch | undefined {
  const object = scene.objects.find((o) => o.id === objectId);
  if (!object) return undefined;
  return scene.matches.find((m) => m.id === object.matchId);
}

/** Tono visual por estado. Centralizado para que hero y demo no divergan. */
export const STATUS_TONE: Record<MatchStatus, "success" | "warning" | "muted"> = {
  published: "success",
  review: "warning",
  withheld: "muted",
};
