/**
 * Deriva la lista de marcas verificadas del dataset. REPRODUCIBLE a propósito.
 *
 *   npm run catalog:dataset:brands
 *   npm run catalog:dataset:brands -- --sample=11200 --min-freq=4
 *
 * ¿Por qué existe? `lib/catalogIngestion/datasets/brands.ts` contiene una lista
 * de prefijos de marca. Una lista escrita a mano es una opinión; esta se obtiene
 * midiendo el dataset, y este script es la prueba de cómo se midió.
 *
 * El método: el nombre de producto sigue el patrón `<marca> <género> <resto>`,
 * así que el token de género da un límite objetivo para el candidato a marca.
 * Después se cuenta: una marca real aparece decenas de veces ("Peter England"),
 * mientras que un adjetivo que casualmente precede al género aparece una
 * ("Turtle Check"). El umbral de frecuencia es lo que separa marca de ruido.
 *
 * Imprime la lista y las diferencias con la que hay en el código, para que
 * actualizarla sea copiar y pegar en vez de fiarse de la memoria.
 */
import { loadEnv } from "./loadEnv";

loadEnv();

import { brandAllowlist } from "../lib/catalogIngestion/datasets/brands";
import { fetchRows, MAX_ROWS_PER_REQUEST } from "../lib/catalogIngestion/datasets/huggingface";
import { getDataset } from "../lib/catalogIngestion/datasets/registry";
import { line, paint, parseArgs } from "./datasetCli";

const GENDER_TOKEN =
  /^(men|mens|men's|women|womens|women's|woman|boys|girls|unisex|kids|kid|baby|infant|for)$/i;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const targetSample = Number(parsed.flags.get("sample") ?? 5600);
  const minFreq = Number(parsed.flags.get("min-freq") ?? parsed.flags.get("minFreq") ?? 4);
  const descriptor = getDataset(parsed.flags.get("dataset"));

  line("INFO", "BRANDS", `Muestreando ~${targetSample} nombres de ${descriptor.repo}`);
  line("INFO", "BRANDS", `Umbral de frecuencia: >= ${minFreq}`);

  // El muestreo se reparte por TODO el split, no las primeras N filas: el
  // dataset está agrupado por categoría, así que leer solo el principio daría
  // una lista de marcas de camisetas y nada más.
  const totalRows = 44_072;
  const pages = Math.ceil(targetSample / MAX_ROWS_PER_REQUEST);
  const stride = Math.max(1, Math.floor(totalRows / pages));

  const names: string[] = [];
  const CONCURRENCY = 8;
  const offsets = Array.from({ length: pages }, (_, i) => i * stride).filter((o) => o < totalRows);

  for (let i = 0; i < offsets.length; i += CONCURRENCY) {
    const chunk = offsets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((offset) =>
        fetchRows(descriptor, offset, MAX_ROWS_PER_REQUEST).catch(() => [])
      )
    );
    for (const rows of results) {
      for (const row of rows) {
        if (row.productDisplayName) names.push(row.productDisplayName);
      }
    }
    if (process.stdout.isTTY) {
      process.stdout.write(`\r  leídos ${names.length} nombres…   `);
    }
  }
  if (process.stdout.isTTY) process.stdout.write("\n");

  const freq = new Map<string, number>();
  for (const name of names) {
    const tokens = name.split(/\s+/);
    let cut = -1;
    for (let i = 1; i < Math.min(tokens.length, 5); i += 1) {
      if (GENDER_TOKEN.test(tokens[i])) {
        cut = i;
        break;
      }
    }
    if (cut < 1) continue;
    const candidate = tokens.slice(0, cut).join(" ");
    if (candidate.length < 2 || candidate.length > 28) continue;
    freq.set(candidate, (freq.get(candidate) ?? 0) + 1);
  }

  const kept = [...freq.entries()]
    .filter(([, n]) => n >= minFreq)
    .sort((a, b) => b[1] - a[1]);

  line(
    "SUCCESS",
    "BRANDS",
    `${names.length} nombres · ${freq.size} prefijos distintos · ${kept.length} por encima del umbral`
  );

  const current = new Set(brandAllowlist().map((b) => b.toLowerCase()));
  const derived = new Set(kept.map(([k]) => k.toLowerCase()));
  const onlyDerived = kept.filter(([k]) => !current.has(k.toLowerCase()));
  const onlyCurrent = brandAllowlist().filter((b) => !derived.has(b.toLowerCase()));

  if (onlyDerived.length > 0) {
    line("WARN", "DIFF", `${onlyDerived.length} prefijos nuevos no presentes en brands.ts:`);
    console.log(`  ${onlyDerived.map(([k, n]) => `${k}(${n})`).join(", ")}`);
  }
  if (onlyCurrent.length > 0) {
    line(
      "INFO",
      "DIFF",
      `${onlyCurrent.length} en brands.ts que esta muestra no confirma ` +
        "(normal: la poda de sub-marcas y las exclusiones genéricas los alteran):"
    );
    console.log(`  ${paint("dim", onlyCurrent.join(", "))}`);
  }
  if (onlyDerived.length === 0) {
    line("SUCCESS", "DIFF", "La lista del código cubre todo lo que esta muestra confirma.");
  }

  console.log(`\n${paint("dim", "// Lista derivada, lista para pegar en DERIVED_PREFIXES:")}`);
  console.log(JSON.stringify(kept.map(([k]) => k).sort((a, b) => a.localeCompare(b))));
}

main().catch((error: unknown) => {
  line("ERROR", "BRANDS", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
