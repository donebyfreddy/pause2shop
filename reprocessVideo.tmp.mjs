import { chromium } from "@playwright/test";

const VIDEO_PATH = process.argv[2];
const BASE_URL = process.argv[3] || "http://localhost:3000";

function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function main() {
  if (!VIDEO_PATH) throw new Error("Falta la ruta del vídeo (argv[2]).");

  log(`LAUNCH chrome BASE_URL=${BASE_URL} VIDEO=${VIDEO_PATH}`);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ locale: "es-ES" });
  const page = await context.newPage();

  let jobId = null;
  page.on("response", async (res) => {
    const url = res.url();
    if (url.endsWith("/api/analysis/jobs") && res.request().method() === "POST") {
      try {
        const body = await res.json();
        if (body.jobId) jobId = body.jobId;
        log(`CREATE_JOB ${JSON.stringify(body).slice(0, 600)}`);
      } catch (e) {
        log(`CREATE_JOB_PARSE_ERROR ${e}`);
      }
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`BROWSER_CONSOLE_ERROR ${msg.text().slice(0, 300)}`);
  });
  page.on("pageerror", (err) => log(`PAGE_ERROR ${err.message}`));
  page.on("close", () => log("PAGE_CLOSED"));
  browser.on("disconnected", () => log("BROWSER_DISCONNECTED"));

  log(`GOTO ${BASE_URL}/demo`);
  await page.goto(`${BASE_URL}/demo`, { waitUntil: "load", timeout: 60000 });

  const fileInput = page.locator('input[type="file"][accept*="video"]').first();
  log("SET_INPUT_FILES");
  await fileInput.setInputFiles(VIDEO_PATH);

  log("WAIT_METADATA_AND_HASH");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent?.includes("Analizar") && !b.disabled
      ),
    { timeout: 60000 }
  );

  const videoInfo = await page.evaluate(() => {
    const v = document.querySelector("video");
    return v ? { duration: v.duration, width: v.videoWidth, height: v.videoHeight } : null;
  });
  log(`VIDEO_METADATA ${JSON.stringify(videoInfo)}`);
  if (!videoInfo || !videoInfo.duration || !videoInfo.width) {
    throw new Error("El vídeo no cargó metadata (duration/width vacíos) — posible fallo de códec.");
  }

  const analyzeBtn = page.locator("button", { hasText: "Analizar vídeo" }).first();
  await analyzeBtn.click();
  log("CLICKED_ANALYZE");

  const jobIdDeadline = Date.now() + 30000;
  while (!jobId && Date.now() < jobIdDeadline) {
    await page.waitForTimeout(500);
  }
  if (!jobId) throw new Error("No se capturó jobId tras crear el job.");
  log(`JOB_ID ${jobId}`);

  const terminal = new Set(["completed", "partially_completed", "failed", "cancelled"]);
  let lastLogged = 0;
  const start = Date.now();
  const maxWaitMs = 45 * 60 * 1000;
  // Polling con `fetch` de Node, NO con page.request: no depende de que el
  // navegador siga vivo para poder seguir informando del estado del job.
  for (;;) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${BASE_URL}/api/analysis/jobs/${jobId}`, {
        signal: controller.signal,
      });
      clearTimeout(t);
      const body = await res.json();
      const job = body.job;
      if (!job) {
        log(`POLL_NO_JOB ${JSON.stringify(body).slice(0, 300)}`);
      } else {
        if (Date.now() - lastLogged > 15000) {
          log(
            `POLL status=${job.status} received=${job.counters?.framesReceived} analyzed=${job.counters?.framesAnalyzed} scenes=${job.counters?.scenes} tracks=${job.counters?.tracks} uniqueProducts=${job.counters?.uniqueProducts} matchingMs=${job.timings?.matchingMs}`
          );
          lastLogged = Date.now();
        }
        if (terminal.has(job.status)) {
          log(`DONE status=${job.status}`);
          log(`RESULT ${JSON.stringify(job)}`);
          break;
        }
      }
    } catch (e) {
      log(`POLL_ERROR ${e?.message || e} (se sigue reintentando)`);
    }
    if (Date.now() - start > maxWaitMs) {
      log(`TIMEOUT esperando estado terminal tras ${maxWaitMs}ms`);
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  await browser.close().catch(() => undefined);
  log("BROWSER_CLOSED");
}

main().catch((err) => {
  console.log(`FATAL ${err?.stack || err}`);
  process.exitCode = 1;
});
