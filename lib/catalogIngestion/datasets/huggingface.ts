/**
 * Lectura del dataset desde el dataset-viewer de HuggingFace.
 *
 * DECISIÓN IMPORTANTE: no se descarga el parquet completo. El split pesa 275 MB
 * comprimido / 636 MB en memoria y tiene 44.072 filas; bajarlo entero para
 * importar 1.000 fichas sería absurdo, no cabría en el disco de una lambda y
 * tardaría minutos antes de guardar el primer producto.
 *
 * En su lugar se usa `GET /rows?offset&length`, que pagina el split y devuelve
 * los metadatos junto a una URL firmada de cada imagen. Así se lee solo lo
 * necesario, el progreso es visible desde la primera página y el offset de la
 * página es exactamente el checkpoint que hace la importación reanudable.
 *
 * Contrapartida a tener en cuenta: las URLs de imagen que devuelve vienen
 * firmadas y caducan (~días). Hay que descargar la imagen durante la
 * importación, no guardar la URL para después. Por eso la imagen se sube a
 * storage propio y lo que se persiste es NUESTRA url, no la de HuggingFace.
 */
import type { DatasetDescriptor, DatasetInfo, FashionDatasetRow } from "./types";

const VIEWER = "https://datasets-server.huggingface.co";

/** Tope del endpoint /rows. Pedir más devuelve 422. */
export const MAX_ROWS_PER_REQUEST = 100;

