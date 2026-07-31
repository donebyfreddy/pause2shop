import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";

import { prepareDatasetImage } from "../../lib/catalogIngestion/datasets/images";
import { FASHION_PRODUCT_IMAGES_SMALL } from "../../lib/catalogIngestion/datasets/registry";
import {
  getStorageConfig,
  isPersistentStorage,
  isStorageConfigured,
} from "../../lib/mediaStorage";

/**
 * Pipeline de imágenes del dataset: validación, hashes, y publicación.
 *
 * Se usa el proveedor `local` con una base pública: publica en memoria, sin red
 * y sin credenciales. Lo que se comprueba aquí es la validación y los hashes;
 * el driver de Vercel Blob se verificó contra el servicio real.
 */

const DESCRIPTOR = FASHION_PRODUCT_IMAGES_SMALL;
let jpeg60x80: Buffer;
let png: Buffer;
let tiny: Buffer;

before(async () => {
  // Mismas dimensiones que el dataset real (60×80): es el caso que decide si se
  // genera miniatura aparte o no.
  jpeg60x80 = await sharp({
    create: { width: 60, height: 80, channels: 3, background: { r: 200, g: 30, b: 40 } },
  })
    .jpeg()
    .toBuffer();
  png = await sharp({
    create: { width: 300, height: 400, channels: 3, background: { r: 10, g: 200, b: 90 } },
  })
    .png()
    .toBuffer();
  tiny = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  process.env.STORAGE_PROVIDER = "local";
  process.env.PUBLIC_MEDIA_BASE_URL = "https://media.test";
  process.env.STORAGE_BUCKET = "pause2shop";
});

test("una imagen válida produce sha256 y hash perceptual", async () => {
  const result = await prepareDatasetImage({
    buffer: jpeg60x80,
    descriptor: DESCRIPTOR,
    sourceProductId: "15970",
    originUrl: "https://cdn.test/15970.jpg",
    uploadImages: false,
  });
  assert.ok(result.ok);
  const { image } = result.prepared;
  assert.match(image.sha256 ?? "", /^[0-9a-f]{64}$/);
  // dHash de 64 bits en hexadecimal = 16 caracteres.
  assert.match(image.perceptualHash ?? "", /^[0-9a-f]{16}$/);
  assert.equal(image.width, 60);
  assert.equal(image.height, 80);
});

test("los hashes son deterministas: la misma imagen da el mismo sha", async () => {
  // De esto depende que reimportar no duplique por `exact_image_hash`.
  const a = await prepareDatasetImage({
    buffer: jpeg60x80, descriptor: DESCRIPTOR, sourceProductId: "1",
    originUrl: null, uploadImages: false,
  });
  const b = await prepareDatasetImage({
    buffer: jpeg60x80, descriptor: DESCRIPTOR, sourceProductId: "2",
    originUrl: null, uploadImages: false,
  });
  assert.ok(a.ok && b.ok);
  assert.equal(a.prepared.image.sha256, b.prepared.image.sha256);
  assert.equal(a.prepared.image.perceptualHash, b.prepared.image.perceptualHash);
});

test("el sha256 es del buffer OPTIMIZADO, no del original", async () => {
  // Importa porque el dedup compara contra imágenes procesadas por el mismo
  // pipeline: hashear el original haría que la misma foto scrapeada y la misma
  // del dataset no se reconocieran.
  const result = await prepareDatasetImage({
    buffer: png, descriptor: DESCRIPTOR, sourceProductId: "1",
    originUrl: null, uploadImages: false,
  });
  assert.ok(result.ok);
  const originalSha = createHash("sha256").update(png).digest("hex");
  assert.notEqual(result.prepared.image.sha256, originalSha);
  const optimizedSha = createHash("sha256").update(result.prepared.optimized).digest("hex");
  assert.equal(result.prepared.image.sha256, optimizedSha);
});

test("un PNG se acepta y se normaliza a JPEG", async () => {
  const result = await prepareDatasetImage({
    buffer: png, descriptor: DESCRIPTOR, sourceProductId: "1",
    originUrl: null, uploadImages: false,
  });
  assert.ok(result.ok);
  const meta = await sharp(result.prepared.optimized).metadata();
  assert.equal(meta.format, "jpeg");
});

test("unos bytes que no son imagen se rechazan con motivo", async () => {
  const result = await prepareDatasetImage({
    buffer: Buffer.from("<html>404 not found</html>"),
    descriptor: DESCRIPTOR, sourceProductId: "1", originUrl: null, uploadImages: false,
  });
  assert.equal(result.ok, false);
  // El Content-Type del servidor no basta: un HTML servido como image/jpeg
  // pasaría el filtro si no se validara la cabecera real.
  assert.ok(!result.ok && result.reason.length > 0);
});

