import { test, expect, type Page } from "@playwright/test";

/**
 * Cobertura E2E de la landing pública rediseñada.
 *
 * Cada bloque corresponde a un criterio de aceptación del rediseño, y varios
 * cubren un defecto CONCRETO que la auditoría midió en la versión anterior
 * (`docs/LANDING_AUDIT.md`). Eso es a propósito: son las pruebas que fallarían
 * si alguien reintrodujera el problema.
 */

const DESKTOP_NAV = ["Cómo funciona", "Demo", "Integración", "Casos de uso"];

/** Espera a que la entrada del hero termine, para no medir a media animación. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1600);
}

test.describe("Landing — carga y propuesta de valor", () => {
  test("carga con un solo h1 y el mensaje de negocio", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    // Un h1 y solo uno: /demo tenía dos en la versión auditada.
    await expect(page.locator("h1")).toHaveCount(1);

    const h1 = page.locator("h1");
    await expect(h1).toContainText("Convierte cada escena");
    await expect(h1).toContainText("oportunidad de compra");

    await expect(page.getByText("Visual commerce para vídeo y VOD")).toBeVisible();
  });

  test("no promete capacidades no verificadas", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    const body = (await page.locator("body").innerText()).toLowerCase();

    // "en tiempo real" y "en directo" eran el problema de posicionamiento
    // principal: el flujo real es VOD / análisis al pausar.
    expect(body).not.toContain("en tiempo real");
    expect(body).not.toContain("en directo");
    // Limitaciones internas que no deben aparecer en la landing comercial.
    expect(body).not.toContain("hash determinista");
    expect(body).not.toContain("máx. 2 minutos");
    expect(body).not.toContain("hasta 2 minutos");
  });

  test("landmarks y salto al contenido", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator("main#contenido")).toBeVisible();
    await expect(page.locator("footer")).toBeVisible();

    // El salto al contenido es el primer tabstop y debe hacerse visible al foco.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  });
});

test.describe("Landing — la demo está en el primer viewport", () => {
  // Resoluciones de escritorio en las que se garantiza que el panel entero de
  // la demo entra en el primer viewport. Se comprueban explícitamente porque el
  // viewport por omisión de Playwright (1280×720) es más bajo que cualquier
  // pantalla real de presentación, y a 720 px de alto no cabe: el hero mide
  // ~480 px de copy y el panel ~415 px.
  for (const vp of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    test(`el panel de la demo cabe sin scroll a ${vp.width}x${vp.height}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name === "mobile", "Móvil tiene su propio test.");
      await page.setViewportSize(vp);
      await page.goto("/");
      await settle(page);

      const panel = page.locator("main section .panel").first();
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      // El defecto auditado: el mockup empezaba a 620 px y se cortaba a un tercio.
      expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    });
  }

  test("se ven detección y coincidencia de catálogo con estado", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    // Objeto detectado sobre el frame…
    await expect(page.getByText("Abrigo largo", { exact: false }).first()).toBeVisible();
    // …y su producto de catálogo con precio y estado editorial.
    await expect(page.getByText("Abrigo largo de lana").first()).toBeVisible();
    await expect(page.getByText("129,00 €").first()).toBeVisible();
    await expect(page.getByText("Publicado").first()).toBeVisible();
  });

  test("la demo del hero se puede pausar", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    const toggle = page.getByRole("button", { name: /Pausar demo|Reproducir demo/ }).first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("Landing — navegación por anclas", () => {
  test("los enlaces del menú llevan a su sección", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "En móvil la navegación va en el panel del menú.");
    await page.goto("/");
    await settle(page);

    for (const label of DESKTOP_NAV) {
      await page.getByRole("navigation", { name: "Navegación principal" }).getByRole("link", { name: label }).click();
      await page.waitForTimeout(700);
    }

    // Tras recorrer las anclas, la última sección está en pantalla.
    await expect(page.locator("#casos-de-uso")).toBeInViewport();
  });

  test("el CTA principal abre el estudio", async ({ page }) => {
    await page.goto("/");
    await settle(page);
    await page.getByRole("link", { name: /Probar con un vídeo/ }).first().click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.locator("h1")).toBeVisible();
  });
});

test.describe("Landing — demo interactiva", () => {
  test("hotspot y tarjeta se sincronizan en los dos sentidos", async ({ page }) => {
    await page.goto("/#demo");
    await settle(page);

    const section = page.locator("#demo");
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    // 1) Pulsar el objeto del frame selecciona su tarjeta.
    const hotspot = section.getByRole("button", { name: /Abrigo largo/ }).first();
    await hotspot.click();
    await expect(hotspot).toHaveAttribute("aria-pressed", "true");

    const card = section.getByRole("button", { name: /Abrigo largo de lana/ }).first();
    await expect(card).toHaveAttribute("aria-pressed", "true");
    // El panel de detalle refleja la selección.
    await expect(section.getByText("Confianza", { exact: false }).first()).toBeVisible();

    // 2) Pulsar OTRA tarjeta mueve la selección y deselecciona la primera.
    const other = section.getByRole("button", { name: /Bolso shopper de piel/ }).first();
    await other.click();
    await expect(other).toHaveAttribute("aria-pressed", "true");
    await expect(card).toHaveAttribute("aria-pressed", "false");
    await expect(hotspot).toHaveAttribute("aria-pressed", "false");
  });

  test("cambiar de escena reanaliza y recalcula el catálogo", async ({ page }) => {
    await page.goto("/#demo");
    await settle(page);

    const section = page.locator("#demo");
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    // La escena 1 tiene productos de moda; la 2, de hogar.
    await expect(section.getByText("Abrigo largo de lana")).toBeVisible();

    await section.getByRole("tab", { name: /Salón/ }).click();
    await expect(section.getByText("Butaca tapizada en bouclé")).toBeVisible();
    await expect(section.getByText("Abrigo largo de lana")).toHaveCount(0);
  });
});

test.describe("Landing — umbral configurable", () => {
  test("mover el umbral recalcula el reparto", async ({ page }) => {
    await page.goto("/#precision");
    await settle(page);

    const section = page.locator("#precision");
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    const slider = section.getByRole("slider");
    await expect(slider).toBeVisible();
    await expect(slider).toHaveValue("75");

    const outcome = section.locator("dl[aria-live='polite']");
    const before = await outcome.innerText();

    // Subir el umbral tiene que publicar MENOS: es la promesa de la sección.
    await slider.fill("95");
    await expect(slider).toHaveValue("95");
    await expect(outcome).not.toHaveText(before);
  });
});

test.describe("Landing — el admin no se promociona", () => {
  test("no hay ningún enlace a /admin en la página pública", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    // La cabecera pública tenía `Admin` como enlace de primer nivel, el CTA
    // final ofrecía "Panel de operaciones" y el pie una columna entera.
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

    // Sobre `innerText`, no `getByText`: el proveedor de i18n serializa TODO el
    // catálogo de mensajes en un <script> de la página —incluido el espacio de
    // nombres del admin—, y `getByText` lo encuentra ahí. Lo que importa es que
    // no haya nada de eso en el texto visible.
    const visible = await page.locator("body").innerText();
    expect(visible).not.toContain("Panel de operaciones");
    expect(visible).not.toContain("Panel de administración");
  });

  test("tampoco en el menú móvil", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Solo aplica al menú móvil.");
    await page.goto("/");
    await settle(page);

    await page.getByRole("button", { name: "Abrir menú" }).click();
    const menu = page.getByRole("navigation", { name: "Navegación móvil" });
    await expect(menu).toBeVisible();
    await expect(menu.locator('a[href^="/admin"]')).toHaveCount(0);
  });
});

test.describe("Landing — pie de página", () => {
  test("los enlaces del pie resuelven a páginas reales", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    const footer = page.locator("footer");
    for (const [name, url] of [
      ["Arquitectura técnica", /\/arquitectura$/],
      ["Privacidad", /\/legal\/privacidad$/],
      ["Términos", /\/legal\/terminos$/],
    ] as const) {
      await footer.getByRole("link", { name }).click();
      await expect(page).toHaveURL(url);
      await expect(page.locator("h1")).toBeVisible();
      await page.goBack();
      await settle(page);
    }
  });
});

test.describe("Landing — responsive", () => {
  test("no hay desbordamiento horizontal", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    // La versión auditada se salía 16 px en TODAS las rutas a 390 px, por el
    // grupo de acciones de la cabecera.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("en móvil el CTA principal y la demo son visibles", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Específico de móvil.");
    await page.goto("/");
    await settle(page);

    await expect(page.getByRole("link", { name: /Probar con un vídeo/ }).first()).toBeInViewport();
    await expect(page.locator("section .panel .aspect-video").first()).toBeInViewport();
  });
});

test.describe("Landing — movimiento reducido", () => {
  // `emulateMedia` y no `test.use({ reducedMotion })`: hay que fijarlo ANTES de
  // navegar, porque las primitivas de movimiento leen la preferencia al montar y
  // deciden ahí si renderizan un `motion.div` o el hijo tal cual.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("el contenido es visible sin depender de animaciones", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Secciones muy abajo de la página: con movimiento reducido no deben
    // depender de que se dispare un IntersectionObserver para existir.
    for (const id of ["#como-funciona", "#integracion", "#precision", "#casos-de-uso", "#capacidades", "#seguridad"]) {
      const heading = page.locator(`${id} h2`).first();
      await expect(heading).toBeVisible();
      // `toBeVisible` no detecta opacity 0, así que se comprueba explícitamente.
      const opacity = await heading.evaluate((el) => {
        let node: HTMLElement | null = el as HTMLElement;
        while (node) {
          if (Number(getComputedStyle(node).opacity) === 0) return 0;
          node = node.parentElement;
        }
        return 1;
      });
      expect(opacity).toBe(1);
    }
  });

  test("la demo del hero no se mueve sola", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1200);

    // Con movimiento reducido la secuencia no arranca: la escena se queda fija.
    const label = page.locator("section .panel").first();
    const first = await label.innerText();
    await page.waitForTimeout(3200);
    expect(await label.innerText()).toBe(first);
  });
});

test.describe("Landing — rendimiento del primer render", () => {
  /**
   * Guarda de regresión del LCP.
   *
   * No se afirma un umbral de milisegundos —sería inestable entre máquinas—; se
   * comprueba la CAUSA que se midió y se corrigió: el texto del hero entraba
   * desde `opacity: 0`, y un elemento invisible no cuenta como pintado, así que
   * la animación arrastraba el LCP. Con la entrada solo en `transform`, el LCP
   * de la home bajó de 4.980 ms a 1.024 ms (CPU 4x, red lenta).
   *
   * Si alguien vuelve a meter un fade en el titular o el párrafo del hero, esto
   * falla.
   */
  test("el texto del hero se pinta opaco desde el primer frame", async ({ page }) => {
    await page.goto("/", { waitUntil: "commit" });

    const opacities = await page.evaluate(() => {
      const chain = (el: Element | null) => {
        const values: number[] = [];
        let node = el as HTMLElement | null;
        while (node) {
          values.push(Number(getComputedStyle(node).opacity));
          node = node.parentElement;
        }
        return values;
      };
      return {
        h1: chain(document.querySelector("h1")),
        // El párrafo del hero era el elemento LCP real.
        lead: chain(document.querySelector("h1 ~ p")),
      };
    });

    expect(Math.min(...opacities.h1)).toBe(1);
    expect(Math.min(...opacities.lead)).toBe(1);
  });

  test("el shell no espera al servicio de catálogo", async ({ page }) => {
    // La franja de confianza vive tras un `Suspense`: llegue o no el dato, el
    // hero y las secciones tienen que estar. Antes, la página entera esperaba
    // ~3 s al servicio antes de emitir una sola etiqueta (TTFB 3,04 s → 0,02 s).
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.locator("h1")).toContainText("Convierte cada escena");
    await expect(page.locator("#como-funciona")).toBeAttached();
    await expect(page.locator("#demo")).toBeAttached();
    // La franja está presente con sus cuatro etiquetas, con número o con hueco.
    // Acotado a `main`: el catálogo de mensajes va serializado en un <script>
    // del body y `getByText` sin acotar encuentra tres coincidencias.
    await expect(page.locator("main").getByText("Fuentes en el registro")).toBeAttached();
    await expect(page.locator("main dl").first()).toBeAttached();
  });
});

test.describe("Landing — indexación", () => {
  test("robots, sitemap y manifest existen y el admin queda fuera", async ({ page, request }) => {
    // Las tres devolvían 404 en la versión auditada.
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const robotsBody = await robots.text();
    expect(robotsBody).toContain("Disallow: /admin/");
    expect(robotsBody).toContain("Sitemap:");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const sitemapBody = await sitemap.text();
    expect(sitemapBody).toContain("/arquitectura");
    expect(sitemapBody).not.toContain("/admin");

    expect((await request.get("/manifest.webmanifest")).status()).toBe(200);

    // Metadatos sociales: no había ninguno.
    await page.goto("/");
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  });

  test("cada ruta pública tiene su propio título", async ({ page }) => {
    const titles = new Set<string>();
    for (const path of ["/", "/studio", "/catalog", "/demo", "/arquitectura"]) {
      await page.goto(path);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(10);
      // `/demo` heredaba el título por defecto, idéntico al de la home.
      expect(titles.has(title)).toBe(false);
      titles.add(title);
    }
  });
});
