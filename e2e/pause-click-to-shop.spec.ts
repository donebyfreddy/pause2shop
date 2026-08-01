import { expect, test, type Browser, type Page, type Route } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VIDEO_PATH = join(process.cwd(), "test-results", "pause-click-to-shop.webm");
const SHOTS_DIR = join(process.cwd(), "test-results", "pause-click-to-shop");

type RequestBody = Record<string, unknown>;

function detectedItem(mediaTime: number) {
  const secondScene = mediaTime >= 3;
  return {
    name: secondScene ? "Bolso caramelo" : "Polo oscuro",
    category: secondScene ? "bags_accessories" : "clothing",
    subcategory: secondScene ? "handbag" : "polo",
    relationship: secondScene ? "held" : "worn",
    color: secondScene ? "caramelo" : "negro",
    description: secondScene ? "Bolso estructurado" : "Polo de algodón oscuro",
    search_query_es: secondScene ? "bolso caramelo" : "polo negro",
    alternative_queries: [],
    verified_provider_queries: [],
    confidence: 0.88,
    purchase_relevance: 0.94,
    bounding_box: secondScene
      ? { x: 0.58, y: 0.28, width: 0.24, height: 0.46 }
      : { x: 0.18, y: 0.18, width: 0.3, height: 0.48 },
  };
}

async function makeSyntheticVideo(browser: Browser) {
  mkdirSync(join(process.cwd(), "test-results"), { recursive: true });
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const started = performance.now();
    const draw = () => {
      const elapsed = (performance.now() - started) / 1000;
      ctx.fillStyle = elapsed < 3 ? "rgb(24, 44, 92)" : "rgb(122, 63, 24)";
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = "white";
      ctx.font = "700 72px sans-serif";
      ctx.fillText(elapsed < 3 ? "ESCENA A" : "ESCENA B", 105, 190);
      ctx.font = "32px monospace";
      ctx.fillText(elapsed.toFixed(2), 260, 245);
    };
    draw();
    const timer = window.setInterval(draw, 40);
    recorder.start(100);
    await new Promise((resolve) => window.setTimeout(resolve, 5_400));
    window.clearInterval(timer);
    recorder.stop();
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: "video/webm" });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  });
  await page.close();
  writeFileSync(VIDEO_PATH, Buffer.from(dataUrl.split(",")[1], "base64"));
}

