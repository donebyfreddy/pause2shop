/**
 * Fallback: lectura del dataset original desde Kaggle.
 *
 * ¿Por qué es un fallback y no la vía principal? Porque Kaggle no tiene un
 * endpoint paginado: la única forma de leer el dataset es descargar el archivo
 * completo (~570 MB), descomprimirlo y leer `styles.csv` más la carpeta
 * `images/`. Para importar 1.000 fichas eso es descargar 570 MB para usar 2 MB.
 * HuggingFace expone el mismo dataset paginado, así que se prefiere siempre.
 *
 * Kaggle se usa cuando HuggingFace no es alcanzable (caído, bloqueado por red
 * corporativa) y solo si hay credenciales. Además Kaggle exige aceptar las
 * condiciones del dataset desde la web con la propia cuenta: sin ese paso, la
 * API responde 403 y no hay forma de sortearlo programáticamente. Cuando eso
 * pasa se dice exactamente eso, en vez de reportar un error de red genérico.
 *
 * El archivo descargado es material de origen y se deja en un directorio de
 * staging reutilizable. Las IMÁGENES del catálogo no se sirven nunca desde ahí:
 * se suben a storage persistente igual que en la vía de HuggingFace.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { DatasetDescriptor, DatasetInfo, FashionDatasetRow } from "./types";

const KAGGLE_API = "https://www.kaggle.com/api/v1";

export function kaggleCredentials(
  env: NodeJS.ProcessEnv = process.env
): { username: string; key: string } | null {
  const username = env.KAGGLE_USERNAME?.trim();
  const key = env.KAGGLE_KEY?.trim();
  if (!username || !key) return null;
  return { username, key };
}

function stagingDir(descriptor: DatasetDescriptor): string {
  return join(tmpdir(), "pause2shop-datasets", descriptor.id);
}

function authHeader(creds: { username: string; key: string }): string {
  return `Basic ${Buffer.from(`${creds.username}:${creds.key}`).toString("base64")}`;
}

/**
 * Descarga y descomprime el archivo si no está ya en staging.
 *
 * Se usa el `unzip` del sistema en vez de añadir una dependencia de
 * descompresión: este camino es un fallback que puede no ejecutarse nunca, y no
 * merece cargar el bundle de producción con una librería para ello.
 */
async function ensureArchive(descriptor: DatasetDescriptor): Promise<string> {
  const creds = kaggleCredentials();
  if (!creds) {
    throw new Error(
      "Faltan KAGGLE_USERNAME y KAGGLE_KEY. Descárgalas de " +
        "https://www.kaggle.com/settings (Create New Token)."
    );
  }
  if (!descriptor.kaggleRef) {
    throw new Error(`El dataset "${descriptor.id}" no tiene equivalente en Kaggle.`);
  }

  const dir = stagingDir(descriptor);
  const csvPath = join(dir, "styles.csv");
  if (existsSync(csvPath)) return dir;

  await mkdir(dir, { recursive: true });
  const zipPath = join(dir, "dataset.zip");

  if (!existsSync(zipPath) || statSync(zipPath).size === 0) {
    const url = `${KAGGLE_API}/datasets/download/${descriptor.kaggleRef}`;
    const res = await fetch(url, {
      headers: { Authorization: authHeader(creds) },
      redirect: "follow",
    });
    if (res.status === 403) {
      throw new Error(
        `Kaggle devuelve 403 para "${descriptor.kaggleRef}". Casi siempre ` +
          "significa que la cuenta no ha aceptado las condiciones del dataset: " +
          `entra en https://www.kaggle.com/datasets/${descriptor.kaggleRef}, ` +
          "acepta las condiciones y reintenta. No se puede saltar desde la API."
      );
    }
    if (!res.ok || !res.body) {
      throw new Error(`Kaggle devolvió HTTP ${res.status} al descargar el dataset.`);
    }
    // Se escribe en streaming: el archivo ronda los 570 MB y cargarlo en un
    // Buffer reventaría la memoria del proceso.
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(zipPath));
  }

  await runUnzip(zipPath, dir);
  if (!existsSync(csvPath)) {
    throw new Error(
      `El archivo de Kaggle se descomprimió pero no contiene styles.csv en ${dir}.`
    );
  }
  return dir;
}

