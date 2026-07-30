import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { dhash, hammingDistance } from "../../lib/catalogIngestion/images/dhash";
import { fixtureImage } from "./helpers";

test("dhash devuelve 64 bits en hex y es determinista", async () => {
  const img = fixtureImage("zara-08741330.jpg");
  const h1 = await dhash(img);
  const h2 = await dhash(img);
  assert.equal(h1.length, 16);
  assert.match(h1, /^[0-9a-f]{16}$/);
  assert.equal(h1, h2);
});

test("dhash es robusto ante reescalado y recompresión", async () => {
  const original = fixtureImage("mango-57091032.jpg");
  const recompressed = await sharp(original).resize(200).jpeg({ quality: 60 }).toBuffer();
  const dist = hammingDistance(await dhash(original), await dhash(recompressed));
  assert.ok(dist <= 6, `distancia ${dist} debería ser ≤ 6 para la misma imagen reescalada`);
});

test("dhash distingue imágenes distintas", async () => {
  const a = await dhash(fixtureImage("zara-08741330.jpg"));
  const b = await dhash(fixtureImage("hm-1074402002.jpg"));
  const dist = hammingDistance(a, b);
  assert.ok(dist > 6, `distancia ${dist} debería ser > 6 para imágenes distintas`);
});

test("hammingDistance cuenta bits", () => {
  assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistance("0000000000000000", "000000000000000f"), 4);
  assert.equal(hammingDistance("ffffffffffffffff", "0000000000000000"), 64);
});
