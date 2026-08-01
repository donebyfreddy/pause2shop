"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cropFromDataUrl } from "@/lib/crop";
import { deservesAutoSearch } from "@/lib/priority";
import { cropQualityScore } from "@/lib/video/tracker";
import type { DetectedItem, ProductMatchingMode } from "@/lib/types";
import type { DetectionMatchResult } from "@/lib/matching/types";
import type { VisualMatch } from "@/lib/visualSearch/types";

/**
 * Cola de matching visual en el cliente (Fase 13: cola C).
 *
 * Tras cada detección, encola los objetos prioritarios: genera el crop real
 * (canvas), lo envía a /api/vision/match-object y actualiza el estado por
 * objeto según llegan los resultados. Nunca bloquea el vídeo ni la detección.
 *
 * Calidad antes que prisa: si el crop de un objeto es pobre (pequeño/lejano),
 * se espera hasta MAX_WAIT_FOR_BETTER_CROP_MS por un encuadre mejor antes de
 * gastar una búsqueda externa. Los objetos de prioridad baja (plantas,
 * barandillas…) no consumen búsqueda automática.
 */

const MAX_PER_FRAME = Number(process.env.NEXT_PUBLIC_MAX_REVERSE_SEARCHES_PER_FRAME ?? "3");
const MAX_CONCURRENT = Number(process.env.NEXT_PUBLIC_MAX_CONCURRENT_MATCHES ?? "3");
const MIN_CROP_CONFIDENCE = Number(process.env.NEXT_PUBLIC_MIN_CROP_CONFIDENCE ?? "0.55");
// SUPERIOR al peor caso real del backend. Con el catálogo como fuente
// principal ese peor caso creció: la llamada incluye el embedding CLIP del
// recorte y el barrido del índice ANTES de cualquier camino externo (upload
// ~3s + enrichment 2.5s + Lens hasta 15s + fallback ~15s más). Medido en local
// con 1048 fichas: hasta ~25s por objeto con 3 en paralelo. Con 20s el
// navegador cancelaba peticiones que el servidor terminaba bien y la tarjeta
// se quedaba cargando para siempre.
const MATCH_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_VIDEO_MATCHING_TIMEOUT_MS ?? "60000");
/** Calidad mínima (área×confianza, 0-1) para buscar sin esperar mejor frame. */
const MIN_CROP_SEARCH_QUALITY = Number(
  process.env.NEXT_PUBLIC_MIN_CROP_SEARCH_QUALITY ?? "0.35"
);
/** Máximo que se espera por un encuadre mejor antes de buscar con el que haya. */
const MAX_WAIT_FOR_BETTER_CROP_MS = Number(
  process.env.NEXT_PUBLIC_MAX_WAIT_FOR_BETTER_CROP_MS ?? "4000"
);

export type SimilarCandidate = {
  title: string;
  link: string;
  imageUrl: string | null;
  store: string | null;
  price: number | null;
  currency: string | null;
};

export type MatchingEntry = {
  status: NonNullable<DetectedItem["matchingStatus"]>;
  match: VisualMatch | null;
  /** Los más similares visualmente, aunque no haya match fiable. */
  similarCandidates: SimilarCandidate[];
  providerUsed: string | null;
  fallbackUsed: boolean;
  cached: boolean;
  detail?: string;
  totalMs?: number;
  /** Fuente con la que el backend resolvió este objeto. */
  matchingMode?: ProductMatchingMode;
  /** El catálogo no bastó y se recurrió a la búsqueda externa. */
  externalFallbackUsed?: boolean;
  /**
   * CONTRATO PRINCIPAL: catálogo e Internet en bloques separados. Es lo que
   * pinta la UI; `match`/`similarCandidates` son la forma anterior y se
   * conservan para los componentes que aún no leen `detection`.
   */
  detection?: DetectionMatchResult;
  /** true mientras se resuelve una búsqueda externa pedida a mano. */
  externalLoading?: boolean;
  /**
   * Etapa en curso, para que la tarjeta diga en qué se está tardando en vez de
   * enseñar un esqueleto estático que no cambia nunca.
   */
  phase?: "queued" | "cropping" | "searching";
  /** `Date.now()` del inicio del intento: la UI cronometra desde aquí. */
  startedAt?: number;
};

