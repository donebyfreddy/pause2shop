import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  fetchRows,
  MAX_ROWS_PER_REQUEST,
  streamRows,
} from "../../lib/catalogIngestion/datasets/huggingface";
import { FASHION_PRODUCT_IMAGES_SMALL } from "../../lib/catalogIngestion/datasets/registry";
import { getReader } from "../../lib/catalogIngestion/datasets/reader";

/**
 * Lector de HuggingFace contra un `fetch` falso.
 *
 * Se prueba la LECTURA, no HuggingFace: paginación, tolerancia a filas
 * ilegibles, tratamiento de "NA" y el reintento. Tocar la red aquí haría los
 * tests lentos y dependientes de que un dataset ajeno no cambie.
 */

const DESCRIPTOR = FASHION_PRODUCT_IMAGES_SMALL;
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type FakeCall = { url: string };

function viewerRow(id: number, rowIdx: number, overrides: Record<string, unknown> = {}) {
  return {
    row_idx: rowIdx,
    row: {
      id,
      gender: "Men",
      masterCategory: "Apparel",
      subCategory: "Topwear",
      articleType: "Shirts",
      baseColour: "Navy Blue",
      season: "Fall",
      year: 2011.0,
      usage: "Casual",
      productDisplayName: `Puma Men Producto ${id}`,
      image: { src: `https://cdn.test/${id}.jpg`, width: 60, height: 80 },
      ...overrides,
    },
  };
}

function installFetch(
  handler: (url: string, attempt: number) => { status?: number; body?: unknown; headers?: Record<string, string> }
): FakeCall[] {
  const calls: FakeCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url });
    const attempt = calls.filter((c) => c.url === url).length;
    const result = handler(url, attempt);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      headers: new Headers(result.headers ?? {}),
      json: async () => result.body,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response;
  }) as typeof fetch;
  return calls;
}

test("lee una página y normaliza los tipos", async () => {
  installFetch(() => ({ body: { rows: [viewerRow(15970, 0)] } }));
  const rows = await fetchRows(DESCRIPTOR, 0, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 15970);
  // `year` llega como float64 (2011.0) y debe quedar numérico.
  assert.equal(rows[0].year, 2011);
  assert.equal(rows[0].imageUrl, "https://cdn.test/15970.jpg");
  assert.equal(rows[0].rowIndex, 0);
});

test('la cadena "NA" del dataset se trata como hueco, no como valor', async () => {
  // Sin esto el catálogo se llena de productos de color "NA" y temporada "NA".
  installFetch(() => ({
    body: { rows: [viewerRow(1, 0, { baseColour: "NA", season: "NA", usage: "  " })] },
  }));
  const [row] = await fetchRows(DESCRIPTOR, 0, 1);
  assert.equal(row.baseColour, null);
  assert.equal(row.season, null);
  assert.equal(row.usage, null);
});

test("una fila sin id utilizable se descarta en vez de importarse con clave inventada", async () => {
  installFetch(() => ({
    body: {
      rows: [
        viewerRow(1, 0),
        { row_idx: 1, row: { id: null, productDisplayName: "sin id" } },
        viewerRow(3, 2),
      ],
    },
  }));
  const rows = await fetchRows(DESCRIPTOR, 0, 3);
  // Sin id no hay `sourceProductId`, y sin él no hay deduplicación posible.
  assert.equal(rows.length, 2, "la fila sin id no pasa");
  assert.deepEqual(rows.map((r) => r.id), [1, 3]);
});

test("el tamaño de página se acota al máximo del endpoint", async () => {
  const calls = installFetch(() => ({ body: { rows: [] } }));
  await fetchRows(DESCRIPTOR, 0, 5000);
  // Pedir más de 100 devuelve 422 en el viewer: se recorta antes de salir.
  assert.ok(calls[0].url.includes(`length=${MAX_ROWS_PER_REQUEST}`));
  assert.ok(!calls[0].url.includes("length=5000"));
});

test("streamRows pagina y respeta el límite exacto", async () => {
  const calls = installFetch((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    const length = Number(new URL(url).searchParams.get("length"));
    return {
      body: {
        rows: Array.from({ length }, (_, i) => viewerRow(offset + i, offset + i)),
      },
    };
  });

  const seen: number[] = [];
  for await (const row of streamRows(DESCRIPTOR, { offset: 0, limit: 250, pageSize: 100 })) {
    seen.push(row.id);
  }
  assert.equal(seen.length, 250, "devuelve exactamente el límite pedido, ni una más");
  assert.equal(calls.length, 3, "250 filas en páginas de 100 son tres peticiones");
  // La última página pide solo lo que falta, no otras 100.
  assert.ok(calls[2].url.includes("length=50"));
});

test("streamVale respeta el offset inicial", async () => {
  const calls = installFetch((url) => {
    const offset = Number(new URL(url).searchParams.get("offset"));
    const length = Number(new URL(url).searchParams.get("length"));
    return { body: { rows: Array.from({ length }, (_, i) => viewerRow(offset + i, offset + i)) } };
  });
  const seen: number[] = [];
  for await (const row of streamRows(DESCRIPTOR, { offset: 500, limit: 10 })) seen.push(row.id);
  assert.deepEqual(seen, Array.from({ length: 10 }, (_, i) => 500 + i));
  assert.ok(calls[0].url.includes("offset=500"));
});

test("una página vacía termina el recorrido y no cuelga", async () => {
  // Sin esta salida, pedir un offset más allá del final sería un bucle infinito.
  installFetch(() => ({ body: { rows: [] } }));
  const seen: number[] = [];
  for await (const row of streamRows(DESCRIPTOR, { offset: 999_999, limit: 500 })) {
    seen.push(row.id);
  }
  assert.equal(seen.length, 0);
});

test("un 429 se reintenta y acaba saliendo bien", async () => {
  const calls = installFetch((_url, attempt) => {
    if (attempt === 1) return { status: 429, headers: { "retry-after": "0" } };
    return { body: { rows: [viewerRow(7, 0)] } };
  });
  const rows = await fetchRows(DESCRIPTOR, 0, 1);
  assert.equal(rows.length, 1);
  assert.equal(calls.length, 2, "hubo un reintento");
});

test("un 404 NO se reintenta: reintentarlo solo pierde tiempo", async () => {
  const calls = installFetch(() => ({ status: 404 }));
  await assert.rejects(() => fetchRows(DESCRIPTOR, 0, 1), /404/);
  assert.equal(calls.length, 1, "un error no transitorio se propaga a la primera");
});

test("un 500 se reintenta y, si persiste, se propaga", async () => {
  const calls = installFetch(() => ({ status: 500 }));
  await assert.rejects(() => fetchRows(DESCRIPTOR, 0, 1), /500/);
  assert.ok(calls.length > 1, "los 5xx sí son transitorios y se reintentan");
});

test("source=kaggle sin credenciales falla con un motivo accionable", () => {
  const saved = { user: process.env.KAGGLE_USERNAME, key: process.env.KAGGLE_KEY };
  delete process.env.KAGGLE_USERNAME;
  delete process.env.KAGGLE_KEY;
  try {
    assert.throws(() => getReader(DESCRIPTOR, "kaggle"), /KAGGLE_USERNAME/);
  } finally {
    if (saved.user) process.env.KAGGLE_USERNAME = saved.user;
    if (saved.key) process.env.KAGGLE_KEY = saved.key;
  }
});

test("source=huggingface no necesita credenciales", () => {
  const reader = getReader(DESCRIPTOR, "huggingface");
  assert.equal(reader.provider, "huggingface");
});
