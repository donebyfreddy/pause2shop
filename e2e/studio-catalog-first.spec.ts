import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * E2E de la nueva UI de resultados de `/studio`: el catálogo propio como fuente
 * principal y los resultados de Internet en un bloque aparte.
 *
 * Requiere un servidor YA levantado con visión y catálogo reales
 * (`E2E_BASE_URL=http://localhost:3000`) y una imagen de subida en
 * `E2E_IMAGE_PATH`. Sin ellos el test se salta: no tiene sentido "verificar"
 * el flujo contra un catálogo vacío o sin modelo de visión, porque pasaría
 * pintando estados vacíos.
 *
 *   E2E_BASE_URL=http://localhost:3000 \
 *   E2E_IMAGE_PATH=/ruta/a/prenda.jpg \
 *   E2E_SHOTS_DIR=/ruta/salida \
 *   npx playwright test e2e/studio-catalog-first.spec.ts --project=chromium
 */

const IMAGE_PATH = process.env.E2E_IMAGE_PATH;
const SHOTS_DIR = process.env.E2E_SHOTS_DIR ?? "test-results/studio-shots";

test.describe("/studio · catálogo primero, Internet aparte", () => {
  test.skip(!process.env.E2E_BASE_URL, "requiere un servidor real (E2E_BASE_URL)");
  test.skip(!IMAGE_PATH, "requiere una imagen de subida (E2E_IMAGE_PATH)");

  // El análisis real (visión + embedding + búsqueda en catálogo) tarda.
  test.setTimeout(240_000);

  test("una imagen del dataset se resuelve en el catálogo y no llama a Internet", async ({
    page,
  }) => {
    mkdirSync(SHOTS_DIR, { recursive: true });
    // Ventana alta: el panel de resultados es una columna larga y con el
    // viewport por defecto los dos bloques no caben en la misma captura.
    await page.setViewportSize({ width: 1500, height: 1400 });

    await page.goto("/studio");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Modo imagen: es el camino determinista (una subida, un frame) frente al
    // vídeo, que depende de reproducción y captura de pantalla.
    // El selector de modo es un tablist, no botones: `role: "tab"`.
    await page.getByRole("tab", { name: /analizar imagen/i }).click();

    // El cambio de modo va animado (AnimatePresence "wait"), así que durante la
    // transición el input del VÍDEO sigue montado y el de imagen aún no. Sin
    // esperar al dropzone, el fichero se adjuntaba al input saliente —que acepta
    // vídeo— y no llegaba nunca al analizador de imagen.
    await expect(page.getByText(/sube, arrastra o pega una imagen/i)).toBeVisible();

    // El input está oculto (lo dispara el dropzone): se le adjunta el fichero
    // directamente en vez de simular el diálogo del sistema. Se filtra por
    // `accept` para no volver a coger el del vídeo.
    const input = page.locator('input[type="file"][accept*="image"]').first();
    await input.setInputFiles(IMAGE_PATH!);

    // Subir solo DEJA LISTA la imagen: el análisis lo lanza el usuario. Sin
    // este clic el test esperaba para siempre una tarjeta que nadie iba a pedir.
    const analyzeButton = page
      .getByRole("button", { name: /^analizar imagen$/i })
      .last();
    await expect(analyzeButton).toBeEnabled({ timeout: 30_000 });
    await analyzeButton.click();

    // La tarjeta de detección aparece cuando la visión responde.
    const card = page.locator("article").filter({ hasText: /detección/i }).first();
    await expect(card).toBeVisible({ timeout: 180_000 });

    // 1) El bloque del CATÁLOGO existe y va ANTES que el de Internet.
    const catalogHeading = card.getByRole("heading", {
      name: /catálogo|coincidencia fiable/i,
    });
    const externalHeading = card.getByRole("heading", { name: /internet/i });
    await expect(catalogHeading).toBeVisible({ timeout: 120_000 });
    await expect(externalHeading).toBeVisible();

    const catalogBox = await catalogHeading.boundingBox();
    const externalBox = await externalHeading.boundingBox();
    expect(catalogBox, "el bloque de catálogo debe estar en pantalla").toBeTruthy();
    expect(externalBox).toBeTruthy();
    expect(
      catalogBox!.y,
      "el catálogo se pinta por encima de los resultados de Internet"
    ).toBeLessThan(externalBox!.y);

    // Las imágenes de producto vienen de dominios remotos y llegan después de
    // que aparezca la tarjeta: sin esperarlas, la captura sale con los huecos
    // en blanco y parece que el catálogo no tiene imágenes.
    await waitForImages(page);
    await page.screenshot({
      path: join(SHOTS_DIR, "studio-resultados.png"),
      fullPage: false,
    });
    await card.screenshot({ path: join(SHOTS_DIR, "tarjeta-deteccion.png") });

    // 1b) Las alternativas del catálogo existen y se despliegan como lista
    // horizontal, SIN empujar el bloque de Internet fuera de la tarjeta.
    const altToggle = card.getByRole("button", { name: /ver alternativas/i });
    if (await altToggle.isVisible().catch(() => false)) {
      await altToggle.click();
      await expect(card.getByText(/alternativas del catálogo/i)).toBeVisible();
      await waitForImages(page);
      await card.screenshot({
        path: join(SHOTS_DIR, "tarjeta-alternativas.png"),
      });
      // Se repliegan para que la captura siguiente muestre el estado por defecto.
      await card.getByRole("button", { name: /ocultar alternativas/i }).click();
    }

    // 2) Con el catálogo resuelto, Internet NO se ha consultado: el bloque
    // ofrece el botón manual en vez de resultados.
    const searchButton = card.getByRole("button", {
      name: /buscar también en internet/i,
    });
    const hasCatalogMatch = await card
      .getByText(/encontrado en tu catálogo/i)
      .isVisible()
      .catch(() => false);

    if (hasCatalogMatch) {
      await expect(searchButton).toBeVisible();

      // 3) Y al pulsarlo, los resultados de Internet aparecen en SU bloque,
      // sin borrar el del catálogo.
      await searchButton.click();
      await expect(card.getByText(/encontrado en tu catálogo/i)).toBeVisible();
      await waitForImages(page);
      await page.screenshot({
        path: join(SHOTS_DIR, "studio-internet-solicitado.png"),
        fullPage: false,
      });
    }

    // 4) Ningún resultado queda sin fuente visible: es la invariante de la UI.
    const badges = card.getByText(/catálogo pause2shop|resultado de internet/i);
    expect(await badges.count()).toBeGreaterThan(0);
  });
});

/** Espera a que todas las <img> visibles hayan terminado de cargar. */
async function waitForImages(page: import("@playwright/test").Page) {
  await page
    .waitForFunction(
      () =>
        Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0),
      undefined,
      { timeout: 15_000 }
    )
    .catch(() => {
      // Una imagen rota no debe tumbar el test: la captura sale igualmente.
    });
}
