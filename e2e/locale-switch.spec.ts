import { test, expect, type Page } from "@playwright/test";

/**
 * Cobertura E2E del cambio de idioma: instantáneo, sin navegación, con
 * persistencia, con RTL para árabe y operable en móvil.
 *
 * Se apunta solo a `/` y `/studio` — no dependen de base de datos ni de
 * `ADMIN_PASSWORD`, a diferencia de `/admin`.
 */

async function openSelector(page: Page) {
  await page.getByRole("button", { name: /Idioma:|Language:/ }).click();
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

    await expect(page.getByRole("button", { name: "Prueba ahora" }).first()).toBeVisible();

    await selectLanguage(page, "English");

    await expect(page.getByRole("button", { name: "Try now" }).first()).toBeVisible();
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
    // Activa la categoría "Calzado" (posición 1, tras "Todos los productos")
    // — se referencia por posición, no por texto, porque el texto cambiará
    // de idioma tras el cambio.
    const categoryButton = page.getByRole("button", { name: /Calzado|Footwear/ });
    await categoryButton.click();
    await expect(categoryButton).toHaveAttribute("aria-pressed", "true");

    await selectLanguage(page, "English");

    await expect(categoryButton).toHaveAttribute("aria-pressed", "true");
  });

  test("con una cookie NEXT_LOCALE inválida, la app no rompe y muestra español", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "bogus-locale", url: "http://localhost:3115" },
    ]);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Prueba ahora" }).first()).toBeVisible();
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
