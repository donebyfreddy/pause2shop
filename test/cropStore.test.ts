import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCrop,
  isPubliclyReachable,
  publishCropLocally,
  putCrop,
} from "../lib/server/cropStore";

test("isPubliclyReachable rechaza localhost y redes privadas", () => {
  assert.equal(isPubliclyReachable("http://localhost:3000"), false);
  assert.equal(isPubliclyReachable("http://127.0.0.1:3000"), false);
  assert.equal(isPubliclyReachable("http://192.168.1.10:3000"), false);
  assert.equal(isPubliclyReachable("http://10.0.0.5"), false);
  assert.equal(isPubliclyReachable("https://pause2shop.vercel.app"), true);
});

test("publishCropLocally: origen público → URL /api/crops/<hash>; localhost → null", () => {
  const buf = Buffer.from("fake-jpeg");
  const url = publishCropLocally("a".repeat(64), buf, "image/jpeg", "https://demo.example");
  assert.equal(url, `https://demo.example/api/crops/${"a".repeat(64)}.jpg`);
  assert.ok(getCrop("a".repeat(64)));

  assert.equal(
    publishCropLocally("b".repeat(64), buf, "image/jpeg", "http://localhost:3000"),
    null
  );
});

test("PUBLIC_MEDIA_BASE_URL tiene prioridad sobre el origen de la petición", () => {
  process.env.PUBLIC_MEDIA_BASE_URL = "https://tunel.example";
  const url = publishCropLocally(
    "c".repeat(64),
    Buffer.from("x"),
    "image/webp",
    "http://localhost:3000"
  );
  assert.equal(url, `https://tunel.example/api/crops/${"c".repeat(64)}.webp`);
  delete process.env.PUBLIC_MEDIA_BASE_URL;
});

test("getCrop devuelve el contenido guardado y null para hashes desconocidos", () => {
  putCrop("d".repeat(64), Buffer.from("data"), "image/png");
  const crop = getCrop("d".repeat(64));
  assert.ok(crop);
  assert.equal(crop.mime, "image/png");
  assert.equal(getCrop("e".repeat(64)), null);
});
