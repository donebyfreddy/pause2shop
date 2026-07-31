import { test, expect, type Page } from "@playwright/test";

/**
 * Cobertura E2E del cambio de idioma: instantáneo, sin navegación, con
 * persistencia, con RTL para árabe y operable en móvil.
 *
 * Se apunta solo a `/` y `/studio` — no dependen de base de datos ni de
 * `ADMIN_PASSWORD`, a diferencia de `/admin`.
 *
 * Actualizado con el rediseño de la landing. Tres cosas cambiaron de sitio y las
 * aserciones se han corregido en consecuencia (misma intención, objetivos
 * correctos):
 *
 *  1. El CTA de la cabecera es un ENLACE a `/studio`, no un botón que hacía
 *     scroll. Antes se buscaba `role: "button"` con nombre "Prueba ahora".
 *  2. Por debajo de `sm`, el selector de idioma vive DENTRO del panel del menú
 *     móvil: en la cabecera solo queda la hamburguesa, que es lo que arregla el
 *     desbordamiento horizontal de 16 px que había en móvil.
 *  3. La URL base ya no está fijada a un puerto concreto: se toma de `baseURL`
 *     para que la suite también valga contra `E2E_BASE_URL`.
 */

/**
 * Testigo del idioma activo.
 *
 * Se usa el H1 del hero y no el CTA de la cabecera: el CTA está oculto por CSS
 * por debajo de `sm` (en móvil vive dentro del panel del menú), así que no sirve
 * como testigo en las dos vistas. El H1 siempre está visible y siempre cambia de
 * idioma.
 */
function heroHeadline(page: Page) {
  return page.locator("h1");
}

/**
 * Abre el selector de idioma.
 *
 * Hay DOS selectores en la página —cabecera y pie— y en móvil el de la cabecera
 * está en el DOM pero oculto por CSS. `getByRole` encuentra los elementos
 * ocultos igual, así que sin acotar por `visible` esto sería una violación de
 * modo estricto con 2-3 coincidencias. De ahí el `.filter({ visible: true })`
 * y el acotado a `header`.
 */
function visibleSelectorTrigger(page: Page) {
  return page
    .locator("header")
    .getByRole("button", { name: /Idioma:|Language:/ })
    .filter({ visible: true });
}

async function openSelector(page: Page) {
  if ((await visibleSelectorTrigger(page).count()) === 0) {
    // Vista móvil: el selector vive dentro del panel del menú.
    await page.getByRole("button", { name: /Abrir menú|Open menu/ }).click();
  }
  await visibleSelectorTrigger(page).first().click();
}

async function selectLanguage(page: Page, query: string) {
  await openSelector(page);
  const search = page.getByPlaceholder(/Buscar idioma|Search language/);
  await search.fill(query);
  await page.getByRole("option", { name: new RegExp(query, "i") }).first().click();
}

test.describe("Selector de idioma", () => {
  test("es → en es instantáneo y no navega", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (window as unknown as { __mountId: number }).__mountId = Date.now();
    });
    const startUrl = page.url();

    await expect(heroHeadline(page)).toContainText("Convierte cada escena");

    await selectLanguage(page, "English");

    await expect(heroHeadline(page)).toContainText("Turn every scene");
    expect(page.url()).toBe(startUrl);

    const mountIdStillThere = await page.evaluate(
      () => typeof (window as unknown as { __mountId?: number }).__mountId === "number"
    );
    expect(mountIdStillThere).toBe(true);
  });

  test("cambio a chino simplificado sin recarga", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (window as unknown as { __mountId: number }).__mountId = Date.now();
    });
    const startUrl = page.url();

    await selectLanguage(page, "简体中文");

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    expect(page.url()).toBe(startUrl);
    const mountIdStillThere = await page.evaluate(
      () => typeof (window as unknown as { __mountId?: number }).__mountId === "number"
    );
    expect(mountIdStillThere).toBe(true);
  });

  test("persiste tras refrescar (cookie + localStorage) sin flash del idioma anterior", async ({
    page,
  }) => {
    await page.goto("/");
    await selectLanguage(page, "Français");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    const cookies = await page.context().cookies();
    const localeCookie = cookies.find((c) => c.name === "NEXT_LOCALE");
    expect(localeCookie?.value).toBe("fr");

    const stored = await page.evaluate(() => localStorage.getItem("pause2shop:locale"));
    expect(stored).toBe("fr");

    await page.reload();
    // Debe llegar ya en francés desde el primer HTML (SSR vía cookie), sin
    // pasar visiblemente por español.
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("conserva el estado de la página al cambiar de idioma en /studio", async ({ page }) => {
    await page.goto("/studio");
    // Activa la categoría "Calzado" — se localiza por un patrón que cubre los
    // dos idiomas, porque el texto cambia justo en mitad del test.
    const categoryButton = page.getByRole("button", { name: /Calzado|Footwear/ });
    await categoryButton.click();
    await expect(categoryButton).toHaveAttribute("aria-pressed", "true");

    await selectLanguage(page, "English");

    await expect(categoryButton).toHaveAttribute("aria-pressed", "true");
  });

  test("con una cookie NEXT_LOCALE inválida, la app no rompe y muestra español", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "bogus-locale", url: baseURL! },
    ]);
    await page.goto("/");
    await expect(heroHeadline(page)).toContainText("Convierte cada escena");
  });

  test("RTL correcto para árabe", async ({ page }) => {
    await page.goto("/");
    await selectLanguage(page, "العربية");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});

test.describe("Selector de idioma en móvil", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("el selector es operable en la vista móvil", async ({ page }) => {
    await page.goto("/");
    await openSelector(page);
    const search = page.getByPlaceholder(/Buscar idioma/);
    await expect(search).toBeVisible();
    await search.fill("Deutsch");
    await page.getByRole("option", { name: /Deutsch/i }).first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
  });
});
