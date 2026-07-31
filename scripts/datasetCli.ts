/**
 * Utilidades compartidas de los scripts `catalog:dataset:*`.
 *
 * Se separan del script porque los cinco comandos parsean las mismas opciones y
 * necesitan el mismo arranque de entorno. Duplicarlo era garantía de que
 * `--limit` acabase significando cosas distintas en cada comando.
 */
import type { DatasetImportOptions } from "../lib/catalogIngestion/datasets/types";

export interface ParsedArgs {
  flags: Map<string, string>;
  booleans: Set<string>;
  positionals: string[];
}

/**
 * Parsea `--clave=valor`, `--clave valor` y `--flag`.
 *
 * Acepta las dos formas porque npm reescribe los argumentos de forma distinta
 * según la versión y según si se usa `--` o no: soportar solo una convierte un
 * detalle del gestor de paquetes en un fallo del importador.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(body, next);
      i += 1;
    } else {
      booleans.add(body);
      // Un flag suelto también se registra como "true" para que
      // `--dry-run` y `--dry-run=true` se comporten igual.
      flags.set(body, "true");
    }
  }
  return { flags, booleans, positionals };
}

function num(parsed: ParsedArgs, ...names: string[]): number | undefined {
  for (const name of names) {
    const raw = parsed.flags.get(name);
    if (raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`--${name} debe ser un número, se recibió "${raw}"`);
    }
    return Math.trunc(value);
  }
  return undefined;
}

function bool(parsed: ParsedArgs, ...names: string[]): boolean | undefined {
  for (const name of names) {
    const raw = parsed.flags.get(name);
    if (raw === undefined) continue;
    const value = raw.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(value)) return true;
    if (["false", "0", "no", "n"].includes(value)) return false;
    throw new Error(`--${name} debe ser true o false, se recibió "${raw}"`);
  }
  return undefined;
}

function list(parsed: ParsedArgs, ...names: string[]): string[] | undefined {
  for (const name of names) {
    const raw = parsed.flags.get(name);
    if (raw === undefined) continue;
    return raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return undefined;
}

/** Opciones de importación desde argv. Solo devuelve lo pedido explícitamente. */
export function optionsFromArgs(parsed: ParsedArgs): Partial<DatasetImportOptions> {
  const source = parsed.flags.get("source");
  if (source && source !== "huggingface" && source !== "kaggle") {
    throw new Error(`--source debe ser huggingface o kaggle, se recibió "${source}"`);
  }

  const out: Partial<DatasetImportOptions> = {};
  // El estrechamiento del `if` de arriba ya garantiza el literal, pero TS no lo
  // arrastra hasta aquí a través de `string | undefined`.
  if (source) out.source = source as DatasetImportOptions["source"];
  const limit = num(parsed, "limit");
  if (limit !== undefined) out.limit = limit;
  const offset = num(parsed, "offset");
  if (offset !== undefined) out.offset = offset;
  const batchSize = num(parsed, "batch-size", "batchSize");
  if (batchSize !== undefined) out.batchSize = batchSize;
  const categories = list(parsed, "categories", "category");
  if (categories) out.categories = categories;
  const genders = list(parsed, "genders", "gender");
  if (genders) out.genders = genders;
  const generateEmbeddings = bool(parsed, "generate-embeddings", "generateEmbeddings");
  if (generateEmbeddings !== undefined) out.generateEmbeddings = generateEmbeddings;
  const uploadImages = bool(parsed, "upload-images", "uploadImages");
  if (uploadImages !== undefined) out.uploadImages = uploadImages;
  const dryRun = bool(parsed, "dry-run", "dryRun");
  if (dryRun !== undefined) out.dryRun = dryRun;
  const datasetId = parsed.flags.get("dataset");
  if (datasetId) out.datasetId = datasetId;
  return out;
}

const RESET = "[0m";
const COLORS: Record<string, string> = {
  info: "[36m",
  ok: "[32m",
  warn: "[33m",
  err: "[31m",
  dim: "[2m",
};

export function paint(tone: keyof typeof COLORS, text: string): string {
  // Sin TTY (CI, pipes) no se colorea: los códigos de escape ensucian los logs.
  if (!process.stdout.isTTY) return text;
  return `${COLORS[tone] ?? ""}${text}${RESET}`;
}

export function line(level: "INFO" | "SUCCESS" | "WARN" | "ERROR", tag: string, message: string): void {
  const tone = level === "SUCCESS" ? "ok" : level === "WARN" ? "warn" : level === "ERROR" ? "err" : "info";
  console.log(`${paint(tone, level.padEnd(7))} ${paint("dim", tag.padEnd(9))} ${message}`);
}

/** Barra de progreso en una sola línea reescrita. */
export function progressBar(done: number, total: number, suffix: string): void {
  if (!process.stdout.isTTY) return;
  const width = 24;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = String(Math.round(ratio * 100)).padStart(3);
  process.stdout.write(`\r${paint("info", bar)} ${pct}%  ${suffix}   `);
}

export function endProgress(): void {
  if (process.stdout.isTTY) process.stdout.write("\n");
}