/**
 * Fingerprint de cliente. El nombre generado por la IA NO es el identificador
 * principal: se refuerza con subcategoría, patrón y marca — dos camisas
 * distintas (lisa vs floral, o marcas distintas) no colapsan, y la misma
 * camisa con un nombre ligeramente distinto sí (solo 3 primeras palabras).
 * Acepta items de visión (snake_case) y filas del catálogo (camelCase).
 */
export function clientFingerprint(item: {
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  color?: string | null;
  pattern?: string | null;
  visible_brand?: string | null;
  visibleBrand?: string | null;
}): string {
  const norm = (s?: string | null) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();
  const name = norm(item.name).split(/\s+/).slice(0, 3).join(" ");
  const brand = norm(item.visible_brand ?? item.visibleBrand);
  return [
    name,
    norm(item.category),
    norm(item.subcategory),
    norm(item.color),
    norm(item.pattern),
    brand,
  ].join("|");
}

type EnqueueMeta = {
  videoKey?: string;
  itemIdByFingerprint?: Map<string, string>;
  /** Fuente de coincidencias elegida por el usuario para este análisis. */
  matchingMode?: ProductMatchingMode;
  /**
   * Segundo del vídeo del frame. Viaja al backend y vuelve en
   * `detection.timestampSeconds` para que un resultado quede anclado al
   * instante en que se detectó y no se confunda con el de otro frame.
   */
  timestampSeconds?: number | null;
};

/** Forma de la respuesta de /api/vision/match-object que consume el hook. */
type MatchObjectPayload = {
  ok: boolean;
  status?: MatchingEntry["status"] | "storage_unavailable";
  match?: VisualMatch | null;
  similarCandidates?: SimilarCandidate[];
  providerUsed?: string | null;
  fallbackUsed?: boolean;
  cached?: boolean;
  detail?: string;
  timings?: { totalMs?: number };
  error?: string;
  matchingMode?: ProductMatchingMode;
  matching?: { externalFallbackUsed?: boolean };
  detection?: DetectionMatchResult;
};

type PendingBetterCrop = {
  item: DetectedItem;
  frameDataUrl: string;
  meta: EnqueueMeta;
  quality: number;
  timer: ReturnType<typeof setTimeout>;
};

/** Estado de intentos por fingerprint: sustituye al antiguo Set "attempted"
 * (un solo intento para siempre). Permite retry con crop mejor o tras fallo. */
export type MatchingAttemptState = {
  attempts: number;
  lastCropQuality: number;
  lastStatus: MatchingEntry["status"] | null;
  lastAttemptAt: number;
  inFlight: boolean;
};

const MAX_MATCH_ATTEMPTS = Number(
  process.env.NEXT_PUBLIC_MAX_MATCH_ATTEMPTS_PER_TRACK ?? "3"
);
const RETRY_COOLDOWN_MS = Number(
  process.env.NEXT_PUBLIC_MATCH_RETRY_COOLDOWN_MS ?? "5000"
);
/** Mejora mínima de calidad del crop para justificar un reintento. */
const BEST_CROP_IMPROVEMENT_THRESHOLD = Number(
  process.env.NEXT_PUBLIC_BEST_CROP_IMPROVEMENT_THRESHOLD ?? "0.12"
);

/** Estados tras los que un crop mejor o el cooldown permiten reintentar. */
const RETRYABLE_STATUSES = new Set<MatchingEntry["status"]>([
  "no_match",
  "similar_only",
  "provider_error",
]);

/**
 * ¿Se permite un nuevo intento para este fingerprint? (pura, exportada para
 * tests). Un match "matched" no se repite; los estados reintentables exigen
 * cooldown Y (crop mejor O fallo de proveedor); tope de intentos siempre.
 */
