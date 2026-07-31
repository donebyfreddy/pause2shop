/**
 * Comprueba que el dataset es alcanzable y muestra su esquema real.
 *
 *   npm run catalog:dataset:inspect
 *   npm run catalog:dataset:inspect -- --source=kaggle
 *
 * No escribe nada. Es la comprobación previa: si esto falla, no merece la pena
 * lanzar una importación de mil fichas para descubrir el mismo error.
 */
import { loadEnv } from "./loadEnv";

loadEnv();

import { DatasetImporter, getDataset, listDatasets, resolveOptions } from "../lib/catalogIngestion/datasets/index";
import { kaggleCredentials } from "../lib/catalogIngestion/datasets/kaggle";
import { describeStorage } from "../lib/mediaStorage";
import { line, optionsFromArgs, paint, parseArgs } from "./datasetCli";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const options = resolveOptions(optionsFromArgs(parsed));
  const descriptor = getDataset(options.datasetId);

  line("INFO", "DATASETS", `Registrados: ${listDatasets().map((d) => d.id).join(", ")}`);
  line("INFO", "DATASET", paint("ok", descriptor.repo));
  console.log(`  origen original : ${descriptor.originRepo}`);
  console.log(`  licencia        : ${paint("warn", descriptor.license)}`);
  console.log(`  split / config  : ${descriptor.split} / ${descriptor.config}`);
  console.log(`  fuente pedida   : ${options.source}`);

  const info = await new DatasetImporter().inspect(options.datasetId);

  if (!info.reachable) {
    line("ERROR", "DATASET", `No alcanzable: ${info.unreachableReason}`);
    process.exitCode = 1;
    return;
  }

  line("SUCCESS", "DATASET", `Alcanzable vía ${info.descriptor.provider}`);
  console.log(`  filas totales   : ${info.totalRows?.toLocaleString("es-ES") ?? "desconocido"}`);
  console.log(`  revisión        : ${info.version}`);
  console.log(
    `  tamaño split    : ${
      info.sizeBytes ? `${(info.sizeBytes / 1024 / 1024).toFixed(0)} MB` : "desconocido"
    }`
  );

  console.log(`\n  ${paint("ok", "CAMPOS DISPONIBLES")} (leídos del proveedor):`);
  for (const [name, type] of Object.entries(info.features)) {
    console.log(`    ${name.padEnd(20)} ${paint("dim", type)}`);
  }

  console.log(`\n  ${paint("warn", "CAMPOS NO DISPONIBLES")} (quedan a null, no se inventan):`);
  console.log(`    ${descriptor.unavailableFields.join(", ")}`);

  if (info.sample) {
    console.log(`\n  ${paint("ok", "FILA DE MUESTRA")}:`);
    const s = info.sample;
    for (const [k, v] of Object.entries(s)) {
      if (k === "imageUrl") {
        console.log(`    ${k.padEnd(20)} ${v ? paint("dim", "(URL firmada, caduca)") : "—"}`);
        continue;
      }
      console.log(`    ${k.padEnd(20)} ${v ?? paint("dim", "—")}`);
    }
  }

  const storage = describeStorage();
  console.log("");
  line(
    storage.ephemeral ? "WARN" : "SUCCESS",
    "STORAGE",
    `${storage.provider} · ${storage.ephemeral ? "EFÍMERO (las imágenes se perderán)" : "persistente"}`
  );
  line(
    kaggleCredentials() ? "SUCCESS" : "INFO",
    "KAGGLE",
    kaggleCredentials()
      ? "Credenciales presentes: el fallback está disponible."
      : "Sin KAGGLE_USERNAME/KAGGLE_KEY: el fallback está inactivo (no hace falta para HuggingFace)."
  );
  line(
    process.env.HF_TOKEN?.trim() ? "SUCCESS" : "INFO",
    "HF_TOKEN",
    process.env.HF_TOKEN?.trim()
      ? "Presente: más cuota de peticiones."
      : "Ausente: el dataset es público, es opcional."
  );
}

main().catch((error: unknown) => {
  line("ERROR", "INSPECT", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
