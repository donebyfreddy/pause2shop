import { test, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileCatalogStore } from "../../lib/catalogIngestion/catalog/fileStore";
import { emptyJobProgress } from "../../lib/catalogIngestion/catalog/types";
import { tempDataDir, makeProduct } from "./helpers";

let dir: string;

before(() => {
  dir = tempDataDir("filestore");
});

test("guarda, lee y lista productos con filtros y paginación", async () => {
  const store = new FileCatalogStore(join(dir, "a.json"));
  await store.init();

  for (let i = 0; i < 5; i++) {
    await store.saveProduct(makeProduct({
      id: `p${i}`,
      source: i < 3 ? "zara" : "mango",
      brand: i < 3 ? "Zara" : "Mango",
      category: i % 2 === 0 ? "dress" : "shirt",
      title: `Producto filtro ${i}`,
    }));
  }

  assert.equal((await store.getProduct("p0"))?.id, "p0");
  assert.equal(await store.getProduct("nope"), null);
  assert.equal(await store.countProducts(), 5);
  assert.equal(await store.countProducts("zara"), 3);

  const zara = await store.listProducts({ source: "zara" });
  assert.equal(zara.total, 3);
  const dress = await store.listProducts({ category: "dress" });
  assert.equal(dress.total, 3);
  const byQ = await store.listProducts({ q: "filtro 4" });
  assert.equal(byQ.total, 1);
  const page = await store.listProducts({ limit: 2, page: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 5);
});

test("búsquedas por claves de dedup", async () => {
  const store = new FileCatalogStore(join(dir, "b.json"));
  await store.init();
  await store.saveProduct(makeProduct({
    id: "k1", source: "zara", sourceProductId: "777",
    canonicalUrl: "https://z/u.html", sku: "SKU-1", gtin: "G-1",
    images: [{ url: "u", localPath: null, sha256: "sha-x", perceptualHash: null, width: 1, height: 1 }],
    variants: [{ id: "v1", color: null, size: "M", sku: "SKU-VAR", price: 1, currency: "EUR", availability: "in_stock" }],
  }));

  assert.equal((await store.findBySourceProductId("zara", "777"))?.id, "k1");
  assert.equal(await store.findBySourceProductId("mango", "777"), null);
  assert.equal((await store.findByCanonicalUrl("https://z/u.html"))?.id, "k1");
  assert.equal((await store.findBySku("SKU-1"))?.id, "k1");
  assert.equal((await store.findBySku("SKU-VAR"))?.id, "k1", "también busca en SKUs de variantes");
  assert.equal((await store.findByGtin("G-1"))?.id, "k1");
  assert.equal((await store.findByImageSha256("sha-x"))?.id, "k1");
});

test("persistencia: los datos sobreviven a una reapertura", async () => {
  const path = join(dir, "c.json");
  const store = new FileCatalogStore(path);
  await store.init();
  await store.saveProduct(makeProduct({ id: "persist-1" }));
  await store.setSourceState({ id: "zara", paused: true, lastSyncAt: "2026-07-18T00:00:00.000Z" });
  await store.recordPrice("persist-1", { price: 9.99, originalPrice: null, currency: "EUR", recordedAt: new Date().toISOString() });
  await store.close(); // flush

  const reopened = new FileCatalogStore(path);
  await reopened.init();
  const p = await reopened.getProduct("persist-1");
  assert.equal(p?.id, "persist-1");
  assert.equal(p?.priceHistory.length, 1);
  const state = await reopened.getSourceState("zara");
  assert.equal(state.paused, true);
});

test("setActive, jobs y stats", async () => {
  const store = new FileCatalogStore(join(dir, "d.json"));
  await store.init();
  await store.saveProduct(makeProduct({ id: "s1", imageEmbedding: [1, 2], images: [{ url: "u", localPath: null, sha256: "s", perceptualHash: null, width: 1, height: 1 }] }));
  await store.saveProduct(makeProduct({ id: "s2", origin: "externally_discovered" }));
  await store.setActive("s1", false);
  assert.equal((await store.getProduct("s1"))?.isActive, false);

  await store.saveJob({
    jobId: "job-1", type: "sync_full", source: "zara", mode: "full", limit: null,
    status: "completed",
    progress: { ...emptyJobProgress(), discovered: 1, fetched: 1, new: 1 },
    checkpoint: {}, errors: [], createdAt: new Date().toISOString(),
    startedAt: null, finishedAt: null, durationMs: 10, cancelRequested: false,
  });
  assert.equal((await store.getJob("job-1"))?.status, "completed");
  assert.equal((await store.listJobs(10)).length, 1);

  const stats = await store.stats();
  assert.equal(stats.totalProducts, 2);
  assert.equal(stats.activeProducts, 1);
  assert.equal(stats.withEmbeddings, 1);
  assert.equal(stats.withImages, 1);
  assert.equal(stats.byOrigin.externally_discovered, 1);
  assert.equal(stats.jobs.completed, 1);
});