function authHeaders(): Record<string, string> {
  // El dataset es público: HF_TOKEN es opcional. Se manda si está porque sube
  // el límite de peticiones por hora y evita el 429 en importaciones grandes.
  const token = process.env.HF_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * `fetch` con reintentos y backoff. Solo reintenta lo que tiene sentido
 * reintentar: 429 y 5xx son transitorios, un 404 no lo es y reintentarlo cinco
 * veces solo hace perder 30 segundos antes de dar el mismo error.
 */
/**
 * Error que NO debe reintentarse. Existe como clase propia porque, cuando el
 * `throw` de "esto no tiene arreglo" vive dentro del mismo `try` que envuelve al
 * `fetch`, el `catch` del reintento lo captura y lo reintenta igualmente: el
 * código dice que no reintenta un 404 y lo reintenta cuatro veces. Marcarlo y
 * comprobarlo en el catch es lo que hace que la intención se cumpla.
 */
class NonRetryableHttpError extends Error {}

async function fetchWithRetry(
  url: string,
  options: { attempts?: number; timeoutMs?: number } = {}
): Promise<Response> {
  const attempts = options.attempts ?? 4;
  const timeoutMs = options.timeoutMs ?? 30_000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: authHeaders(),
        signal: controller.signal,
      });
      if (res.ok) return res;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) {
        throw new NonRetryableHttpError(`HTTP ${res.status} ${res.statusText} en ${url}`);
      }
      if (attempt === attempts) {
        throw new Error(`HTTP ${res.status} ${res.statusText} en ${url}`);
      }
      // Se respeta Retry-After cuando el servidor lo indica: adivinar por
      // debajo de lo que pide solo provoca otro 429.
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      lastError = new Error(`HTTP ${res.status}`);
      await sleep(waitMs);
    } catch (error) {
      // Un 404 o un 401 no mejoran esperando: se propagan a la primera.
      if (error instanceof NonRetryableHttpError) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === attempts) break;
      await sleep(2 ** attempt * 500);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error(`No se pudo leer ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ViewerRow = {
  row_idx: number;
  row: Record<string, unknown>;
};

/** Convierte una fila del viewer al tipo interno, sin inventar nada. */
function toDatasetRow(raw: ViewerRow): FashionDatasetRow | null {
  const r = raw.row;
  // Sin id no hay `sourceProductId`, y sin él no hay deduplicación posible: una
  // fila así se descarta en vez de importarse con una clave inventada.
  //
  // El descarte se comprueba ANTES de convertir: `Number(null)` es 0, que es
  // finito, así que una fila con `id: null` pasaba el filtro y entraba al
  // catálogo como el producto "0". Igual con `""`, que también da 0.
  if (r.id === null || r.id === undefined || r.id === "") return null;
  const id = typeof r.id === "number" ? r.id : Number(r.id);
  if (!Number.isFinite(id)) return null;

  const image = r.image as { src?: unknown } | null | undefined;
  const year = typeof r.year === "number" ? r.year : Number(r.year);

  return {
    id,
    gender: str(r.gender),
    masterCategory: str(r.masterCategory),
    subCategory: str(r.subCategory),
    articleType: str(r.articleType),
    baseColour: str(r.baseColour),
    season: str(r.season),
    year: Number.isFinite(year) ? year : null,
    usage: str(r.usage),
    productDisplayName: str(r.productDisplayName),
    imageUrl: typeof image?.src === "string" ? image.src : null,
    rowIndex: raw.row_idx,
  };
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // El dataset usa la cadena "NA" para huecos en varias columnas. Tratarla como
  // valor real llenaría el catálogo de productos de color "NA".
  if (!trimmed || trimmed.toUpperCase() === "NA") return null;
  return trimmed;
}

/** Lee una página de filas. `length` se recorta al máximo del endpoint. */
export async function fetchRows(
  descriptor: DatasetDescriptor,
  offset: number,
  length: number
): Promise<FashionDatasetRow[]> {
  const size = Math.min(Math.max(1, length), MAX_ROWS_PER_REQUEST);
  const url =
    `${VIEWER}/rows?dataset=${encodeURIComponent(descriptor.repo)}` +
    `&config=${encodeURIComponent(descriptor.config)}` +
    `&split=${encodeURIComponent(descriptor.split)}` +
    `&offset=${offset}&length=${size}`;

  const res = await fetchWithRetry(url);
  const body = (await res.json()) as { rows?: ViewerRow[] };
  const rows = body.rows ?? [];
  // Las filas ilegibles se omiten aquí en silencio y el contador de la
  // diferencia (pedidas vs devueltas) lo registra el importador: una fila
  // corrupta no puede parar una importación de mil.
  return rows.map(toDatasetRow).filter((r): r is FashionDatasetRow => r !== null);
}

/**
 * Generador perezoso sobre el split. Pide páginas de como mucho 100 filas y
 * las va cediendo: el consumidor nunca tiene más de una página en memoria,
 * independientemente de si importa 10 fichas o 44.000.
 */
export async function* streamRows(
  descriptor: DatasetDescriptor,
  options: { offset: number; limit: number; pageSize?: number }
): AsyncGenerator<FashionDatasetRow, void, undefined> {
  const pageSize = Math.min(options.pageSize ?? MAX_ROWS_PER_REQUEST, MAX_ROWS_PER_REQUEST);
  let cursor = options.offset;
  const end = options.offset + options.limit;

  while (cursor < end) {
    const want = Math.min(pageSize, end - cursor);
    const page = await fetchRows(descriptor, cursor, want);
    // Página vacía = fin del split. Sin esta salida, pedir un offset más allá
    // del final daría un bucle infinito.
    if (page.length === 0) return;
    for (const row of page) yield row;
    cursor += want;
  }
}

/** Metadatos del dataset. No escribe nada: es la comprobación previa. */
export async function inspectDataset(
  descriptor: DatasetDescriptor
): Promise<DatasetInfo> {
  const base: DatasetInfo = {
    descriptor,
    totalRows: null,
    version: "unknown",
    sizeBytes: null,
    features: {},
    sample: null,
    reachable: false,
    unreachableReason: null,
  };

  try {
    const infoUrl = `${VIEWER}/info?dataset=${encodeURIComponent(descriptor.repo)}`;
    const res = await fetchWithRetry(infoUrl, { attempts: 2, timeoutMs: 20_000 });
    const body = (await res.json()) as {
      dataset_info?: Record<
        string,
        {
          features?: Record<string, { dtype?: string; _type?: string }>;
          splits?: Record<string, { num_examples?: number; num_bytes?: number }>;
        }
      >;
    };
    const config = body.dataset_info?.[descriptor.config];
    const split = config?.splits?.[descriptor.split];

    const features: Record<string, string> = {};
    for (const [name, spec] of Object.entries(config?.features ?? {})) {
      features[name] = spec.dtype ?? spec._type ?? "unknown";
    }

    base.totalRows = split?.num_examples ?? null;
    base.sizeBytes = split?.num_bytes ?? null;
    base.features = features;
    base.reachable = true;
  } catch (error) {
    base.unreachableReason = error instanceof Error ? error.message : String(error);
    return base;
  }

  // La revisión sale de la URL firmada de la imagen: el viewer la incrusta como
  // `/--/<revision>/--/`. Es la única forma de saber contra qué commit se
  // importó sin llamar a la API del Hub.
  try {
    const sample = await fetchRows(descriptor, 0, 1);
    base.sample = sample[0] ?? null;
    const revision = sample[0]?.imageUrl?.match(/\/--\/([0-9a-f]{40})\/--\//)?.[1];
    if (revision) base.version = revision;
  } catch {
    // Los metadatos ya se leyeron; no poder traer la muestra no invalida el
    // inspect, así que se deja `sample: null` y sigue siendo alcanzable.
  }

  return base;
}

/** Descarga los bytes de una imagen. Devuelve null en vez de lanzar. */
export async function downloadImage(
  url: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetchWithRetry(url, { attempts: 3, timeoutMs: 20_000 });
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0) return null;
    return { buffer, contentType };
  } catch {
    return null;
  }
}
