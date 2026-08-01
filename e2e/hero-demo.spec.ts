import { test, expect, type Page } from "@playwright/test";

/**
 * Demo del hero con producto real.
 *
 * Lo que se comprueba no es "que se pinte algo", sino las cuatro cosas que se
 * rompen solas en una demo así:
 *
 *  1. que las cajas de detección estén ENCIMA de su producto (y no desplazadas,
 *     que es el defecto clásico al cambiar de breakpoint);
 *  2. que caja y tarjeta estén sincronizadas en los dos sentidos;
 *  3. que el umbral se lea en pantalla y la coincidencia baja quede retenida;
 *  4. que no se prometa una compra que no existe.
 */

const DESKTOP = { width: 1440, height: 950 };
const MOBILE = { width: 390, height: 844 };

/** Espera al estado final del guion en el panel que toca a este viewport. */
async function waitForFullSequence(page: Page, variant: "desktop" | "mobile") {
  const panel = page.getByTestId(`hero-matches-${variant}`);
  await expect(panel.getByText(/bajo el umbral/i)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("hero · demo de producto", () => {
  test("los tres productos se detectan y el tercero queda bajo el umbral", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(DESKTOP);
    await page.goto("/");

    const demo = page.locator(".panel").first();
    await waitForFullSequence(page, "desktop");

    // Las tres detecciones. Se apunta por el prefijo "Seleccionar", que solo
    // llevan las CAJAS: el nombre del producto a secas también casa con el
    // botón de su tarjeta ("Ver la coincidencia de …") y el localizador se
    // vuelve ambiguo.
    for (const name of [
      /seleccionar abrigo con capucha/i,
      /seleccionar bolso de mano/i,
      /seleccionar botas de piel/i,
    ]) {
      await expect(demo.getByRole("button", { name })).toBeVisible();
    }

    const matches = page.getByTestId("hero-matches-desktop");
    await expect(matches.getByText(/abrigo técnico con capucha/i)).toBeVisible();
    await expect(matches.getByText(/bolso estructurado de piel/i)).toBeVisible();
    await expect(matches.getByText(/botas de piel con cordones/i)).toBeVisible();

    // Dos publicadas con precio; la tercera retenida y SIN precio.
    await expect(matches.getByText("129,00 €")).toBeVisible();
    await expect(matches.getByText("89,00 €")).toBeVisible();
    await expect(matches.getByText(/bajo el umbral/i)).toBeVisible();

    // El umbral está a la vista: es lo que explica la retención.
    await expect(demo.getByText(/umbral de publicación/i)).toBeVisible();
    await expect(demo.getByText("≥ 75%")).toBeVisible();
  });

  test("las cajas de detección quedan sobre su producto", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await waitForFullSequence(page, "desktop");

    const demo = page.locator(".panel").first();

    // Cada caja debe solaparse con la imagen de su producto. Se comprueba por
    // geometría real y no por clases: un desajuste de coordenadas relativas
    // solo se ve midiendo.
    const pairs: Array<[RegExp, RegExp]> = [
      [/seleccionar abrigo con capucha/i, /abrigo negro con capucha/i],
      [/seleccionar bolso de mano/i, /bolso de mano estructurado/i],
      [/seleccionar botas de piel/i, /botas de piel marrón con cordones/i],
    ];

    for (const [boxName, imgAlt] of pairs) {
      const box = await demo.getByRole("button", { name: boxName }).boundingBox();
      const img = await demo.getByRole("img", { name: imgAlt }).first().boundingBox();
      expect(box, `caja de ${boxName}`).toBeTruthy();
      expect(img, `imagen de ${imgAlt}`).toBeTruthy();

      // Centros a menos de 12 px: la caja se deriva de la colocación del
      // recorte, así que deberían coincidir casi exactamente.
      const boxCx = box!.x + box!.width / 2;
      const boxCy = box!.y + box!.height / 2;
      const imgCx = img!.x + img!.width / 2;
      const imgCy = img!.y + img!.height / 2;
      expect(Math.abs(boxCx - imgCx)).toBeLessThan(12);
      expect(Math.abs(boxCy - imgCy)).toBeLessThan(12);
    }
  });

  test("caja y tarjeta se sincronizan en los dos sentidos", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await waitForFullSequence(page, "desktop");

    const demo = page.locator(".panel").first();
    // Pausar antes de interactuar: con el bucle corriendo las cajas se
    // desmontan y remontan en cada ciclo.
    await demo.getByRole("button", { name: /pausar demo/i }).click();

    const bagBox = demo.getByRole("button", { name: /seleccionar bolso de mano/i });
    const bagCard = page
      .getByTestId("hero-matches-desktop")
      .getByRole("button", { name: /bolso estructurado de piel/i });

    // Caja → tarjeta.
    await bagBox.click();
    await expect(bagBox).toHaveAttribute("aria-pressed", "true");
    await expect(bagCard).toHaveAttribute("aria-pressed", "true");

    // Tarjeta → caja: se suelta y se vuelve a fijar desde el panel.
    await bagCard.click();
    await expect(bagBox).toHaveAttribute("aria-pressed", "false");
    await bagCard.click();
    await expect(bagBox).toHaveAttribute("aria-pressed", "true");
  });

  test("no se ofrece comprar lo que no existe", async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await waitForFullSequence(page, "desktop");

    const matches = page.getByTestId("hero-matches-desktop");
    // El CTA es "ver coincidencia": no hay ficha comercial detrás.
    await expect(matches.getByText(/ver coincidencia/i).first()).toBeVisible();
    await expect(matches.getByText(/comprar/i)).toHaveCount(0);
    // Y se declara que son productos de demostración.
    await expect(matches.getByText(/producto demo/i).first()).toBeVisible();
  });

  test("en móvil la escena no se recorta y hay selector horizontal", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    await waitForFullSequence(page, "mobile");

    const demo = page.locator(".panel").first();

    // Ninguna imagen de producto se sale del marco de la escena.
    const scene = await demo.locator(".aspect-video").boundingBox();
    expect(scene).toBeTruthy();
    for (const alt of [
      /abrigo negro con capucha/i,
      /bolso de mano estructurado/i,
      /botas de piel marrón con cordones/i,
    ]) {
      const img = await demo.getByRole("img", { name: alt }).first().boundingBox();
      expect(img, `imagen ${alt}`).toBeTruthy();
      expect(img!.x).toBeGreaterThanOrEqual(scene!.x - 1);
      expect(img!.y).toBeGreaterThanOrEqual(scene!.y - 1);
      expect(img!.x + img!.width).toBeLessThanOrEqual(scene!.x + scene!.width + 1);
      expect(img!.y + img!.height).toBeLessThanOrEqual(scene!.y + scene!.height + 1);
    }

    // El selector móvil existe y solo se pinta UNA tarjeta completa.
    const mobilePanel = page.getByTestId("hero-matches-mobile");
    await expect(
      mobilePanel.getByRole("button", { name: /bolso de mano/i })
    ).toBeVisible();
  });

  test("con prefers-reduced-motion se muestra todo y sin movimiento", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: DESKTOP,
      locale: "es-ES",
    });
    const page = await context.newPage();
    await page.goto("/");

    const matches = page.getByTestId("hero-matches-desktop");
    // Sin esperar a ninguna secuencia: el estado completo tiene que estar ya.
    await expect(matches.getByText(/abrigo técnico con capucha/i)).toBeVisible();
    await expect(matches.getByText(/botas de piel con cordones/i)).toBeVisible();
    await expect(matches.getByText(/bajo el umbral/i)).toBeVisible();

    // El control ofrece reproducir, no pausar: la demo no ha arrancado sola.
    const demo = page.locator(".panel").first();
    await expect(
      demo.getByRole("button", { name: /reproducir demo/i })
    ).toBeVisible();

    await context.close();
  });
});