test("un buffer vacío se rechaza", async () => {
  const result = await prepareDatasetImage({
    buffer: Buffer.alloc(0), descriptor: DESCRIPTOR, sourceProductId: "1",
    originUrl: null, uploadImages: false,
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason.includes("vacía"));
});

test("una imagen minúscula se rechaza: no sirve para matching visual", async () => {
  const result = await prepareDatasetImage({
    buffer: tiny, descriptor: DESCRIPTOR, sourceProductId: "1",
    originUrl: null, uploadImages: false,
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && /pequeña|dimensiones/.test(result.reason));
});

test("sin subir imagen se conserva la URL de origen como referencia", async () => {
  const result = await prepareDatasetImage({
    buffer: jpeg60x80, descriptor: DESCRIPTOR, sourceProductId: "15970",
    originUrl: "https://cdn.test/15970.jpg", uploadImages: false,
  });
  assert.ok(result.ok);
  assert.equal(result.prepared.uploaded, false);
  assert.equal(result.prepared.image.url, "https://cdn.test/15970.jpg");
  assert.equal(result.prepared.image.localPath, null);
});

test("al subir, la URL es la NUESTRA y la clave es estable", async () => {
  const result = await prepareDatasetImage({
    buffer: jpeg60x80, descriptor: DESCRIPTOR, sourceProductId: "15970",
    // La URL de HuggingFace viene firmada y CADUCA: si se guardara esa, el
    // catálogo se quedaría sin fotos a los pocos días.
    originUrl: "https://datasets-server.huggingface.co/x?Expires=123&Signature=abc",
    uploadImages: true,
  });
  assert.ok(result.ok);
  assert.equal(result.prepared.uploaded, true);
  assert.ok(
    !result.prepared.image.url.includes("Signature"),
    "no debe conservarse una URL firmada como imagen del catálogo"
  );
  // `localPath` guarda la CLAVE en storage: es lo que permite localizar y
  // borrar los objetos de un dataset concreto.
  assert.equal(
    result.prepared.image.localPath,
    "catalog/datasets/fashion-product-images-small/15970.jpg"
  );
});

test("una imagen ya del tamaño de miniatura no genera un segundo objeto", async () => {
  // Las del dataset son 60×80: duplicar el objeto costaría el doble de PUTs y de
  // almacenamiento para servir exactamente los mismos píxeles.
  const result = await prepareDatasetImage({
    buffer: jpeg60x80, descriptor: DESCRIPTOR, sourceProductId: "15970",
    originUrl: null, uploadImages: true,
  });
  assert.ok(result.ok);
  assert.equal(
    result.prepared.thumbUrl,
    result.prepared.image.url,
    "se reutiliza la principal en vez de subir una copia idéntica"
  );
});

test("una imagen grande SÍ genera miniatura aparte", async () => {
  const result = await prepareDatasetImage({
    buffer: png, descriptor: DESCRIPTOR, sourceProductId: "42",
    originUrl: null, uploadImages: true,
  });
  assert.ok(result.ok);
  assert.ok(result.prepared.thumbUrl);
  assert.notEqual(result.prepared.thumbUrl, result.prepared.image.url);
});

test("un fallo de storage NO se reporta como éxito", async () => {
  // Con el proveedor local y una base de localhost, publicar debe fallar: un
  // proveedor externo no puede descargar de 127.0.0.1.
  process.env.PUBLIC_MEDIA_BASE_URL = "http://localhost:3000";
  const result = await prepareDatasetImage({
    buffer: jpeg60x80, descriptor: DESCRIPTOR, sourceProductId: "1",
    originUrl: null, uploadImages: true,
  });
  assert.equal(result.ok, false, "si el storage rechaza, la ficha no se guarda con imagen falsa");
  assert.ok(!result.ok && result.reason.includes("storage"));
});

test("el proveedor local se declara NO persistente", () => {
  process.env.STORAGE_PROVIDER = "local";
  const config = getStorageConfig();
  assert.equal(isStorageConfigured(config), true, "local está implementado…");
  assert.equal(isPersistentStorage(config), false, "…pero no sobrevive a un reinicio");
});

test("vercel_blob sin token no se declara configurado", () => {
  // Estar implementado no basta: sin token no puede subir nada, y decir que sí
  // haría que el aviso de storage efímero no apareciera cuando debe.
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.STORAGE_PROVIDER = "vercel_blob";
  try {
    const config = getStorageConfig();
    assert.equal(isStorageConfigured(config), false);
    assert.equal(isPersistentStorage(config), false);
  } finally {
    if (saved) process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});

test("vercel_blob con token se declara persistente", () => {
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";
  process.env.STORAGE_PROVIDER = "vercel_blob";
  try {
    const config = getStorageConfig();
    assert.equal(isStorageConfigured(config), true);
    assert.equal(isPersistentStorage(config), true);
  } finally {
    if (saved) process.env.BLOB_READ_WRITE_TOKEN = saved;
    else delete process.env.BLOB_READ_WRITE_TOKEN;
  }
});