function runUnzip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-o", "-q", zipPath, "-d", destDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () =>
      reject(
        new Error(
          "No se encontró el comando `unzip`, necesario para el fallback de " +
            "Kaggle. Instálalo o usa la fuente huggingface."
        )
      )
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`unzip terminó con código ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Parser de CSV mínimo pero correcto con campos entrecomillados: los nombres de
 * producto del dataset llevan comas ("Turtle Check Men Navy Blue Shirt, Slim").
 * Un `split(",")` a secas desplazaría todas las columnas de esas filas.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

function cell(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toUpperCase() === "NA") return null;
  return trimmed;
}

function readStyles(dir: string): FashionDatasetRow[] {
  const raw = readFileSync(join(dir, "styles.csv"), "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string): number => header.indexOf(name);

  const rows: FashionDatasetRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const id = Number(cell(cols[idx("id")]));
    if (!Number.isFinite(id)) continue;
    const year = Number(cell(cols[idx("year")]));
    rows.push({
      id,
      gender: cell(cols[idx("gender")]),
      masterCategory: cell(cols[idx("masterCategory")]),
      subCategory: cell(cols[idx("subCategory")]),
      articleType: cell(cols[idx("articleType")]),
      baseColour: cell(cols[idx("baseColour")]),
      season: cell(cols[idx("season")]),
      year: Number.isFinite(year) ? year : null,
      usage: cell(cols[idx("usage")]),
      productDisplayName: cell(cols[idx("productDisplayName")]),
      // En Kaggle la imagen es un fichero local del staging, no una URL.
      imageUrl: join(dir, "images", `${id}.jpg`),
      rowIndex: rows.length,
    });
  }
  return rows;
}

let cachedRows: { dir: string; rows: FashionDatasetRow[] } | null = null;

async function loadRows(descriptor: DatasetDescriptor): Promise<FashionDatasetRow[]> {
  const dir = await ensureArchive(descriptor);
  if (cachedRows?.dir === dir) return cachedRows.rows;
  const rows = readStyles(dir);
  cachedRows = { dir, rows };
  return rows;
}

export async function inspectKaggle(
  descriptor: DatasetDescriptor
): Promise<DatasetInfo> {
  const base: DatasetInfo = {
    descriptor: { ...descriptor, provider: "kaggle" },
    totalRows: null,
    version: "unknown",
    sizeBytes: null,
    features: {},
    sample: null,
    reachable: false,
    unreachableReason: null,
  };
  if (!kaggleCredentials()) {
    base.unreachableReason =
      "Faltan KAGGLE_USERNAME y KAGGLE_KEY: el fallback de Kaggle está inactivo.";
    return base;
  }
  try {
    const rows = await loadRows(descriptor);
    base.totalRows = rows.length;
    base.sample = rows[0] ?? null;
    base.reachable = true;
    base.features = Object.fromEntries(
      descriptor.availableFields.map((f) => [f, f === "id" ? "int64" : "string"])
    );
  } catch (error) {
    base.unreachableReason = error instanceof Error ? error.message : String(error);
  }
  return base;
}

export async function* streamKaggleRows(
  descriptor: DatasetDescriptor,
  options: { offset: number; limit: number }
): AsyncGenerator<FashionDatasetRow, void, undefined> {
  const rows = await loadRows(descriptor);
  const end = Math.min(options.offset + options.limit, rows.length);
  for (let i = options.offset; i < end; i += 1) yield rows[i];
}

/** Lee la imagen del staging local. Devuelve null si la fila no la tiene. */
export async function loadKaggleImage(
  row: FashionDatasetRow
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!row.imageUrl || !existsSync(row.imageUrl)) return null;
  try {
    return { buffer: await readFile(row.imageUrl), contentType: "image/jpeg" };
  } catch {
    return null;
  }
}