function fulfillDetection(route: Route, body: RequestBody, delayMs = 40) {
  const mediaTime = Number(body.mediaTime ?? body.timestampSeconds ?? 0);
  const item = detectedItem(mediaTime);
  const sessionId = String(body.analysisSessionId ?? "");
  const frameId = String(body.frameId ?? "");
  const lines = [
    { type: "start" },
    { type: "item", item, index: 0 },
    { type: "analysis", analysis: { summary: "Escena de prueba", style_vibe: "casual", items: [item] }, mock: true },
    {
      type: "complete",
      mock: true,
      persisted: false,
      persistence: "memory_fallback",
      videoId: "video-e2e",
      frameId: "server-frame",
      items: [],
      analysisSessionId: sessionId,
      requestedFrameId: frameId,
      mediaTime,
      timings: { detectionMs: delayMs, totalMs: delayMs },
    },
  ];
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      void route
        .fulfill({
          status: 200,
          contentType: "application/x-ndjson",
          body: `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
        })
        .then(resolve)
        .catch(() => resolve());
    }, delayMs);
  });
}

function matchPayload(body: RequestBody, catalogMiss = false) {
  const external = body.forceExternal === true;
  const item = body.item as ReturnType<typeof detectedItem>;
  const catalogProduct = {
    id: "catalog:sku-123",
    title: item.name === "Bolso caramelo" ? "Bolso City caramelo" : "Polo Essential negro",
    brand: "Pause Atelier",
    imageUrl:
      item.name === "Bolso caramelo"
        ? "/demo/products/bag.webp"
        : "/demo/products/coat.webp",
    price: item.name === "Bolso caramelo" ? 89 : 59,
    currency: "EUR",
    productUrl: "https://shop.example/product/sku-123",
    category: item.category,
    color: item.color,
    score: 0.92,
    source: "catalog",
    matchType: "probable",
    isDemoProduct: false,
    merchant: null,
    evidence: ["Alta similitud visual"],
  };
  const externalProduct = {
    ...catalogProduct,
    id: "external:https://merchant.example/product",
    title: `${catalogProduct.title} · alternativa`,
    source: "external",
    productUrl: "https://merchant.example/product",
    merchant: "Merchant Example",
    score: 0.86,
  };
  return {
    ok: true,
    status: external || !catalogMiss ? "matched" : "no_match",
    cached: false,
    match: null,
    similarCandidates: [],
    providerUsed: external ? "searchapi_google_lens" : "catalog",
    fallbackUsed: false,
    timings: {
      embeddingMs: 38,
      vectorSearchMs: 7,
      rankingMs: 2,
      lensMs: external ? 420 : 0,
      totalMs: external ? 470 : 84,
    },
    matchingMode: String(body.matchingMode ?? "catalog_first"),
    matching: { externalFallbackUsed: false },
    detection: {
      detectionId: String(body.detectionId),
      label: item.name,
      confidence: item.confidence,
      boundingBox: item.bounding_box,
      timestampSeconds: body.timestampSeconds,
      matchingMode: String(body.matchingMode ?? "catalog_first"),
      catalog: {
        status: catalogMiss || external ? (external ? "not_requested" : "unresolved") : "matched",
        ...(catalogMiss || external ? {} : { selected: catalogProduct }),
        candidates: catalogMiss || external ? [] : [catalogProduct],
        threshold: 0.8,
        ...(catalogMiss && !external
          ? { unresolvedReason: "No existe una coincidencia suficientemente fiable en el catálogo." }
          : {}),
      },
      external: external
        ? {
            status: "matched",
            selected: externalProduct,
            candidates: [externalProduct],
            provider: "searchapi_google_lens",
            threshold: 0.72,
          }
        : { status: "not_requested", candidates: [], threshold: 0.72 },
    },
  };
}

async function installApiMocks(page: Page, analysisDelays: number[] = [], catalogMiss = false) {
  const matchingBodies: RequestBody[] = [];
  let analysisIndex = 0;
  await page.route("**/api/vision/analyze-frame-stream", async (route) => {
    const body = route.request().postDataJSON() as RequestBody;
    const delay = analysisDelays[analysisIndex++] ?? 40;
    await fulfillDetection(route, body, delay);
  });
  await page.route("**/api/vision/match-object", async (route) => {
    const body = route.request().postDataJSON() as RequestBody;
    matchingBodies.push(body);
    await new Promise((resolve) => setTimeout(resolve, body.forceExternal ? 220 : 70));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(matchPayload(body, catalogMiss)) });
  });
  return matchingBodies;
}

async function uploadVideo(page: Page, disablePreanalysis = true) {
  await page.goto("/studio");
  // La escena B contiene un bolso; se habilita antes del análisis para que el
  // filtro person-centric del cliente no lo descarte correctamente.
  await page.getByRole("button", { name: /Bolsos y accesorios/i }).click();
  const input = page.locator('input[type="file"][accept*="video"]').first();
  await input.setInputFiles(VIDEO_PATH);
  await expect(page.locator("video").first()).toBeVisible();
  if (disablePreanalysis) {
    await page.getByRole("button", { name: /detener análisis/i }).click();
  }
}

async function playUntil(page: Page, seconds: number) {
  await page.locator("video").first().evaluate(async (video, target) => {
    await (video as HTMLVideoElement).play();
    await new Promise<void>((resolve) => {
      const tick = () => {
        if ((video as HTMLVideoElement).currentTime >= Number(target)) resolve();
        else requestAnimationFrame(tick);
      };
      tick();
    });
    (video as HTMLVideoElement).pause();
  }, seconds);
}

async function frozenFrameCenterRgb(page: Page): Promise<[number, number, number]> {
  return page.getByTestId("paused-frame-image").evaluate(async (node) => {
    const image = node as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixel = context.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1
    ).data;
    return [pixel[0], pixel[1], pixel[2]] as [number, number, number];
  });
}

test.describe("/studio · pausa exacta y click-to-shop", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ browser }) => {
    await makeSyntheticVideo(browser);
    mkdirSync(SHOTS_DIR, { recursive: true });
  });

  test("separa En directo de Vídeo preprocesado antes de cargar contenido", async ({ page }, testInfo) => {
    await page.goto("/studio");
    const live = page.getByTestId("workflow-mode-interactive");
    const preprocessed = page.getByTestId("workflow-mode-preprocessed");
    await expect(live).toContainText("En directo");
    await expect(preprocessed).toContainText("Vídeo preprocesado");
    await preprocessed.click();
    await expect(page.getByRole("heading", { name: "Vídeo preprocesado" })).toBeVisible();
    await expect(page.locator('input[type="file"][accept*="video"]')).toBeVisible();
    await page.screenshot({
      path: join(SHOTS_DIR, `preprocessed-mode-${testInfo.project.name}.png`),
      fullPage: false,
    });
    await live.click();
    await expect(page.getByRole("heading", { name: "Vídeo preprocesado" })).toHaveCount(0);
  });

  test("pausa, cajas, catálogo bajo demanda y reanudación visible", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const calls = await installApiMocks(page);
    await uploadVideo(page);

    await playUntil(page, 2.1);
    await expect(page.getByTestId("paused-frame-image")).toBeVisible();
    await expect(page.getByText(/Frame capturado · 00:02\./i)).toBeVisible();
    const polo = page.getByRole("button", { name: /seleccionar Polo oscuro/i });
    await expect(polo).toBeVisible({ timeout: 3_000 });
    expect(calls).toHaveLength(0);

    await polo.click();
    await expect(page.getByTestId("commerce-side-panel")).toContainText("Polo Essential negro");
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0].forceExternal).not.toBe(true);
    expect(calls[0].matchingMode).toBe("catalog_only");

    // Volver a clicar el mismo track reutiliza el resultado ya resuelto.
    await polo.click();
    await page.waitForTimeout(100);
    expect(calls).toHaveLength(1);

    await expect(page.getByRole("button", { name: /buscar también en internet/i })).toHaveCount(0);

    await page.screenshot({
      path: join(SHOTS_DIR, `click-to-shop-${testInfo.project.name}.png`),
      fullPage: false,
    });

    const pausedAt = await page.locator("video").first().evaluate((video) => (video as HTMLVideoElement).currentTime);
    await page.getByTestId("resume-video-button").click();
    await expect(page.getByTestId("paused-frame-image")).toHaveCount(0);
    await expect(page.getByTestId("clickable-detection-overlay")).toHaveCount(0);
    await expect.poll(() => page.locator("video").first().evaluate((video) => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(pausedAt);
  });

  test("sin match de catálogo, Internet arranca automáticamente sin bloquear las cajas", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const calls = await installApiMocks(page, [], true);
    await uploadVideo(page);
    await playUntil(page, 2.1);
    const polo = page.getByRole("button", { name: /seleccionar Polo oscuro/i });
    await polo.click();
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("clickable-detection-overlay")).toBeVisible();
    await expect(page.getByTestId("commerce-side-panel")).toContainText(/Consultando Internet/i);
    await expect.poll(() => calls.length).toBe(2);
    expect(calls[0].matchingMode).toBe("catalog_only");
    expect(calls[1].matchingMode).toBe("external_only");
    expect(calls[1].forceExternal).toBe(true);
    await expect(page.getByTestId("commerce-side-panel")).toContainText(/alternativa/i);
    await expect(page.getByTestId("commerce-side-panel")).toContainText(/Candidato externo/i);
    await page.screenshot({
      path: join(SHOTS_DIR, `automatic-fallback-${testInfo.project.name}.png`),
      fullPage: false,
    });
  });

  test("una respuesta antigua no sustituye la pausa nueva", async ({ page }) => {
    test.setTimeout(90_000);
    await installApiMocks(page, [900, 40]);
    await uploadVideo(page);

    await playUntil(page, 2.1);
    await page.locator("video").first().evaluate((video) => (video as HTMLVideoElement).play());
    await playUntil(page, 3.4);

    await expect(page.getByRole("button", { name: /seleccionar Bolso caramelo/i })).toBeVisible({ timeout: 3_000 });
    const [red, green, blue] = await frozenFrameCenterRgb(page);
    expect(red, "el frame de la escena B debe ser marrón, no el azul anterior").toBeGreaterThan(80);
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("button", { name: /seleccionar Polo oscuro/i })).toHaveCount(0);
  });

  test("móvil abre bottom sheet y reduced motion conserva el flujo", async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installApiMocks(page);
    await uploadVideo(page);
    await playUntil(page, 3.3);
    await page.getByRole("button", { name: /seleccionar Bolso caramelo/i }).click();
    const panel = page.getByTestId("commerce-side-panel");
    await expect(panel).toBeVisible();
    if (test.info().project.name === "mobile") {
      await expect(panel).toHaveCSS("position", "fixed");
      await expect(page.getByRole("button", { name: /cerrar panel de producto/i })).toBeVisible();
    }
  });

  test("las detecciones preanalizadas aparecen desde caché en menos de 200 ms", async ({ page }) => {
    test.setTimeout(90_000);
    await installApiMocks(page);
    await uploadVideo(page, false);
    const responsePromise = page.waitForResponse("**/api/vision/analyze-frame-stream");
    await page.locator("video").first().evaluate((video) => (video as HTMLVideoElement).play());
    const response = await responsePromise;
    await response.finished();
    await page.waitForTimeout(35);
    const startedAt = Date.now();
    await page.locator("video").first().evaluate((video) => (video as HTMLVideoElement).pause());
    await expect(page.getByRole("button", { name: /seleccionar Polo oscuro/i })).toBeVisible({
      timeout: 200,
    });
    expect(Date.now() - startedAt).toBeLessThan(200);
    await expect(page.getByText(/Frame capturado .* caché/i)).toBeVisible();
  });
});