export function canRetryMatching(
  state: MatchingAttemptState | undefined,
  newCropQuality: number,
  now: number
): boolean {
  if (!state) return true;
  if (state.inFlight) return false;
  if (state.attempts >= MAX_MATCH_ATTEMPTS) return false;
  if (state.lastStatus === "matched") return false;
  if (state.lastStatus === null || !RETRYABLE_STATUSES.has(state.lastStatus)) {
    return false;
  }
  if (now - state.lastAttemptAt < RETRY_COOLDOWN_MS) return false;
  const betterCrop =
    newCropQuality - state.lastCropQuality >= BEST_CROP_IMPROVEMENT_THRESHOLD;
  return betterCrop || state.lastStatus === "provider_error";
}

/** Lo necesario para repetir la búsqueda de un objeto a petición del usuario. */
type LastRequest = {
  item: DetectedItem;
  frameDataUrl: string;
  meta: EnqueueMeta;
};

export function useObjectMatching() {
  const [results, setResults] = useState<Map<string, MatchingEntry>>(new Map());
  const attempts = useRef(new Map<string, MatchingAttemptState>());
  const active = useRef(0);
  const queue = useRef<Array<() => Promise<void>>>([]);
  /** Hay un vaciado en curso: evita arrancar dos bucles sobre la misma cola. */
  const draining = useRef(false);
  /** Objetos con crop pobre esperando un encuadre mejor, por fingerprint. */
  const pendingBetter = useRef(new Map<string, PendingBetterCrop>());
  /**
   * Último frame+item con el que se buscó cada objeto. Hace falta para poder
   * regenerar SU crop cuando el usuario pulsa "Buscar también en Internet":
   * sin esto habría que pedirle que rebobine el vídeo al frame exacto.
   */
  const lastRequest = useRef(new Map<string, LastRequest>());
  /** Fingerprints con búsqueda externa ya pedida: no se paga dos veces. */
  const externalRequested = useRef(new Set<string>());

  const setEntry = useCallback((fp: string, entry: Partial<MatchingEntry>) => {
    setResults((prev) => {
      const next = new Map(prev);
      const current: MatchingEntry =
        next.get(fp) ?? {
          status: "pending",
          match: null,
          similarCandidates: [],
          providerUsed: null,
          fallbackUsed: false,
          cached: false,
        };
      next.set(fp, { ...current, ...entry });
      return next;
    });
  }, []);

  /**
   * Vacía la cola con CONCURRENCIA LIMITADA y aislamiento de fallos.
   *
   * `Promise.allSettled` y no `Promise.all`: las detecciones de un frame se
   * resuelven en paralelo y son independientes entre sí. Con `all`, un objeto
   * cuyo crop falle o cuyo proveedor dé error aborta la espera de los demás y
   * el usuario pierde coincidencias que sí estaban listas. Con `allSettled`
   * cada detección vive o muere sola.
   *
   * Se lanzan tandas de `MAX_CONCURRENT` en vez de todo a la vez porque el
   * cuello es la base de datos: medido con 10.000 productos, 1 detección son
   * ~260 ms y 5 simultáneas ~2.300 ms — más allá de 3 en vuelo la cola solo
   * añade espera.
   *
   * Sin recursión al terminar, y no hace falta: el `while` vuelve a mirar la
   * cola tras cada tanda, así que recoge lo que haya entrado durante el
   * `await`. Y entre la última comprobación y `draining = false` no puede
   * colarse nada —ese tramo es síncrono—, de modo que un `enqueue` posterior
   * encontrará la puerta abierta y arrancará su propio vaciado.
   */
  const pump = useCallback(() => {
    if (draining.current) return;
    draining.current = true;

    void (async () => {
      try {
        while (queue.current.length > 0) {
          const batch = queue.current.splice(0, MAX_CONCURRENT);
          active.current = batch.length;
          await Promise.allSettled(batch.map((task) => task()));
          active.current = 0;
        }
      } finally {
        draining.current = false;
      }
    })();
  }, []);

  /** Registra el desenlace de un intento en el estado reintentable. */
  const finishAttempt = useCallback(
    (fp: string, status: MatchingEntry["status"]) => {
      const state = attempts.current.get(fp);
      if (state) {
        state.inFlight = false;
        state.lastStatus = status;
      }
    },
    []
  );

  /**
   * Una petición de matching, del crop a la actualización de estado.
   * Compartida por la búsqueda automática y por la que pide el usuario: el
   * único parámetro que cambia es `forceExternal`, así que duplicar el fetch
   * sería la forma más fácil de que las dos rutas divergieran.
   */
  const runMatch = useCallback(
    async (
      fp: string,
      item: DetectedItem,
      frameDataUrl: string,
      meta: EnqueueMeta,
      opts: { forceExternal?: boolean } = {}
    ): Promise<void> => {
      setEntry(fp, { phase: "cropping", startedAt: Date.now() });
      try {
        const crop = await cropFromDataUrl(frameDataUrl, item.bounding_box!);
        if (!crop) {
          finishAttempt(fp, "no_match");
          setEntry(fp, {
            status: "no_match",
            externalLoading: false,
            detail: "No hay suficiente detalle visual para identificar el producto exacto.",
          });
          return;
        }
        setEntry(fp, { phase: "searching" });
        const res = await fetch("/api/vision/match-object", {
          method: "POST",
          signal: AbortSignal.timeout(MATCH_TIMEOUT_MS),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            crop,
            item,
            videoKey: meta.videoKey,
            itemId: meta.itemIdByFingerprint?.get(fp),
            matchingMode: meta.matchingMode,
            // El fingerprint ES el detectionId: la misma identidad que usa la
            // UI para casar tarjeta y bounding box entre frames.
            detectionId: fp,
            timestampSeconds: meta.timestampSeconds ?? null,
            forceExternal: opts.forceExternal === true,
          }),
        });
        const data = (await res.json()) as MatchObjectPayload;
        if (!data.ok) {
          finishAttempt(fp, "provider_error");
          setEntry(fp, {
            status: "provider_error",
            detail: data.error,
            externalLoading: false,
          });
          return;
        }
        const status: MatchingEntry["status"] =
          data.status === "storage_unavailable"
            ? "provider_error"
            : (data.status ?? "no_match");
        finishAttempt(fp, status);
        setEntry(fp, {
          status,
          match: data.match ?? null,
          similarCandidates: data.similarCandidates ?? [],
          providerUsed: data.providerUsed ?? null,
          fallbackUsed: Boolean(data.fallbackUsed),
          cached: Boolean(data.cached),
          detail: data.detail,
          totalMs: data.timings?.totalMs,
          matchingMode: data.matchingMode,
          externalFallbackUsed: Boolean(data.matching?.externalFallbackUsed),
          detection: data.detection,
          externalLoading: false,
          phase: undefined,
        });
      } catch (err) {
        const timeout =
          err instanceof Error &&
          (err.name === "TimeoutError" || err.name === "AbortError");
        finishAttempt(fp, "provider_error");
        setEntry(fp, {
          status: "provider_error",
          externalLoading: false,
          detail: timeout ? "Timeout del matching" : "Error de red",
        });
      }
    },
    [setEntry, finishAttempt]
  );

  /** Crea y encola la tarea real de matching para un objeto. */
  const pushTask = useCallback(
    (fp: string, item: DetectedItem, frameDataUrl: string, meta: EnqueueMeta, quality: number) => {
      const prev = attempts.current.get(fp);
      attempts.current.set(fp, {
        attempts: (prev?.attempts ?? 0) + 1,
        lastCropQuality: quality,
        lastStatus: prev?.lastStatus ?? null,
        lastAttemptAt: Date.now(),
        inFlight: true,
      });
      // Se recuerda el frame para poder repetir la búsqueda de ESTE objeto si
      // el usuario pide Internet más tarde, ya con el vídeo en otro punto.
      lastRequest.current.set(fp, { item, frameDataUrl, meta });
      setEntry(fp, { status: "searching" });
      queue.current.push(() => runMatch(fp, item, frameDataUrl, meta));
    },
    [setEntry, runMatch]
  );

  /**
   * Búsqueda externa a PETICIÓN del usuario ("Buscar también en Internet").
   *
   * Es la única vía por la que se gasta una llamada externa cuando el catálogo
   * ya había resuelto, y se cobra una sola vez por objeto: repetir el clic no
   * vuelve a pagar (además de la caché por hash de crop del servidor).
   */
  const requestExternal = useCallback(
    (fp: string): void => {
      const req = lastRequest.current.get(fp);
      if (!req) return;
      if (externalRequested.current.has(fp)) return;
      externalRequested.current.add(fp);
      setEntry(fp, { externalLoading: true });
      queue.current.push(() =>
        runMatch(fp, req.item, req.frameDataUrl, req.meta, { forceExternal: true })
      );
      pump();
    },
    [runMatch, setEntry, pump]
  );

  /**
   * Encola matching para los objetos prioritarios de un frame.
   * Selección: con bounding box + confianza mínima + prioridad comercial,
   * orden por relevancia de compra, máximo MAX_PER_FRAME, sin repetir
   * fingerprints ya buscados. Los crops pobres esperan un encuadre mejor.
   */
  const enqueue = useCallback(
    (items: DetectedItem[], frameDataUrl: string, meta: EnqueueMeta = {}) => {
      const now = Date.now();
      const candidates = items
        .filter((it) => {
          if (!it.bounding_box || it.confidence < MIN_CROP_CONFIDENCE) return false;
          if (!deservesAutoSearch(it)) return false;
          const fp = clientFingerprint(it);
          const quality = cropQualityScore(it.bounding_box, it.confidence);
          return canRetryMatching(attempts.current.get(fp), quality, now);
        })
        .sort(
          (a, b) =>
            (b.purchase_relevance ?? b.confidence) - (a.purchase_relevance ?? a.confidence)
        )
        .slice(0, MAX_PER_FRAME);

      for (const item of candidates) {
        const fp = clientFingerprint(item);
        const quality = cropQualityScore(item.bounding_box, item.confidence);
        const pending = pendingBetter.current.get(fp);

        if (quality >= MIN_CROP_SEARCH_QUALITY) {
          // Encuadre suficiente: si esperaba mejor crop, ya lo tiene.
          if (pending) {
            clearTimeout(pending.timer);
            pendingBetter.current.delete(fp);
          }
          pushTask(fp, item, frameDataUrl, meta, quality);
          continue;
        }

        if (pending) {
          // Ya en espera: solo actualiza si este encuadre es mejor.
          if (quality > pending.quality) {
            pending.item = item;
            pending.frameDataUrl = frameDataUrl;
            pending.meta = meta;
            pending.quality = quality;
          }
          continue;
        }

        // Crop pobre: esperar (acotado) por un encuadre mejor antes de gastar API.
        setEntry(fp, { status: "pending", detail: "Esperando un encuadre mejor…" });
        const timer = setTimeout(() => {
          const p = pendingBetter.current.get(fp);
          pendingBetter.current.delete(fp);
          if (p && canRetryMatching(attempts.current.get(fp), p.quality, Date.now())) {
            pushTask(fp, p.item, p.frameDataUrl, p.meta, p.quality);
            pump();
          }
        }, MAX_WAIT_FOR_BETTER_CROP_MS);
        pendingBetter.current.set(fp, { item, frameDataUrl, meta, quality, timer });
      }
      pump();
    },
    [pump, pushTask, setEntry]
  );

  const reset = useCallback(() => {
    attempts.current.clear();
    queue.current = [];
    for (const p of pendingBetter.current.values()) clearTimeout(p.timer);
    pendingBetter.current.clear();
    lastRequest.current.clear();
    externalRequested.current.clear();
    setResults(new Map());
  }, []);

  // Limpieza de timers al desmontar.
  useEffect(() => {
    const pending = pendingBetter.current;
    return () => {
      for (const p of pending.values()) clearTimeout(p.timer);
    };
  }, []);

  return { results, enqueue, reset, requestExternal };
}
