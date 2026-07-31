/**
 * Borra los productos importados de un dataset, y sus imágenes del storage.
 *
 *   npm run catalog:dataset:cleanup -- --dry-run
 *   npm run catalog:dataset:cleanup -- --yes
 *   npm run catalog:dataset:cleanup -- --dataset=fashion-product-images-small --yes
 *
 * Solo toca `origin = 'dataset_demo'` de ese dataset: los productos scrapeados y
 * los descubiertos por proveedores externos no se rozan. Pide confirmación
 * explícita con `--yes` porque es destructivo y no hay vuelta atrás.
 */
import { loadEnv } from "./loadEnv";

loadEnv();

import { getStore } from "../lib/catalogIngestion/catalog/store";
import { closePool } from "../lib/catalogIngestion/database/pool";
import { getPool } from "../lib/catalogIngestion/database/pool";
import { getDataset } from "../lib/catalogIngestion/datasets/index";
import { blobDelete, blobList } from "../lib/mediaStorage/vercelBlob";
import { line, paint, parseArgs } from "./datasetCli";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const descriptor = getDataset(parsed.flags.get("dataset"));
  const dryRun = parsed.flags.get("dry-run") === "true" || parsed.flags.get("dryRun") === "true";
  const confirmed = parsed.flags.get("yes") === "true";

  const store = await getStore();
  if (store.backend !== "postgres") {
    line("ERROR", "CLEANUP", `El cleanup requiere el backend postgres (actual: ${store.backend}).`);
    process.exitCode = 1;
    return;
  }

  const counted = await getPool().query<{ n: string }>(
    "select count(*)::text n from catalog_products where source = $1 and origin = 'dataset_demo'",
    [descriptor.id]
  );
  const products = Number(counted.rows[0]?.n ?? 0);

  const prefix = `catalog/datasets/${descriptor.id}/`;
  const objects = await blobList(prefix);

  line("INFO", "CLEANUP", `dataset=${paint("ok", descriptor.id)}`);
  console.log(`  productos en catálogo : ${products}`);
  console.log(`  objetos en storage    : ${objects.length} (prefijo ${prefix})`);

  if (products === 0 && objects.length === 0) {
    line("SUCCESS", "CLEANUP", "Nada que borrar.");
    return;
  }

  if (dryRun) {
    line("INFO", "DRY-RUN", "No se ha borrado nada. Añade --yes para ejecutarlo.");
    return;
  }
  if (!confirmed) {
    line(
      "WARN",
      "CLEANUP",
      `Esto borraría ${products} productos y ${objects.length} imágenes. ` +
        "Repite el comando con --yes para confirmarlo."
    );
    process.exitCode = 1;
    return;
  }

  // Las imágenes primero: si falla el borrado de storage, los productos siguen
  // en la base y el comando se puede repetir. Al revés quedarían objetos
  // huérfanos sin ninguna fila que dijera de dónde salieron.
  const deletedObjects = await blobDelete(objects.map((o) => o.pathname));
  line("SUCCESS", "STORAGE", `${deletedObjects}/${objects.length} objetos borrados`);

  // ON DELETE CASCADE se encarga de catalog_product_images y catalog_prices.
  const deleted = await getPool().query(
    "delete from catalog_products where source = $1 and origin = 'dataset_demo'",
    [descriptor.id]
  );
  line("SUCCESS", "DATABASE", `${deleted.rowCount ?? 0} productos borrados`);
}

main()
  .catch((error: unknown) => {
    line("ERROR", "CLEANUP", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
  });
